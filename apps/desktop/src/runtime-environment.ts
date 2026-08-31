/** Resolve backend environment variables owned by the packaged desktop payload. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Inputs used to resolve the backend's Windows-MCP runtime variables. */
export interface RuntimeEnvironmentOptions {
  /** Ambient environment inherited by the backend. */
  readonly env: NodeJS.ProcessEnv
  /** Whether Electron is running from an installed/package directory. */
  readonly packaged: boolean
  /** Electron resources directory containing extraResources. */
  readonly resourcesPath: string
  /** File probe overridden by platform-neutral tests. */
  readonly exists?: (path: string) => boolean
}

/**
 * Build the backend environment. Installed builds trust only the runtime
 * shipped beside the app, clearing ambient overrides when that payload is
 * incomplete; source runs retain explicit developer-provided variables.
 * @param options - ambient process facts and optional test probe.
 * @returns a detached backend environment.
 */
export function resolveRuntimeEnvironment(options: RuntimeEnvironmentOptions): NodeJS.ProcessEnv {
  const env = { ...options.env }
  if (!options.packaged) return env
  delete env.DSH_WINDOWS_MCP_COMMAND
  delete env.DSH_WINDOWS_MCP_RUNTIME_ROOT
  const runtimeRoot = join(options.resourcesPath, 'windows-mcp')
  const command = join(runtimeRoot, 'python.exe')
  if ((options.exists ?? existsSync)(command)) {
    env.DSH_WINDOWS_MCP_COMMAND = command
    env.DSH_WINDOWS_MCP_RUNTIME_ROOT = runtimeRoot
  }
  return env
}
