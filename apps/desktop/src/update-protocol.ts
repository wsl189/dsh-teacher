/** Typed IPC protocol shared by the Electron main and preload entries. */

/** Main/preload channel names kept private to the desktop distribution. */
export const UPDATE_CHANNELS = Object.freeze({
  state: 'dsh:update:state',
  getState: 'dsh:update:get-state',
  download: 'dsh:update:download',
  install: 'dsh:update:install',
})

/** Update lifecycle copied through IPC and the context-isolation bridge. */
export type DesktopUpdateState =
  | { status: 'checking' }
  | { status: 'up-to-date'; version: string }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; version: string; message: string }

/** Renderer API installed into the isolated world by the preload. */
export interface DesktopUpdateBridge {
  /** Return the preload's current update snapshot. */
  getState(): DesktopUpdateState
  /** Add a state listener and return its numeric subscription id. */
  subscribe(listener: (state: DesktopUpdateState) => void): number
  /** Remove one state listener. */
  unsubscribe(id: number): void
  /** Ask the main process to download the selected update. */
  download(): Promise<void>
  /** Ask the main process to restart into the downloaded update. */
  install(): Promise<void>
}

/**
 * Validate one value received from an IPC sender.
 * @param value - untrusted structured-clone payload.
 * @returns whether the payload is a complete update-state member.
 */
export function isDesktopUpdateState(value: unknown): value is DesktopUpdateState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  switch (candidate.status) {
    case 'checking':
      return true
    case 'up-to-date':
    case 'available':
    case 'downloaded':
      return typeof candidate.version === 'string' && candidate.version.length > 0
    case 'downloading':
      return typeof candidate.version === 'string'
        && candidate.version.length > 0
        && typeof candidate.percent === 'number'
        && Number.isFinite(candidate.percent)
    case 'error':
      return typeof candidate.version === 'string'
        && candidate.version.length > 0
        && typeof candidate.message === 'string'
        && candidate.message.length > 0
    default:
      return false
  }
}
