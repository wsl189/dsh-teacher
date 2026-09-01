/** State machine over electron-updater, kept independent from Electron globals for tests. */

import type { DesktopUpdateState } from './update-protocol.ts'

/** Polling cadence for installed builds that have not found a newer Release. */
export const DESKTOP_UPDATE_CHECK_INTERVAL_MS = 5 * 60_000

/** Minimal update metadata consumed from electron-updater events. */
interface UpdateInfoLike {
  /** SemVer selected by the provider. */
  version: string
}

/** Minimal progress metadata consumed from electron-updater events. */
interface ProgressInfoLike {
  /** Download completion percentage. */
  percent: number
}

/** Typed event roster used by {@link AutoUpdaterLike}. */
export interface AutoUpdaterEventMap {
  'checking-for-update': () => void
  'update-available': (info: UpdateInfoLike) => void
  'update-not-available': (info: UpdateInfoLike) => void
  'download-progress': (progress: ProgressInfoLike) => void
  'update-downloaded': (info: UpdateInfoLike) => void
  'error': (error: Error) => void
}

/** The electron-updater methods and settings the desktop shell owns. */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  on<K extends keyof AutoUpdaterEventMap>(event: K, listener: AutoUpdaterEventMap[K]): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

/** Logging surface used for background check failures. */
interface UpdateLogger {
  /** Record normal updater progress. */
  info(message: string): void
  /** Record a recoverable updater failure. */
  warn(message: string): void
}

/** Construction inputs controlled by the Electron main process. */
export interface DesktopUpdateControllerOptions {
  /** Whether this is an installed build with generated provider metadata. */
  enabled: boolean
  /** Current app version; prerelease installs opt into prerelease Releases. */
  currentVersion: string
  /** Publish every state replacement to preload listeners. */
  publish: (state: DesktopUpdateState) => void
  /** Stop the DSH backend before the installer replaces files. */
  beforeInstall: () => Promise<void>
  /** Main-process log sink. */
  logger: UpdateLogger
}

/** Electron update state machine exposed through the preload bridge. */
export class DesktopUpdateController {
  private snapshot: DesktopUpdateState = Object.freeze({ status: 'checking' })
  private targetVersion: string | undefined
  private checkInterval: ReturnType<typeof setInterval> | undefined
  private checkInFlight: Promise<void> | undefined

  /**
   * @param updater - electron-updater adapter.
   * @param options - packaging, publication, teardown, and logging controls.
   */
  constructor(
    private readonly updater: AutoUpdaterLike,
    private readonly options: DesktopUpdateControllerOptions,
  ) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.allowPrerelease = options.currentVersion.includes('-')
    updater.on('checking-for-update', () => { this.set({ status: 'checking' }) })
    updater.on('update-available', (info) => {
      this.targetVersion = info.version
      this.set({ status: 'available', version: info.version })
    })
    updater.on('update-not-available', () => {
      this.targetVersion = undefined
      this.set({ status: 'up-to-date', version: options.currentVersion })
    })
    updater.on('download-progress', (progress) => {
      if (this.targetVersion === undefined) return
      this.set({ status: 'downloading', version: this.targetVersion, percent: progress.percent })
    })
    updater.on('update-downloaded', (info) => {
      this.targetVersion = info.version
      this.set({ status: 'downloaded', version: info.version })
    })
    updater.on('error', (error) => { this.fail(error) })
  }

  /** Return the current immutable updater projection. */
  getState = (): DesktopUpdateState => this.snapshot

  /** Check at startup and every five minutes until a newer Release is found. */
  async start(): Promise<void> {
    if (!this.options.enabled) {
      this.set({ status: 'up-to-date', version: this.options.currentVersion })
      return
    }
    if (this.checkInterval !== undefined) {
      if (this.checkInFlight !== undefined) await this.checkInFlight
      return
    }
    this.checkInterval = setInterval(() => { void this.check() }, DESKTOP_UPDATE_CHECK_INTERVAL_MS)
    await this.check()
  }

  /** Stop periodic checks before application shutdown. */
  stop(): void {
    if (this.checkInterval === undefined) return
    clearInterval(this.checkInterval)
    this.checkInterval = undefined
  }

  /** Share an active provider request and skip checks after finding an update. */
  private check(): Promise<void> {
    if (this.checkInFlight !== undefined) return this.checkInFlight
    if (this.targetVersion !== undefined) return Promise.resolve()
    this.set({ status: 'checking' })
    const operation = this.performCheck().finally(() => { this.checkInFlight = undefined })
    this.checkInFlight = operation
    return operation
  }

  /** Run one recoverable provider request. */
  private async performCheck(): Promise<void> {
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.fail(error)
    }
  }

  /** Download the available Release, preserving a retry state on failure. */
  async download(): Promise<void> {
    if (this.targetVersion === undefined) throw new Error('no desktop update is available')
    this.set({ status: 'downloading', version: this.targetVersion, percent: 0 })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  /** Stop the backend and restart into the already downloaded installer. */
  async install(): Promise<void> {
    if (this.snapshot.status !== 'downloaded') throw new Error('desktop update is not downloaded')
    await this.options.beforeInstall()
    this.updater.quitAndInstall(false, true)
  }

  /** Publish one state replacement. */
  private set(state: DesktopUpdateState): void {
    this.snapshot = Object.freeze(state)
    this.options.publish(this.snapshot)
  }

  /** Hide background-check failures; preserve visible download failures as retry state. */
  private fail(reason: unknown): void {
    const message = reason instanceof Error ? reason.message : String(reason)
    if (this.targetVersion === undefined) {
      this.options.logger.warn(`desktop update check failed: ${message}`)
      this.set({ status: 'up-to-date', version: this.options.currentVersion })
      return
    }
    this.options.logger.warn(`desktop update for ${this.targetVersion} failed: ${message}`)
    this.set({ status: 'error', version: this.targetVersion, message })
  }
}
