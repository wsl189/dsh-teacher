/** Renderer-facing contract exposed by the Electron preload. */

/** Update lifecycle projected by the desktop main process. */
export type DesktopUpdateState =
  | { status: 'checking' }
  | { status: 'up-to-date' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; version: string; message: string }

/**
 * Narrow an untrusted preload value to the update-state discriminated union.
 * @param value - value copied across the context-isolation bridge.
 * @returns whether every field required by its status is valid.
 */
export function isDesktopUpdateState(value: unknown): value is DesktopUpdateState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  switch (candidate.status) {
    case 'checking':
    case 'up-to-date':
      return true
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

/** Context-isolated Electron API available only inside the installed desktop app. */
export interface DesktopUpdateBridge {
  /** Return the preload's current immutable state snapshot. */
  getState(): DesktopUpdateState
  /** Register a state listener and return its numeric subscription id. */
  subscribe(listener: (state: DesktopUpdateState) => void): number
  /** Remove one state listener previously registered through {@link subscribe}. */
  unsubscribe(id: number): void
  /** Download the available installer through electron-updater. */
  download(): Promise<void>
  /** Restart into the downloaded installer. */
  install(): Promise<void>
}

declare global {
  interface Window {
    /** Present only in the context-isolated Electron renderer. */
    dshDesktopUpdate?: DesktopUpdateBridge
  }
}
