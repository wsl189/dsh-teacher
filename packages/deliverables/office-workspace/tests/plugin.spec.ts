/** Real tool execution and Session lifecycle for temporary Office work. */
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import * as OfficeWorkspace from '../src/index.ts'
import * as ScratchFiles from '../src/files.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup(mode: 'read-only' | 'workspace-write' = 'workspace-write') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-office-owner-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SandboxPolicy, { mode })
  const harness = await mountAgentLoopTestHarness(ctx)
  const fiber = await ctx.plugin(OfficeWorkspace)
  const agent = await harness.create(SessionId('office-owner'), {}, { cwd: root })
  agent.session.append('turn/start', { turn: 1 })
  let sequence = 0
  const call = (args: Record<string, unknown>) => ctx.tools.execute({
    name: 'office_workspace', arguments: args, signal: new AbortController().signal,
    callId: ToolCallId(`office-${++sequence}`), agent,
  })
  const create = async (): Promise<string> => {
    const result = await call({ action: 'create' })
    if (result.isError) throw new Error(JSON.stringify(result.content))
    return (result.value as { directory: string }).directory
  }
  const writes: string[] = []
  for (const name of ['univer_new', 'univer_screenshot', 'univer_export', 'univer_print_pdf', 'univer_resources', 'univer_unit']) {
    ctx.tools.register(defineTool({
      name, description: 'Observe whether output validation permits tool execution.',
      parameters: { file: { type: 'string' }, output: { type: 'string' }, action: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => { writes.push(name); return Promise.resolve('executed') },
    }))
  }
  const univer = (name: string, args: unknown, caller = agent) => ctx.tools.execute({
    name, arguments: args, signal: new AbortController().signal,
    callId: ToolCallId(`univer-${++sequence}`), agent: caller,
  })
  return { root, ctx, fiber, agent, harness, call, create, univer, writes }
}

it('rejects loose Univer outputs before execution and permits each output in owned scratch', async () => {
  const { root, ctx, create, univer, writes } = await setup()
  ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }), { prepend: true })
  const directory = await create()
  const cases = [
    ['univer_new', { file: 'draft.univer' }],
    ['univer_screenshot', { output: 'screenshots' }],
    ['univer_export', { output: 'draft.docx' }],
    ['univer_print_pdf', { output: 'draft.pdf' }],
    ['univer_resources', { action: 'export', output: 'assets' }],
  ] as const
  for (const [name, args] of cases) {
    const denied = await univer(name, args)
    expect(denied.isError).toBe(true)
    expect(denied.content).toHaveLength(1)
    expect(denied.content[0]).toMatchObject({ type: 'text' })
    if (denied.content[0]?.type !== 'text') throw new Error('Output denial did not return text')
    expect(denied.content[0].text).toContain('Call office_workspace with action="create"')
    expect((await univer(name, { ...args, ...('file' in args ? { file: join(directory, args.file) } : { output: join(directory, args.output) }) })).isError).toBe(false)
  }
  expect(writes).toEqual(cases.map(([name]) => name))
  expect(await readdir(root)).toEqual([directory.slice(root.length + 1)])
  expect((await univer('univer_screenshot', { output: directory })).isError).toBe(false)
})

it('keeps existing project edits and resource reads available and unregisters the guard on disposal', async () => {
  const { fiber, univer, writes } = await setup()
  expect((await univer('univer_unit', { file: 'user-original.univer', action: 'create' })).isError).toBe(false)
  expect((await univer('univer_resources', { action: 'read' })).isError).toBe(false)
  expect((await univer('univer_resources', {})).isError).toBe(false)
  for (const args of [null, 'invalid', { file: 12 }]) expect((await univer('univer_new', args)).isError).toBe(true)
  expect(writes).toEqual(['univer_unit', 'univer_resources', 'univer_resources'])
  expect((await univer('univer_new', { file: 'draft.univer' })).isError).toBe(true)
  await fiber.dispose()
  expect((await univer('univer_new', { file: 'draft.univer' })).isError).toBe(false)
})

it('requires the calling session and turn to own an active output directory', async () => {
  const { root, agent, ctx, harness, create, call, univer, writes } = await setup()
  const directory = await create()
  const args = { file: join(directory, 'draft.univer') }
  const foreign = await harness.create(SessionId('foreign-writer'), {}, { cwd: root })
  foreign.session.append('turn/start', { turn: 1 })
  expect((await univer('univer_new', args, foreign)).isError).toBe(true)
  const noCwd = await harness.create(SessionId('no-cwd'))
  expect((await univer('univer_new', args, noCwd)).isError).toBe(true)
  expect((await ctx.tools.execute({ name: 'univer_new', arguments: args, signal: new AbortController().signal, callId: ToolCallId('no-agent') })).isError).toBe(true)
  await call({ action: 'pause', directory })
  expect((await univer('univer_new', args)).isError).toBe(true)
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect((await univer('univer_new', args)).isError).toBe(true)
  agent.session.append('turn/start', { turn: 2 })
  expect((await univer('univer_new', args)).isError).toBe(true)
  await call({ action: 'resume', directory })
  expect((await univer('univer_new', args)).isError).toBe(false)
  await call({ action: 'discard', directory })
  expect((await univer('univer_new', args)).isError).toBe(true)
  expect(writes).toEqual(['univer_new'])
})

it('finishes through the real tool, leaves only requested finals, and unregisters on disposal', async () => {
  const { root, ctx, fiber, call, create } = await setup()
  const directory = await create()
  await writeFile(join(directory, 'final.docx'), 'document')
  await writeFile(join(directory, 'author.js'), 'source')
  const result = await call({ action: 'finish', directory, files: [{ source: 'final.docx', destination: '最终文档.docx' }] })
  expect(result.isError).toBe(false)
  expect(result.value).toMatchObject({ files: [join(root, '最终文档.docx')], cleaned: true })
  expect(await readdir(root)).toEqual(['最终文档.docx'])
  expect(ctx.tools.get('office_workspace')?.presentCall?.({ action: 'create' })).toEqual({ card: 'generic', title: 'Office workspace: create', kind: 'execute' })
  await fiber.dispose()
  expect(ctx.tools.get('office_workspace')).toBeUndefined()
})

it.each(['completed', 'aborted', 'error'] as const)('removes abandoned scratch after a %s turn and preserves unrelated paths', async (kind) => {
  const { root, agent, create } = await setup()
  await writeFile(join(root, 'original.docx'), 'user file')
  const directory = await create()
  await writeFile(join(directory, 'author.js'), 'intermediate')
  const reason = kind === 'aborted' ? { kind, reason: { kind: 'user' as const } }
    : kind === 'error' ? { kind, error: { code: 'UNKNOWN', message: 'failed generation' } } : { kind }
  agent.session.append('turn/end', { turn: 1, reason })
  await vi.waitFor(async () => { expect(await readdir(root)).toEqual(['original.docx']) })
})

it('discards only its own directory and rejects expired, missing, and foreign ownership', async () => {
  const { root, call, create } = await setup()
  const [directory, sibling] = await Promise.all([create(), create()])
  for (const args of [{ action: 'finish', directory }, { action: 'finish', directory, files: [] }, { action: 'discard' }, { action: 'discard', directory: root }]) {
    expect((await call(args)).isError).toBe(true)
  }
  expect((await call({ action: 'discard', directory })).isError).toBe(false)
  expect(await readdir(root)).toEqual([sibling.slice(root.length + 1)])
  expect((await call({ action: 'discard', directory })).isError).toBe(true)
})

it('denies creation in read-only mode and outside an open turn', async () => {
  const readOnly = await setup('read-only')
  expect((await readOnly.call({ action: 'create' })).isError).toBe(true)
  expect(await readdir(readOnly.root)).toEqual([])
  const writable = await setup()
  writable.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect((await writable.call({ action: 'create' })).isError).toBe(true)
})

it('joins queued operations during plugin disposal and cleans directories from all sessions', async () => {
  const { root, fiber, create } = await setup()
  await Promise.all([create(), create()])
  await fiber.dispose()
  expect(await readdir(root)).toEqual([])
})

it('cleans on session disposal and ignores sessions that allocated no scratch', async () => {
  const { root, ctx, agent, create, harness } = await setup()
  await create()
  const other = await harness.create(SessionId('office-other'), {}, { cwd: root })
  ctx.emit('session/disposed', other.session)
  ctx.emit('session/disposed', agent.session)
  await vi.waitFor(async () => { expect(await readdir(root)).toEqual([]) })
})

it('reports a replaced directory on turn end and disposal without deleting its new contents', async () => {
  const { root, ctx, agent, create, call } = await setup()
  const directory = await create()
  const moved = `${directory}-moved`
  await rename(directory, moved)
  await mkdir(directory)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  try {
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(1) })
    agent.session.append('turn/start', { turn: 2 })
    expect((await call({ action: 'finish', directory, files: [] })).isError).toBe(true)
    const current = await create()
    agent.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await vi.waitFor(async () => { expect(await readdir(root)).not.toContain(current.slice(root.length + 1)) })
    ctx.emit('session/disposed', agent.session)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(2) })
  } finally {
    await rm(directory, { recursive: true })
    await rename(moved, directory)
    warn.mockRestore()
  }
})

it('requires a calling agent with a workspace', async () => {
  const { ctx, harness } = await setup()
  const execute = { name: 'office_workspace', arguments: { action: 'create' }, signal: new AbortController().signal, callId: ToolCallId('detached') }
  expect((await ctx.tools.execute(execute)).isError).toBe(true)
  const agent = await harness.create(SessionId('no-workspace'))
  expect((await ctx.tools.execute({ ...execute, agent })).isError).toBe(true)
})

it('retains a paused project for user confirmation and resumes it in the next turn', async () => {
  const { root, agent, create, call } = await setup()
  const directory = await create()
  await writeFile(join(directory, 'lesson.pptx'), 'checked presentation')
  expect((await call({ action: 'resume', directory })).isError).toBe(true)
  expect((await call({ action: 'pause', directory })).value).toMatchObject({ paused: true, cleaned: false })
  expect((await call({ action: 'finish', directory, files: [] })).isError).toBe(true)
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  agent.session.append('turn/start', { turn: 2 })
  expect((await call({ action: 'resume', directory })).value).toMatchObject({ paused: false, cleaned: false })
  expect((await call({ action: 'finish', directory, files: [{ source: 'lesson.pptx', destination: 'lesson.pptx' }] })).isError).toBe(false)
  expect(await readdir(root)).toEqual(['lesson.pptx'])
})

it('removes a paused project when the waiting turn is canceled', async () => {
  const { root, agent, create, call } = await setup()
  const directory = await create()
  await call({ action: 'pause', directory })
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  await vi.waitFor(async () => { expect(await readdir(root)).toEqual([]) })
})

it('waits for an in-flight allocation and removes it when the plugin unloads', async () => {
  const { root, fiber, call } = await setup()
  const allocate = ScratchFiles.createScratch
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const spy = vi.spyOn(ScratchFiles, 'createScratch').mockImplementation(async (cwd) => {
    const scratch = await allocate(cwd)
    entered.resolve(undefined)
    await release.promise
    return scratch
  })
  try {
    const pending = call({ action: 'create' })
    await entered.promise
    const disposal = fiber.dispose()
    release.resolve(undefined)
    await pending
    await disposal
    expect(await readdir(root)).toEqual([])
  } finally {
    release.resolve(undefined)
    spy.mockRestore()
  }
})
