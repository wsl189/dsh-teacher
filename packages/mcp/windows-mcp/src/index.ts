/**
 * Opt-in Windows desktop automation composition. The plugin mounts the bundled
 * Windows-MCP Python server through the generic MCP client, publishes a fixed
 * desktop-only tool set, and requires DSH approval before every call.
 * @module @deepseek-ai/dsh-windows-mcp
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'windows-mcp'

/** Services required to mount the MCP child and protect its tool calls. */
export const inject = ['loader', 'tools']

/** Settings namespace rendered by the built-in Plugins page. */
export const WINDOWS_MCP_SETTINGS_NAMESPACE = settingsNamespace('windows-mcp')

/** Loader specifier for the generic bridge mounted by this composition plugin. */
export const WINDOWS_MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

/** Stable MCP namespace used in every model-facing tool name. */
export const WINDOWS_MCP_SERVER_NAME = 'windows'

/**
 * Reviewed Windows-MCP tools that interact with visible desktop UI only.
 * Shell, registry, process, clipboard, filesystem, notification, and scrape
 * capabilities remain absent from both upstream discovery and DSH registration.
 */
export const WINDOWS_MCP_ALLOWED_TOOLS = Object.freeze([
  'App',
  'Click',
  'DisplayInventory',
  'Move',
  'MultiEdit',
  'MultiSelect',
  'Screenshot',
  'Scroll',
  'Shortcut',
  'Snapshot',
  'Type',
  'Wait',
  'WaitFor',
] as const)

/** Public names protected by the approval listener. */
export const WINDOWS_MCP_PUBLIC_TOOLS: ReadonlySet<string> = new Set(
  WINDOWS_MCP_ALLOWED_TOOLS.map(rawName => `mcp__${WINDOWS_MCP_SERVER_NAME}__${rawName}`),
)

const WINDOWS_MCP_PUBLIC_PREFIX = `mcp__${WINDOWS_MCP_SERVER_NAME}__`
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** User and composition configuration for the bundled Windows-MCP runtime. */
export interface Config {
  /** Whether the Windows desktop tool server is mounted. Defaults to false. */
  enabled?: boolean
  /** Absolute bundled Python executable, or another trusted Python command. */
  runtimeCommand?: string
  /** Working directory for the bundled Python runtime. */
  runtimeCwd?: string
  /** Deadline for each MCP desktop tool call in milliseconds. */
  toolCallTimeoutMs?: number
}

/** Fully resolved configuration consumed by reconciliation. */
export interface ResolvedConfig {
  /** Whether the Windows desktop tool server is mounted. */
  readonly enabled: boolean
  /** Executable used for the Windows-MCP child. */
  readonly runtimeCommand: string
  /** Working directory used for the Windows-MCP child. */
  readonly runtimeCwd: string
  /** Deadline for each MCP desktop tool call in milliseconds. */
  readonly toolCallTimeoutMs: number
}

/** Validated settings schema; the runtime path is supplied by the desktop launcher. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  runtimeCommand: z.string().default(''),
  runtimeCwd: z.string().default(''),
  toolCallTimeoutMs: z.natural().min(1).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
})

/**
 * Resolve defaults and numeric constraints before mounting a child.
 * @param config - composition or resolved user-settings values.
 * @returns complete executable configuration.
 */
export function resolveWindowsMcpConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    enabled: config.enabled ?? false,
    runtimeCommand: config.runtimeCommand ?? '',
    runtimeCwd: config.runtimeCwd ?? '',
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
  }
  if (!Number.isInteger(resolved.toolCallTimeoutMs) || resolved.toolCallTimeoutMs < 1) {
    throw new Error('windows-mcp: toolCallTimeoutMs must be a positive integer')
  }
  return Object.freeze(resolved)
}

/**
 * Build the exact generic-client row used for the bundled stdio child.
 * @param config - complete Windows-MCP runtime configuration.
 * @returns MCP client configuration with two independent copies of the tool allowlist.
 */
export function createWindowsMcpClientConfig(config: ResolvedConfig): McpClientConfig {
  const includeTools = [...WINDOWS_MCP_ALLOWED_TOOLS]
  return {
    transport: 'stdio',
    serverName: WINDOWS_MCP_SERVER_NAME,
    command: config.runtimeCommand,
    args: [
      '-m',
      'windows_mcp',
      'serve',
      '--transport',
      'stdio',
      '--tools',
      includeTools.join(','),
    ],
    env: {
      ANONYMIZED_TELEMETRY: 'false',
      NO_COLOR: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      WINDOWS_MCP_WATCHDOG: 'off',
    },
    cwd: config.runtimeCwd,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    includeTools,
    failOnStartupError: true,
    reconnect: {
      enabled: true,
      initialDelayMs: 500,
      maxDelayMs: 30_000,
      maxAttempts: 10,
    },
  }
}

/**
 * Ask after all downstream pre-execute policy permits an allowed Windows tool;
 * deny any unreviewed name that somehow appears in the reserved namespace.
 * @param toolName - model-facing ToolRuntime name.
 * @param next - downstream policy decision.
 * @returns downstream denial/approval request, or this plugin's final decision.
 */
export async function decideWindowsMcpCall(
  toolName: string,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  if (!toolName.startsWith(WINDOWS_MCP_PUBLIC_PREFIX)) return next()
  const downstream = await next()
  if (downstream.kind === 'deny') return downstream
  if (!WINDOWS_MCP_PUBLIC_TOOLS.has(toolName)) {
    return { kind: 'deny', reason: `Windows MCP tool "${toolName}" is not in the built-in allowlist` }
  }
  if (downstream.kind !== 'allow') return downstream
  return {
    kind: 'ask',
    reason: 'Windows desktop automation can read or control applications outside the DSH sandbox',
  }
}

interface ActiveMount {
  readonly entryId: string
  readonly stopPolicy: () => boolean
}

/** Stable comparison key for values that require remounting the stdio child. */
function mountSignature(config: ResolvedConfig): string {
  return JSON.stringify([config.enabled, config.runtimeCommand, config.runtimeCwd, config.toolCallTimeoutMs])
}

/**
 * Reconcile the live Loader child with composition and user settings. The
 * generic client is a real Loader entry, so its activation and teardown retain
 * ordinary transaction, HMR, and dependency behavior.
 * @param ctx - plugin context carrying Loader, tools, and optional settings.
 * @param entryConfig - composition-layer defaults, including the launcher-owned runtime path.
 */
export async function apply(ctx: Context, entryConfig: Config): Promise<void> {
  let source: () => Config = () => entryConfig
  let active: ActiveMount | undefined
  let attemptedSignature: string | undefined
  let stopping = false
  let tail: Promise<void> = Promise.resolve()

  const unmount = async (): Promise<void> => {
    const mounted = active
    if (mounted === undefined) return
    // Keep the approval policy live if Loader cannot prove the child and its
    // registrations are gone. A later settings change or parent teardown can
    // retry removal without leaving residual desktop tools unprotected.
    if (ctx.loader.store[mounted.entryId] !== undefined) await ctx.loader.remove(mounted.entryId)
    active = undefined
    mounted.stopPolicy()
  }

  const reconcile = async (): Promise<void> => {
    if (stopping) return
    const config = resolveWindowsMcpConfig(source())
    const signature = mountSignature(config)
    if (attemptedSignature === signature) return
    if (!config.enabled || config.runtimeCommand.trim().length === 0) {
      await unmount()
      attemptedSignature = signature
      if (config.enabled) {
        ctx.logger.error('windows-mcp: enabled but the bundled runtime is unavailable; desktop tools remain disabled')
      }
      return
    }
    await unmount()
    const stopPolicy = ctx.on('tools/pre-execute', (exec, next) => decideWindowsMcpCall(exec.name, next))
    try {
      const entryId = await ctx.loader.create({
        name: WINDOWS_MCP_CLIENT_PACKAGE,
        config: createWindowsMcpClientConfig(config),
      })
      active = { entryId, stopPolicy }
      attemptedSignature = signature
    } catch (error) {
      attemptedSignature = signature
      stopPolicy()
      throw error
    }
  }

  const enqueue = (): Promise<void> => {
    const run = tail.then(reconcile)
    tail = run.catch(() => undefined)
    return run
  }

  ctx.effect(() => async () => {
    stopping = true
    await tail
    await unmount()
  }, 'windows-mcp: mounted client')

  let activating = true
  let startup: Promise<void> | undefined
  installSettingsSection(ctx, WINDOWS_MCP_SETTINGS_NAMESPACE, Config, entryConfig, {
    validate: (value) => { resolveWindowsMcpConfig(value) },
    setSource: (current) => { source = current },
    onChange: () => {
      const run = enqueue()
      if (activating) startup = run
      else void run.catch((error: unknown) => {
        ctx.logger.error('windows-mcp: failed to apply settings change', error)
      })
    },
  })
  startup ??= enqueue()
  try {
    await startup
  } catch (error) {
    ctx.logger.error('windows-mcp: failed to apply settings change', error)
  } finally {
    activating = false
  }
}
