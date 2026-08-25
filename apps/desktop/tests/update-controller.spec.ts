import { describe, expect, it, vi } from 'vitest'
import {
  DesktopUpdateController, type AutoUpdaterEventMap, type AutoUpdaterLike,
} from '../src/update-controller.ts'
import type { DesktopUpdateState } from '../src/update-protocol.ts'

class FakeUpdater implements AutoUpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = false
  allowPrerelease = false
  private readonly checking: AutoUpdaterEventMap['checking-for-update'][] = []
  private readonly available: AutoUpdaterEventMap['update-available'][] = []
  private readonly unavailable: AutoUpdaterEventMap['update-not-available'][] = []
  private readonly progress: AutoUpdaterEventMap['download-progress'][] = []
  private readonly downloaded: AutoUpdaterEventMap['update-downloaded'][] = []
  private readonly errors: AutoUpdaterEventMap['error'][] = []
  checkForUpdates = vi.fn<() => Promise<unknown>>(() => Promise.resolve())
  downloadUpdate = vi.fn<() => Promise<unknown>>(() => Promise.resolve())
  quitAndInstall = vi.fn<(silent?: boolean, force?: boolean) => void>()

  on<K extends keyof AutoUpdaterEventMap>(event: K, listener: AutoUpdaterEventMap[K]): this {
    switch (event) {
      case 'checking-for-update': this.checking.push(listener as AutoUpdaterEventMap['checking-for-update']); break
      case 'update-available': this.available.push(listener as AutoUpdaterEventMap['update-available']); break
      case 'update-not-available': this.unavailable.push(listener as AutoUpdaterEventMap['update-not-available']); break
      case 'download-progress': this.progress.push(listener as AutoUpdaterEventMap['download-progress']); break
      case 'update-downloaded': this.downloaded.push(listener as AutoUpdaterEventMap['update-downloaded']); break
      case 'error': this.errors.push(listener as AutoUpdaterEventMap['error']); break
      default: event satisfies never
    }
    return this
  }

  emitChecking(): void { for (const listener of this.checking) listener() }
  emitAvailable(version: string): void { for (const listener of this.available) listener({ version }) }
  emitUnavailable(version: string): void { for (const listener of this.unavailable) listener({ version }) }
  emitProgress(percent: number): void { for (const listener of this.progress) listener({ percent }) }
  emitDownloaded(version: string): void { for (const listener of this.downloaded) listener({ version }) }
  emitError(error: Error): void { for (const listener of this.errors) listener(error) }
}

function setup(enabled = true, currentVersion = '1.0.0') {
  const updater = new FakeUpdater()
  const published: DesktopUpdateState[] = []
  const beforeInstall = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const logger = { info: vi.fn(), warn: vi.fn() }
  const controller = new DesktopUpdateController(updater, {
    enabled,
    currentVersion,
    publish: (state) => { published.push(state) },
    beforeInstall,
    logger,
  })
  return { updater, published, beforeInstall, logger, controller }
}

describe('DesktopUpdateController', () => {
  it('configures manual download and skips the provider outside an installed build', async () => {
    const b = setup(false, '1.0.0-rc.1')
    expect(b.updater.autoDownload).toBe(false)
    expect(b.updater.autoInstallOnAppQuit).toBe(true)
    expect(b.updater.allowPrerelease).toBe(true)
    await b.controller.start()
    expect(b.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(b.controller.getState()).toEqual({ status: 'up-to-date' })
  })

  it('projects availability, progress, download completion, and the restart install', async () => {
    const b = setup()
    await b.controller.start()
    expect(b.updater.checkForUpdates).toHaveBeenCalledOnce()
    b.updater.emitAvailable('1.1.0')
    expect(b.controller.getState()).toEqual({ status: 'available', version: '1.1.0' })

    await b.controller.download()
    expect(b.updater.downloadUpdate).toHaveBeenCalledOnce()
    b.updater.emitProgress(42.4)
    expect(b.controller.getState()).toEqual({ status: 'downloading', version: '1.1.0', percent: 42.4 })
    b.updater.emitDownloaded('1.1.0')
    await b.controller.install()
    expect(b.beforeInstall).toHaveBeenCalledOnce()
    expect(b.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('hides a background check failure and keeps a failed download retryable', async () => {
    const b = setup()
    b.updater.checkForUpdates.mockRejectedValueOnce(new Error('no releases'))
    await b.controller.start()
    expect(b.controller.getState()).toEqual({ status: 'up-to-date' })
    expect(b.logger.warn).toHaveBeenCalledWith('desktop update check failed: no releases')

    b.updater.emitAvailable('2.0.0')
    b.updater.downloadUpdate.mockRejectedValueOnce(new Error('offline'))
    await expect(b.controller.download()).rejects.toThrow('offline')
    expect(b.controller.getState()).toEqual({ status: 'error', version: '2.0.0', message: 'offline' })
  })

  it('rejects actions that have no matching update state', async () => {
    const b = setup()
    await expect(b.controller.download()).rejects.toThrow('no desktop update is available')
    await expect(b.controller.install()).rejects.toThrow('desktop update is not downloaded')
    b.updater.emitError(new Error('provider unavailable'))
    expect(b.controller.getState()).toEqual({ status: 'up-to-date' })
    b.updater.emitUnavailable('1.0.0')
    expect(b.controller.getState()).toEqual({ status: 'up-to-date' })
    b.updater.emitChecking()
    expect(b.controller.getState()).toEqual({ status: 'checking' })
  })
})
