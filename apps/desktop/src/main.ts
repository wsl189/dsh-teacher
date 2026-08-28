/** Electron main process for the Windows DSH desktop distribution. */

import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from './updater-runtime.ts'
import {
  DesktopUpdateController, type AutoUpdaterLike,
} from './update-controller.ts'
import {
  UPDATE_CHANNELS, type DesktopUpdateState,
} from './update-protocol.ts'

const require = createRequire(import.meta.url)
const BACKEND_ENTRY = require.resolve('@deepseek-ai/dsh/desktop-backend')
const BACKEND_START_TIMEOUT_MS = 45_000
const BACKEND_STOP_TIMEOUT_MS = 8_000

type BackendMessage =
  | { type: 'ready'; url: string }
  | { type: 'fatal'; message: string }

let mainWindow: BrowserWindow | undefined
let backend: ChildProcess | undefined
let backendStop: Promise<void> | undefined
let allowQuit = false

/** Validate a child IPC payload and its private-loopback URL. */
function backendMessage(value: unknown): BackendMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'fatal' && typeof candidate.message === 'string') {
    return { type: 'fatal', message: candidate.message }
  }
  if (candidate.type !== 'ready' || typeof candidate.url !== 'string') return undefined
  let url: URL
  try {
    url = new URL(candidate.url)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/') return undefined
  return { type: 'ready', url: url.href }
}

/** Start the DSH Web profile under Electron's embedded Node runtime. */
function startBackend(): Promise<string> {
  const child = fork(BACKEND_ENTRY, [], {
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  backend = child
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { log.info(chunk.trimEnd()) })
  child.stderr?.on('data', (chunk: string) => { log.error(chunk.trimEnd()) })

  return new Promise<string>((resolve, reject) => {
    const settle = (action: () => void): void => {
      clearTimeout(timeout)
      child.off('error', onError)
      child.off('exit', onExit)
      child.off('message', onMessage)
      action()
    }
    const onError = (error: Error): void => { settle(() => { reject(error) }) }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      settle(() => { reject(new Error(`desktop backend exited before ready (${String(code ?? signal)})`)) })
    }
    const onMessage = (value: unknown): void => {
      const message = backendMessage(value)
      if (message === undefined) return
      if (message.type === 'fatal') {
        settle(() => { reject(new Error(message.message)) })
        return
      }
      settle(() => { resolve(message.url) })
    }
    const timeout = setTimeout(() => {
      settle(() => {
        child.kill()
        reject(new Error(`desktop backend did not become ready within ${String(BACKEND_START_TIMEOUT_MS)}ms`))
      })
    }, BACKEND_START_TIMEOUT_MS)
    child.once('error', onError)
    child.once('exit', onExit)
    child.on('message', onMessage)
  })
}

/** Dispose the profile tree, terminating only if its bounded shutdown stalls. */
function stopBackend(): Promise<void> {
  if (backendStop !== undefined) return backendStop
  const child = backend
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  backendStop = new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      log.warn('desktop backend did not stop in time; terminating it')
      child.kill()
    }, BACKEND_STOP_TIMEOUT_MS)
    const done = (): void => {
      clearTimeout(timeout)
      child.off('exit', done)
      child.off('error', done)
      resolve()
    }
    child.once('exit', done)
    child.once('error', done)
    child.send({ type: 'shutdown' }, (error) => {
      if (error !== null) {
        log.warn(`could not request desktop backend shutdown: ${error.message}`)
        child.kill()
      }
    })
  })
  return backendStop
}

/** Send an updater state to the current renderer when it can receive IPC. */
function publishUpdateState(state: DesktopUpdateState): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(UPDATE_CHANNELS.state, state)
}

const updates = new DesktopUpdateController(autoUpdater as unknown as AutoUpdaterLike, {
  enabled: app.isPackaged,
  currentVersion: app.getVersion(),
  publish: publishUpdateState,
  beforeInstall: async () => {
    await stopBackend()
    allowQuit = true
  },
  logger: log,
})
autoUpdater.logger = log

/** Create the hardened renderer window and load the private loopback server. */
async function createWindow(url: string): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#f7f8fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = window
  window.once('ready-to-show', () => { window.show() })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    let protocol: string | undefined
    try {
      protocol = new URL(target).protocol
    } catch {
      return { action: 'deny' }
    }
    if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(target)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== new URL(url).origin) event.preventDefault()
  })
  await window.loadURL(url)
}

ipcMain.handle(UPDATE_CHANNELS.getState, () => updates.getState())
ipcMain.handle(UPDATE_CHANNELS.download, async () => { await updates.download() })
ipcMain.handle(UPDATE_CHANNELS.install, async () => { await updates.install() })

if (!app.requestSingleInstanceLock()) {
  allowQuit = true
  app.quit()
} else {
  app.setAppUserModelId('ai.deepseek.dsh.teacher')
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized() === true) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
  app.on('before-quit', (event) => {
    if (allowQuit) return
    event.preventDefault()
    void stopBackend().finally(() => {
      allowQuit = true
      app.quit()
    })
  })
  app.on('window-all-closed', () => { app.quit() })
  void app.whenReady().then(async () => {
    try {
      const url = await startBackend()
      await createWindow(url)
      await updates.start()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(message)
      dialog.showErrorBox('DSH Teacher 启动失败', message)
      allowQuit = true
      await stopBackend()
      app.quit()
    }
  })
}
