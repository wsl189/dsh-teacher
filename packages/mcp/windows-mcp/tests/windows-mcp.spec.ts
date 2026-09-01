import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import type { AppReady } from '@deepseek-ai/dsh-cmdline'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService, { setApprovalPolicy, type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import * as WindowsMcp from '../src/index.ts'
import * as WindowsMcpInvariant from '../src/invariant.ts'
import { installWindowsMcpPolicy } from '../src/permissions.ts'

/** Writable in-memory settings provider used by the live-enable composition case. */
class MemorySettings extends SettingsProvider {
  private readonly stored: Record<string, unknown> = {}
  override readonly writable = true

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.stored))
  }

  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.stored[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface CompositionResult {
  readonly ctx: Context
  readonly captured: McpClientConfig[]
  readonly executions: { count: number }
}

interface FakeMcpBehavior {
  readonly runtimeCommand?: string
  readonly beforeLoad?: (ctx: Context) => void
  readonly failCwd?: string
  readonly block?: {
    readonly cwd: string
    readonly entered: PromiseWithResolvers<boolean>
    readonly release: PromiseWithResolvers<boolean>
  }
}

/** Controllable launcher readiness with the production one-shot listener semantics. */
function controlledAppReady(): { readonly service: AppReady; commit(): void } {
  let ready = false
  const listeners = new Set<() => void>()
  return {
    service: {
      onReady(listener) {
        if (ready) {
          listener()
          return () => {}
        }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit() {
      if (ready) return
      ready = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

/** Replace the context logger with an error collector for startup assertions. */
function collectErrors(ctx: Context, errors: unknown[][]): void {
  ctx.logger.error = ((...args: unknown[]) => { errors.push(args) }) as typeof ctx.logger.error
}

/** Assert the most recent reconciliation diagnostic and its optional cause. */
function expectReconcileError(errors: readonly (readonly unknown[])[], detail?: string): void {
  const [message, error] = errors.at(-1) ?? []
  expect(message).toBe('windows-mcp: failed to apply settings change')
  if (detail === undefined) return
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(detail)
}

/** Register a scoped caller with a real session log; these tests do not run a model loop. */
async function sessionAgent(ctx: Context, id: string): Promise<Agent> {
  const session = ctx.sessions.create(SessionId(id))
  const agent = { id: session.id, session } as Agent
  await ctx.plugin({
    inject: ['tools'],
    apply(scope) { Object.assign(agent, { ctx: createScope(scope, agent).ctx }) },
  })
  ctx.agents.register(agent)
  return agent
}

/** Execute through the real registry and permission chain. */
function execute(ctx: Context, agent: Agent, name = 'mcp__windows__Snapshot') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: `windows-call-${String(agent.session.events.length)}` as never,
    name,
    arguments: {},
    agent,
  })
}

/** Boot the package from a real cordis.yml through the vendored Loader. */
async function bootComposition(enabled?: boolean, behavior: FakeMcpBehavior = {}): Promise<CompositionResult> {
  root = await mkdtemp(join(tmpdir(), 'dsh-windows-mcp-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-settings'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-windows-mcp'",
    '  config:',
    ...enabled === undefined ? [] : [`    enabled: ${String(enabled)}`],
    `    runtimeCommand: ${JSON.stringify(behavior.runtimeCommand ?? 'fake-python.exe')}`,
    '    runtimeCwd: C:/bundled/windows-mcp',
    '    toolCallTimeoutMs: 4321',
    '',
  ].join('\n'))

  const captured: McpClientConfig[] = []
  const executions = { count: 0 }
  const fakeMcpClient = {
    name: 'fake-mcp-client',
    inject: ['tools'],
    async apply(ctx: Context, config: McpClientConfig): Promise<void> {
      captured.push(config)
      if (config.transport === 'stdio' && config.cwd === behavior.failCwd) {
        throw new Error(`fake MCP startup failed in ${config.cwd}`)
      }
      if (config.transport === 'stdio' && config.cwd === behavior.block?.cwd) {
        behavior.block.entered.resolve(true)
        await behavior.block.release.promise
      }
      for (const rawName of config.includeTools ?? []) {
        ctx.tools.register({
          name: `mcp__${config.serverName}__${rawName}`,
          description: rawName,
          parameters: { type: 'object' },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value as string }],
          },
          execute: async () => {
            executions.count++
            return 'executed'
          },
        })
      }
    },
  }

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-settings', MemorySettings],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-windows-mcp', WindowsMcp],
    ['@deepseek-ai/dsh-mcp-client', fakeMcpClient],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  behavior.beforeLoad?.(context)
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return { ctx: context, captured, executions }
}

describe('configuration and policy', () => {
  it('matches the allowlist exercised by the packaged Python smoke', async () => {
    const smoke = await readFile(
      new URL('../../../../third-party/windows-mcp/smoke.py', import.meta.url),
      'utf8',
    )
    const block = /EXPECTED_TOOLS = \{(?<body>[\s\S]*?)\n\}/u.exec(smoke)?.groups?.body
    if (block === undefined) throw new Error('expected a Python EXPECTED_TOOLS set')
    const runtimeTools = [...block.matchAll(/^\s+"(?<name>[^"]+)",$/gmu)]
      .map(match => match.groups?.name)
    expect(runtimeTools).not.toContain(undefined)
    expect(runtimeTools.sort()).toEqual([...WindowsMcp.WINDOWS_MCP_ALLOWED_TOOLS].sort())
  })

  it('resolves defaults while treating runtime availability as deployment state', () => {
    expect(WindowsMcp.resolveWindowsMcpConfig({})).toMatchObject({
      enabled: true,
      runtimeCommand: '',
      runtimeCwd: '',
      toolCallTimeoutMs: 180_000,
      samplingMaxInputBytes: 1_048_576,
      samplingMaxOutputTokens: 2_048,
    })
    expect(WindowsMcp.resolveWindowsMcpConfig({ enabled: false })).toMatchObject({
      enabled: false,
      runtimeCommand: '',
      toolCallTimeoutMs: 180_000,
    })
    expect(WindowsMcp.resolveWindowsMcpConfig({ enabled: true })).toMatchObject({
      enabled: true,
      runtimeCommand: '',
    })
    expect(() => WindowsMcp.resolveWindowsMcpConfig({ toolCallTimeoutMs: 0 }))
      .toThrow('toolCallTimeoutMs must be a positive integer')
    expect(() => WindowsMcp.resolveWindowsMcpConfig({ toolCallTimeoutMs: 1.5 }))
      .toThrow('toolCallTimeoutMs must be a positive integer')
    expect(() => WindowsMcp.resolveWindowsMcpConfig({ samplingMaxInputBytes: 0 }))
      .toThrow('samplingMaxInputBytes must be a positive safe integer')
    expect(() => WindowsMcp.resolveWindowsMcpConfig({ samplingMaxOutputTokens: 1.5 }))
      .toThrow('samplingMaxOutputTokens must be a positive safe integer')
  })

  it('preserves downstream denial and rejects unreviewed reserved names', async () => {
    await expect(WindowsMcp.decideWindowsMcpCall('bash', async () => ({ kind: 'allow' })))
      .resolves.toEqual({ kind: 'allow' })
    await expect(WindowsMcp.decideWindowsMcpCall('mcp__windows__Snapshot', async () => ({
      kind: 'deny', reason: 'deployment denied',
    }))).resolves.toEqual({ kind: 'deny', reason: 'deployment denied' })
    await expect(WindowsMcp.decideWindowsMcpCall('mcp__windows__PowerShell', async () => ({ kind: 'allow' })))
      .resolves.toMatchObject({ kind: 'deny' })
    await expect(WindowsMcp.decideWindowsMcpCall('mcp__windows__PowerShell', async () => ({
      kind: 'ask', reason: 'downstream approval',
    }))).resolves.toMatchObject({ kind: 'deny' })
    await expect(WindowsMcp.decideWindowsMcpCall('mcp__windows__Snapshot', async () => ({
      kind: 'ask', reason: 'deployment approval',
    }))).resolves.toEqual({ kind: 'ask', reason: 'deployment approval' })
  })

  it('requires a recorded full-access mode, not disabled approval prompts', async () => {
    const session = Session.create(SessionId('windows-policy'))
    const decide = () => WindowsMcp.decideWindowsMcpCall('mcp__windows__Snapshot', async () => ({ kind: 'allow' }), session)
    await expect(decide()).resolves.toMatchObject({ kind: 'ask' })
    setApprovalPolicy(session, 'never')
    await expect(decide()).resolves.toMatchObject({ kind: 'ask' })
    setSandboxMode(session, 'read-only')
    await expect(decide()).resolves.toMatchObject({ kind: 'ask' })
    setSandboxMode(session, 'workspace-write')
    await expect(decide()).resolves.toMatchObject({ kind: 'ask' })
    setSandboxMode(session, 'danger-full-access')
    await expect(decide()).resolves.toEqual({ kind: 'allow' })
    setSandboxMode(session, 'workspace-write')
    await expect(decide()).resolves.toMatchObject({ kind: 'ask' })
  })

  it('opens the complete pinned catalog in full access without bypassing downstream policy', async () => {
    const session = Session.create(SessionId('windows-full-access'))
    setSandboxMode(session, 'danger-full-access')
    const denial = { kind: 'deny', reason: 'deployment denied' } as const
    const approval = { kind: 'ask', reason: 'deployment approval' } as const
    await expect(WindowsMcp.decideWindowsMcpCall('mcp__windows__Snapshot', async () => denial, session))
      .resolves.toBe(denial)
    await expect(WindowsMcp.decideWindowsMcpCall('mcp__windows__Snapshot', async () => approval, session))
      .resolves.toBe(approval)
    await expect(WindowsMcp.decideWindowsMcpCall('mcp__windows__PowerShell', async () => ({ kind: 'allow' }), session))
      .resolves.toMatchObject({ kind: 'allow' })
    await expect(WindowsMcp.decideWindowsMcpCall('mcp__windows__Unreviewed', async () => ({ kind: 'allow' }), session))
      .resolves.toMatchObject({ kind: 'deny' })
  })

  it('reads a downgrade made while downstream policy is pending', async () => {
    const session = Session.create(SessionId('windows-pending-policy'))
    setSandboxMode(session, 'danger-full-access')
    const gate = Promise.withResolvers<{ kind: 'allow' }>()
    const deciding = WindowsMcp.decideWindowsMcpCall('mcp__windows__Snapshot', () => gate.promise, session)
    setSandboxMode(session, 'workspace-write')
    gate.resolve({ kind: 'allow' })
    await expect(deciding).resolves.toMatchObject({ kind: 'ask' })
  })
})

describe('real Loader composition', () => {
  it('settles the app before starting the bundled runtime when launcher readiness is available', async () => {
    const ready = controlledAppReady()
    const entered = Promise.withResolvers<boolean>()
    const release = Promise.withResolvers<boolean>()
    const result = await bootComposition(true, {
      block: { cwd: 'C:/bundled/windows-mcp', entered, release },
      beforeLoad(ctx) { ctx.provide('appReady', ready.service) },
    })

    expect(result.captured).toEqual([])
    expect([...result.ctx.loader.entries()].some(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client'))
      .toBe(false)

    ready.commit()
    await Promise.resolve()
    expect(result.captured).toEqual([])
    await entered.promise
    expect(result.captured).toHaveLength(1)
    release.resolve(true)
    await vi.waitFor(() => { expect(result.ctx.tools.get('mcp__windows__Snapshot')).toBeDefined() })
  })

  it('cancels a deferred bundled runtime when the profile exits before readiness', async () => {
    const ready = controlledAppReady()
    const result = await bootComposition(true, {
      beforeLoad(ctx) { ctx.provide('appReady', ready.service) },
    })

    await result.ctx.fiber.dispose()
    context = undefined
    ready.commit()
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(result.captured).toEqual([])
  })

  it('guards system tools and unknown names even if another listener returns allow', async () => {
    const { ctx, executions } = await bootComposition(true)
    const agent = await sessionAgent(ctx, 'windows-final-guard')
    const tool = ctx.tools.get('mcp__windows__PowerShell')
    if (tool === undefined) throw new Error('expected the pinned PowerShell tool')
    agent.ctx.tools.register(tool)
    ctx.tools.register({ ...tool, name: 'mcp__windows__Unreviewed' })
    ctx.tools.register({ ...tool, name: 'ordinary-tool' })
    ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }), { prepend: true })

    await expect(execute(ctx, agent, tool.name)).resolves.toMatchObject({ isError: true })
    expect(executions.count).toBe(0)
    setSandboxMode(agent.session, 'danger-full-access')
    await expect(execute(ctx, agent, tool.name)).resolves.toMatchObject({ isError: false })
    await expect(execute(ctx, agent, 'mcp__windows__Unreviewed')).resolves.toMatchObject({ isError: true })
    await expect(execute(ctx, agent, 'ordinary-tool')).resolves.toMatchObject({ isError: false })
    expect(executions.count).toBe(2)
  })

  it('updates existing scopes on enable, rediscovery, and re-enable', async () => {
    const { ctx, captured } = await bootComposition(false)
    const restricted = await sessionAgent(ctx, 'windows-existing-restricted')
    const full = await sessionAgent(ctx, 'windows-existing-full')
    setSandboxMode(full.session, 'danger-full-access')

    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { enabled: true })
    await vi.waitFor(() => { expect(ctx.tools.schemas(full)).toHaveLength(20) })
    expect(ctx.tools.schemas(restricted)).toHaveLength(13)
    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => { expect(ctx.tools.schemas(full)).toEqual([]) })
    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { enabled: true })
    await vi.waitFor(() => { expect(ctx.tools.schemas(full)).toHaveLength(20) })
    expect(ctx.tools.schemas(restricted)).toHaveLength(13)
    expect(captured).toHaveLength(2)
  })

  it('cleans scoped restrictions before ignoring an already-dispatched discovery callback', async () => {
    const { ctx } = await bootComposition(true)
    const agent = await sessionAgent(ctx, 'windows-disposed-policy')
    let stop = () => {}
    await ctx.plugin({
      inject: ['tools', 'agents'],
      apply(scope) { stop = installWindowsMcpPolicy(scope) },
    })
    ctx.on('tools/change', () => { stop() }, { prepend: true })
    const tool = ctx.tools.get('mcp__windows__PowerShell')
    if (tool === undefined) throw new Error('expected the pinned PowerShell tool')
    ctx.tools.register({ ...tool, name: 'ordinary-tool' })
    setSandboxMode(agent.session, 'danger-full-access')
    expect(ctx.tools.get(tool.name, agent)).toBeDefined()
  })

  it('follows live session modes without remounting or granting other sessions full access', async () => {
    const { ctx, captured, executions } = await bootComposition(true)
    await ctx.plugin(ApprovalService)
    const agent = await sessionAgent(ctx, 'windows-switching')
    const otherAgent = await sessionAgent(ctx, 'windows-restricted')
    const session = agent.session
    const other = otherAgent.session
    session.append('turn/start', { turn: 1 })
    other.append('turn/start', { turn: 1 })
    const answer = vi.fn<() => Promise<ApprovalOutcome>>().mockResolvedValue('allowed-once')
    ctx.on('approval/request', answer)

    setSandboxMode(session, 'workspace-write')
    setApprovalPolicy(session, 'ask')
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(WindowsMcp.WINDOWS_MCP_DESKTOP_TOOLS.map(tool => `mcp__windows__${tool}`))
    await expect(execute(ctx, agent)).resolves.toMatchObject({ isError: false })
    expect(answer).toHaveBeenCalledTimes(1)

    setSandboxMode(session, 'danger-full-access')
    setApprovalPolicy(session, 'never')
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual([...WindowsMcp.WINDOWS_MCP_PUBLIC_TOOLS])
    await expect(execute(ctx, agent, 'mcp__windows__PowerShell')).resolves.toMatchObject({ isError: false })
    expect(answer).toHaveBeenCalledTimes(1)
    expect(session.events.filter(event => event.type === 'approval/asked')).toHaveLength(1)

    setSandboxMode(other, 'read-only')
    setApprovalPolicy(other, 'never')
    expect(ctx.tools.get('mcp__windows__PowerShell', otherAgent)).toBeUndefined()
    await expect(execute(ctx, otherAgent, 'mcp__windows__PowerShell')).resolves.toMatchObject({ isError: true })
    await expect(execute(ctx, otherAgent)).resolves.toMatchObject({ isError: true })
    expect(executions.count).toBe(2)
    expect(other.events.filter(event => event.type === 'approval/decided'))
      .toMatchObject([{ data: { outcome: 'rejected' } }])

    setSandboxMode(session, 'workspace-write')
    setApprovalPolicy(session, 'ask')
    answer.mockResolvedValue('rejected')
    expect(ctx.tools.get('mcp__windows__PowerShell', agent)).toBeUndefined()
    await expect(execute(ctx, agent)).resolves.toMatchObject({ isError: true })
    expect(answer).toHaveBeenCalledTimes(2)
    expect(executions.count).toBe(2)
    expect(captured).toHaveLength(1)
  })

  it('mounts only the reviewed tools and live-disables the child through settings', async () => {
    const { ctx, captured, executions } = await bootComposition(true)

    expect(captured).toHaveLength(1)
    const child = captured[0]
    if (child?.transport !== 'stdio') throw new Error('expected one stdio MCP child')
    expect(child).toMatchObject({
      transport: 'stdio',
      serverName: 'windows',
      command: 'fake-python.exe',
      cwd: 'C:/bundled/windows-mcp',
      toolCallTimeoutMs: 4321,
      failOnStartupError: true,
      env: {
        ANONYMIZED_TELEMETRY: 'false',
        WINDOWS_MCP_WATCHDOG: 'off',
      },
    })
    expect(child.args).toEqual([
      '-m', 'windows_mcp', 'serve', '--transport', 'stdio', '--tools',
      WindowsMcp.WINDOWS_MCP_ALLOWED_TOOLS.join(','),
    ])
    expect(child.includeTools).toEqual([...WindowsMcp.WINDOWS_MCP_ALLOWED_TOOLS])
    expect([...WindowsMcp.WINDOWS_MCP_PUBLIC_TOOLS].every(tool => ctx.tools.get(tool) !== undefined)).toBe(true)
    const restricted = await sessionAgent(ctx, 'windows-desktop-only')
    expect(ctx.tools.get('mcp__windows__PowerShell', restricted)).toBeUndefined()
    expect(ctx.tools.get('mcp__windows__Registry', restricted)).toBeUndefined()
    expect(ctx.tools.get('mcp__windows__FileSystem', restricted)).toBeUndefined()

    const denied = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'windows-call' as never,
      name: 'mcp__windows__Snapshot',
      arguments: {},
    })
    expect(denied).toMatchObject({ isError: true })
    expect(denied.content[0]).toMatchObject({
      text: 'Error: Windows desktop automation can read or control applications outside the DSH sandbox',
    })
    expect(executions.count).toBe(0)

    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => {
      expect([...WindowsMcp.WINDOWS_MCP_PUBLIC_TOOLS].every(tool => ctx.tools.get(tool) === undefined)).toBe(true)
      expect([...ctx.loader.entries()].some(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
    })
  })

  it('starts the bundled runtime by default and preserves a saved opt-out across remounts', async () => {
    const { ctx, captured } = await bootComposition()
    expect(captured).toHaveLength(1)
    expect(ctx.tools.get('mcp__windows__Snapshot')).toBeDefined()

    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__windows__Snapshot')).toBeUndefined() })
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@deepseek-ai/dsh-windows-mcp')
    if (entry === undefined) throw new Error('expected the Windows-MCP Loader entry')
    await ctx.loader.update(entry.id, { disabled: true })
    expect(ctx.settings.describe().some(row => row.ns === WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE))
      .toBe(false)
    await ctx.loader.update(entry.id, { disabled: false })
    await ctx.loader.await()
    expect(captured).toHaveLength(1)
    expect(ctx.tools.get('mcp__windows__Snapshot')).toBeUndefined()
    expect(ctx.settings.get(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE)).toMatchObject({ enabled: false })
  })

  it('keeps an explicitly disabled built-in child dormant', async () => {
    const { ctx, captured } = await bootComposition(false)
    expect(captured).toEqual([])
    expect([...ctx.loader.entries()].some(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
  })

  it('keeps settings available when the bundled runtime is absent', async () => {
    const errors: unknown[][] = []
    const result = await bootComposition(undefined, {
      runtimeCommand: '',
      beforeLoad: (ctx) => { collectErrors(ctx, errors) },
    })

    expect(result.captured).toEqual([])
    expect(result.ctx.settings.describe().find(row => row.ns === WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE))
      .toMatchObject({ value: { enabled: true, runtimeCommand: '' } })
    expect(errors).toEqual([[
      'windows-mcp: enabled but the bundled runtime is unavailable; desktop tools remain disabled',
    ]])
    await result.ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { enabled: false })
  })

  it('contains an initial child failure so the plugin can still be disabled', async () => {
    const errors: unknown[][] = []
    const result = await bootComposition(true, {
      failCwd: 'C:/bundled/windows-mcp',
      beforeLoad: (ctx) => { collectErrors(ctx, errors) },
    })

    expect(result.captured).toHaveLength(1)
    expectReconcileError(errors, 'fake MCP startup failed')
    expect([...result.ctx.loader.entries()].some(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client'))
      .toBe(false)
    await result.ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { enabled: false })
  })

  it('cleans policy state and reports a later remount failure', async () => {
    const result = await bootComposition(true, { failCwd: 'C:/broken' })
    const errors: unknown[][] = []
    collectErrors(result.ctx, errors)
    await result.ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, {
      runtimeCwd: 'C:/broken',
    })
    await vi.waitFor(() => {
      expect(errors).not.toEqual([])
    })
    expectReconcileError(errors, 'fake MCP startup failed')
  })

  it('retains approval protection when Loader cannot remove the child', async () => {
    const { ctx, executions } = await bootComposition(true)
    const errors: unknown[][] = []
    collectErrors(ctx, errors)
    const remove = vi.spyOn(ctx.loader, 'remove').mockRejectedValueOnce(new Error('fake removal failed'))

    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => { expect(errors).not.toEqual([]) })
    expectReconcileError(errors, 'fake removal failed')

    const denied = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'residual-windows-call' as never,
      name: 'mcp__windows__Snapshot',
      arguments: {},
    })
    expect(denied).toMatchObject({ isError: true })
    expect(executions.count).toBe(0)

    remove.mockRestore()
    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { toolCallTimeoutMs: 9877 })
    await vi.waitFor(() => {
      expect([...ctx.loader.entries()].some(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
    })
  })

  it('tolerates an externally removed child and skips queued reconciliation while stopping', async () => {
    const entered = Promise.withResolvers<boolean>()
    const release = Promise.withResolvers<boolean>()
    const { ctx } = await bootComposition(true, {
      block: { cwd: 'C:/blocked', entered, release },
    })

    const child = [...ctx.loader.entries()]
      .find(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client')
    if (child === undefined) throw new Error('expected mounted MCP child')
    await ctx.loader.remove(child.id)
    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => {
      expect([...ctx.loader.entries()].some(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
    })

    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, {
      enabled: true,
      runtimeCwd: 'C:/blocked',
    })
    await entered.promise
    await ctx.settings.update(WindowsMcp.WINDOWS_MCP_SETTINGS_NAMESPACE, { toolCallTimeoutMs: 9876 })
    const windowsEntry = [...ctx.loader.entries()]
      .find(entry => entry.options.name === '@deepseek-ai/dsh-windows-mcp')
    if (windowsEntry?.fiber === undefined) throw new Error('expected mounted Windows-MCP composition')
    const stopping = windowsEntry.fiber.dispose()
    release.resolve(true)
    await stopping

    expect([...ctx.loader.entries()].some(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
  })
})

describe('invariant companion', () => {
  it('reserves package ownership with an explained empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(WindowsMcpInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
