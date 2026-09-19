/** Real tool execution and Session lifecycle for temporary Office work. */
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
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
  return { root, ctx, fiber, agent, harness, call, create }
}

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
