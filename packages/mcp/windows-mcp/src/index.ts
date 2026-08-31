/**
 * Windows desktop automation composition. The plugin mounts the bundled
 * Windows-MCP Python server through the generic MCP client, publishes a fixed
 * version-pinned tool set, and grants its complete catalog only in Full access.
 * @module @deepseek-ai/dsh-windows-mcp
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { installWindowsMcpPolicy, WINDOWS_MCP_ALLOWED_TOOLS, WINDOWS_MCP_SERVER_NAME } from './permissions.ts'

export {
  decideWindowsMcpCall, WINDOWS_MCP_ALLOWED_TOOLS, WINDOWS_MCP_DESKTOP_TOOLS,
  WINDOWS_MCP_PUBLIC_TOOLS, WINDOWS_MCP_SERVER_NAME, WINDOWS_MCP_SYSTEM_TOOLS,
} from './permissions.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'windows-mcp'

/** Services required to mount the MCP child and protect its tool calls. */
export const inject = ['loader', 'tools', 'agents']

/** Settings namespace rendered by the built-in Plugins page. */
export const WINDOWS_MCP_SETTINGS_NAMESPACE = settingsNamespace('windows-mcp')

/** Loader specifier for the generic bridge mounted by this composition plugin. */
export const WINDOWS_MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 180_000
const DEFAULT_SAMPLING_INPUT_BYTES = 1_048_576
const DEFAULT_SAMPLING_OUTPUT_TOKENS = 2_048

/** User and composition configuration for the bundled Windows-MCP runtime. */
export interface Config {
  /** Whether the Windows desktop tool server is mounted. Defaults to true; requires a runtime command. */
  enabled?: boolean
  /** Absolute bundled Python executable, or another trusted Python command. */
  runtimeCommand?: string
  /** Working directory for the bundled Python runtime. */
  runtimeCwd?: string
  /** Deadline for each MCP desktop tool call in milliseconds. */
  toolCallTimeoutMs?: number
  /** Maximum UTF-8 bytes in Scrape's auxiliary model request. */
  samplingMaxInputBytes?: number
  /** Maximum generated tokens for Scrape's focused extraction or summary. */
  samplingMaxOutputTokens?: number
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
  /** Auxiliary Scrape request byte ceiling. */
  readonly samplingMaxInputBytes: number
  /** Auxiliary Scrape completion token ceiling. */
  readonly samplingMaxOutputTokens: number
}

/** Validated settings schema; the runtime path is supplied by the desktop launcher. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  runtimeCommand: z.string().default(''),
  runtimeCwd: z.string().default(''),
  toolCallTimeoutMs: z.natural().min(1).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  samplingMaxInputBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_SAMPLING_INPUT_BYTES),
  samplingMaxOutputTokens: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_SAMPLING_OUTPUT_TOKENS),
})

/**
 * Resolve defaults and numeric constraints before mounting a child.
 * @param config - composition or resolved user-settings values.
 * @returns complete executable configuration.
 */
export function resolveWindowsMcpConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    enabled: config.enabled ?? true,
    runtimeCommand: config.runtimeCommand ?? '',
    runtimeCwd: config.runtimeCwd ?? '',
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
    samplingMaxInputBytes: config.samplingMaxInputBytes ?? DEFAULT_SAMPLING_INPUT_BYTES,
    samplingMaxOutputTokens: config.samplingMaxOutputTokens ?? DEFAULT_SAMPLING_OUTPUT_TOKENS,
  }
  if (!Number.isInteger(resolved.toolCallTimeoutMs) || resolved.toolCallTimeoutMs < 1) {
    throw new Error('windows-mcp: toolCallTimeoutMs must be a positive integer')
  }
  for (const field of ['samplingMaxInputBytes', 'samplingMaxOutputTokens'] as const) {
    if (!Number.isSafeInteger(resolved[field]) || resolved[field] < 1) {
      throw new Error(`windows-mcp: ${field} must be a positive safe integer`)
    }
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
    sampling: {
      includeTools: ['Scrape'],
      maxInputBytes: config.samplingMaxInputBytes,
      maxOutputTokens: config.samplingMaxOutputTokens,
    },
    failOnStartupError: true,
    reconnect: {
      enabled: true,
      initialDelayMs: 500,
      maxDelayMs: 30_000,
      maxAttempts: 10,
    },
  }
}

interface ActiveMount {
  readonly entryId: string
  readonly stopPolicy: () => void
}

/** Stable comparison key for values that require remounting the stdio child. */
function mountSignature(config: ResolvedConfig): string {
  return JSON.stringify([
    config.enabled, config.runtimeCommand, config.runtimeCwd, config.toolCallTimeoutMs,
    config.samplingMaxInputBytes, config.samplingMaxOutputTokens,
  ])
}

/**
 * Reconcile the live Loader child with composition and user settings. The
 * generic client is a real Loader entry, so its activation and teardown retain
 * ordinary transaction, HMR, and dependency behavior.
 * @param ctx - plugin context carrying Loader, agents, tools, and optional settings.
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
    const stopPolicy = installWindowsMcpPolicy(ctx)
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
