/** Resolve backend paths supplied by Electron and the packaged desktop payload. */

import { join } from 'node:path'

export const PPT_MASTER_ARCHIVE_NAME = 'ppt-master.tgz'

/** Inputs used to resolve the backend's desktop and bundled skill paths. */
export interface RuntimeEnvironmentOptions {
  /** Ambient environment inherited by the backend. */
  readonly env: NodeJS.ProcessEnv
  /** Whether Electron is running from an installed/package directory. */
  readonly packaged: boolean
  /** Electron resources directory containing extraResources. */
  readonly resourcesPath: string
  /** System desktop directory reported by Electron, including relocated desktops. */
  readonly desktopPath: string
}

/**
 * Build the backend environment with Electron's system desktop directory.
 * Packaged builds resolve bundled skills from Electron's resources directory.
 * @param options - ambient process facts and Electron paths.
 * @returns a detached backend environment.
 */
export function resolveRuntimeEnvironment(options: RuntimeEnvironmentOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...options.env, DSH_DESKTOP_DIR: options.desktopPath }
  if (!options.packaged) return env
  delete env.DSH_PPT_MASTER_ARCHIVE
  env.DSH_PPT_MASTER_ARCHIVE = join(options.resourcesPath, PPT_MASTER_ARCHIVE_NAME)
  return env
}
