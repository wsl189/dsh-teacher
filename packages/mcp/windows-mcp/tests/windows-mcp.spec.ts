import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import * as WindowsMcp from '../src/index.ts'
import * as WindowsMcpInvariant from '../src/invariant.ts'

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

/** Boot the package from a real cordis.yml through the vendored Loader. */
async function bootComposition(enabled: boolean, behavior: FakeMcpBehavior = {}): Promise<CompositionResult> {
  root = await mkdtemp(join(tmpdir(), 'dsh-windows-mcp-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-settings'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-windows-mcp'",
    '  config:',
    `    enabled: ${String(enabled)}`,
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
      enabled: false,
      runtimeCommand: '',
      runtimeCwd: '',
      toolCallTimeoutMs: 60_000,
    })
    expect(WindowsMcp.resolveWindowsMcpConfig({ enabled: false })).toMatchObject({
      enabled: false,
      runtimeCommand: '',
      toolCallTimeoutMs: 60_000,
    })
    expect(WindowsMcp.resolveWindowsMcpConfig({ enabled: true })).toMatchObject({
      enabled: true,
      runtimeCommand: '',
    })
    expect(() => WindowsMcp.resolveWindowsMcpConfig({ toolCallTimeoutMs: 0 }))
      .toThrow('toolCallTimeoutMs must be a positive integer')
    expect(() => WindowsMcp.resolveWindowsMcpConfig({ toolCallTimeoutMs: 1.5 }))
      .toThrow('toolCallTimeoutMs must be a positive integer')
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
})

describe('real Loader composition', () => {
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
    expect(ctx.tools.get('mcp__windows__PowerShell')).toBeUndefined()
    expect(ctx.tools.get('mcp__windows__Registry')).toBeUndefined()
    expect(ctx.tools.get('mcp__windows__FileSystem')).toBeUndefined()

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

  it('keeps the built-in child dormant by default', async () => {
    const { ctx, captured } = await bootComposition(false)
    expect(captured).toEqual([])
    expect([...ctx.loader.entries()].some(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
  })

  it('keeps settings available when the bundled runtime is absent', async () => {
    const errors: unknown[][] = []
    const result = await bootComposition(true, {
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
