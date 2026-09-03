/** Electron main process for the Windows DSH desktop distribution. */

import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import {
  DesktopUpdateController, type AutoUpdaterLike,
} from './update-controller.ts'
import {
  UPDATE_CHANNELS, type DesktopUpdateState,
} from './update-protocol.ts'
import { installRendererPermissions } from './renderer-permissions.ts'
import { resolveDesktopIconPath } from './desktop-assets.ts'
import { resolveRuntimeEnvironment } from './runtime-environment.ts'
import { stopBackendProcess, waitForBackendReady } from './backend-process.ts'
import { startupPageUrl } from './startup-page.ts'
import { runDesktopStartup } from './startup-lifecycle.ts'
import {
  APPLICATION_WINDOW_OPTIONS,
  STARTUP_WINDOW_OPTIONS,
} from './window-presentation.ts'

const require = createRequire(import.meta.url)
const BACKEND_ENTRY = require.resolve('@deepseek-ai/dsh/desktop-backend')
const BACKEND_STOP_TIMEOUT_MS = 8_000
const UPDATE_BACKEND_STOP_TIMEOUT_MS = 1_000
const INITIAL_UPDATE_STATE: DesktopUpdateState = Object.freeze({ status: 'checking' })

let mainWindow: BrowserWindow | undefined
let startupWindow: BrowserWindow | undefined
let backend: ChildProcess | undefined
let backendStop: Promise<void> | undefined
let allowQuit = false
let quitRequested = false
let updates: DesktopUpdateController | undefined
let updatesLoading: Promise<DesktopUpdateController> | undefined

/** Start the DSH Web profile under Electron's embedded Node runtime. */
function startBackend(): Promise<string> {
  const child = fork(BACKEND_ENTRY, [], {
    execPath: process.execPath,
    env: {
      ...resolveRuntimeEnvironment({
        env: process.env,
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        desktopPath: app.getPath('desktop'),
      }),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  backend = child
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { log.info(chunk.trimEnd()) })
  child.stderr?.on('data', (chunk: string) => { log.error(chunk.trimEnd()) })

  return waitForBackendReady(child)
}

/** Dispose the profile tree, terminating only if its bounded shutdown stalls. */
function stopBackend(timeoutMs = BACKEND_STOP_TIMEOUT_MS): Promise<void> {
  if (backendStop !== undefined) return backendStop
  const child = backend
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  backendStop = stopBackendProcess(child, timeoutMs, log)
  return backendStop
}

/** Send an updater state to the current renderer when it can receive IPC. */
function publishUpdateState(state: DesktopUpdateState): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(UPDATE_CHANNELS.state, state)
}

/** Load the updater only after the application window is visible. */
function loadUpdates(): Promise<DesktopUpdateController> {
  if (updates !== undefined) return Promise.resolve(updates)
  updatesLoading ??= import('./updater-runtime.ts').then(({ autoUpdater }) => {
    autoUpdater.logger = log
    const controller = new DesktopUpdateController(autoUpdater as unknown as AutoUpdaterLike, {
      enabled: app.isPackaged,
      currentVersion: app.getVersion(),
      publish: publishUpdateState,
      beforeInstall: async () => {
        if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.hide()
        if (startupWindow !== undefined && !startupWindow.isDestroyed()) startupWindow.hide()
        await stopBackend(UPDATE_BACKEND_STOP_TIMEOUT_MS)
        allowQuit = true
      },
      logger: log,
    })
    updates = controller
    return controller
  })
  return updatesLoading
}

/** Create the transparent, script-free startup card. */
async function createStartupWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...STARTUP_WINDOW_OPTIONS,
    icon: resolveDesktopIconPath({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  startupWindow = window
  window.once('closed', () => {
    if (startupWindow === window) startupWindow = undefined
  })
  await window.loadURL(startupPageUrl(app.getLocale()))
  if (!window.isDestroyed()) window.show()
  return window
}

/** Restrict links and renderer-created windows to the user's external browser. */
function installExternalNavigation(window: BrowserWindow): void {
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
}

/** Create a hidden ordinary window and load the authenticated Web application. */
async function createApplicationWindow(url: string): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...APPLICATION_WINDOW_OPTIONS,
    icon: resolveDesktopIconPath({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    }),
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  installExternalNavigation(window)
  const disposePermissions = installRendererPermissions(window, url)
  window.once('closed', disposePermissions)
  window.webContents.on('will-navigate', (event, target) => {
    let targetOrigin: string | undefined
    try {
      targetOrigin = new URL(target).origin
    } catch {
      event.preventDefault()
      return
    }
    if (targetOrigin !== new URL(url).origin) event.preventDefault()
  })
  await window.loadURL(url)
  return window
}

/** Publish and focus the fully loaded ordinary application window. */
function showApplicationWindow(window: BrowserWindow): void {
  mainWindow = window
  window.show()
  window.focus()
}

/** Immediately dispose a startup or hidden application window. */
function destroyWindow(window: BrowserWindow): void {
  if (!window.isDestroyed()) window.destroy()
}

ipcMain.handle(UPDATE_CHANNELS.getState, () => updates?.getState() ?? INITIAL_UPDATE_STATE)
ipcMain.handle(UPDATE_CHANNELS.download, async () => { await (await loadUpdates()).download() })
ipcMain.handle(UPDATE_CHANNELS.install, async () => { await (await loadUpdates()).install() })

if (!app.requestSingleInstanceLock()) {
  allowQuit = true
  app.quit()
} else {
  app.setAppUserModelId('ai.deepseek.dsh.teacher')
  app.on('second-instance', () => {
    const window = mainWindow ?? startupWindow
    if (window?.isMinimized() === true) window.restore()
    window?.show()
    window?.focus()
  })
  app.on('before-quit', (event) => {
    updates?.stop()
    if (allowQuit) return
    quitRequested = true
    event.preventDefault()
    void stopBackend().finally(() => {
      allowQuit = true
      app.quit()
    })
  })
  app.on('window-all-closed', () => { app.quit() })
  void app.whenReady().then(async () => {
    try {
      await runDesktopStartup<BrowserWindow>({
        createStartupWindow,
        startBackend,
        createApplicationWindow,
        showApplicationWindow,
        destroyWindow,
        startUpdates: async () => { await (await loadUpdates()).start() },
        shouldStop: () => quitRequested,
      })
    } catch (error) {
      if (quitRequested) return
      const message = error instanceof Error ? error.message : String(error)
      log.error(message)
      dialog.showErrorBox('DSH Teacher 启动失败', message)
      allowQuit = true
      await stopBackend()
      app.quit()
    }
  })
}
