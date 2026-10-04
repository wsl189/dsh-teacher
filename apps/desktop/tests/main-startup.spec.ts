import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  app: undefined as EventEmitter | undefined,
  windows: [] as Array<{
    urls: string[]
    show: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>,
  child: undefined as EventEmitter & {
    exitCode: number | null
    signalCode: null
    connected: boolean
    send: ReturnType<typeof vi.fn>
  } | undefined,
  singleInstance: true,
  quit: vi.fn(),
  fatal: vi.fn(),
  identity: vi.fn(),
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    urls: string[] = []
    show = vi.fn()
    focus = vi.fn()
    destroy = vi.fn(() => { this.emit('closed') })
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn(), send: vi.fn() })
    constructor() { super(); harness.windows.push(this) }
    isDestroyed() { return false }
    async loadURL(url: string) { this.urls.push(url) }
  }
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    getLocale: () => 'zh-CN',
    getVersion: () => '1.3.4',
    getAppPath: () => 'E:/dsh/dsh-teacher/apps/desktop',
    getPath: () => 'E:/dsh',
    requestSingleInstanceLock: () => harness.singleInstance,
    setAppUserModelId: harness.identity,
    quit: harness.quit,
  })
  harness.app = app
  return {
    app, BrowserWindow: Window, dialog: { showErrorBox: harness.fatal },
    shell: { openExternal: vi.fn() }, ipcMain: { handle: vi.fn() },
  }
})
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  return { fork: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null, signalCode: null, connected: true,
      stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      send: vi.fn((_message: unknown, callback?: (error: Error | null) => void) => {
        callback?.(null)
        queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0, null) })
      }),
      kill: vi.fn(),
    })
    harness.child = child
    return child
  }) }
})
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('../src/renderer-permissions.ts', () => ({ installRendererPermissions: () => () => {} }))
vi.mock('../src/updater-runtime.ts', () => ({ autoUpdater: Object.assign(new EventEmitter(), { autoDownload: false, autoInstallOnAppQuit: false }) }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  harness.windows.length = 0
  harness.child = undefined
  harness.app?.removeAllListeners()
  harness.singleInstance = true
})
afterEach(async () => {
  if (harness.child?.exitCode === null) {
    harness.app?.emit('before-quit', { preventDefault: vi.fn() })
    await vi.waitFor(() => { expect(harness.child?.exitCode).toBe(0) })
  }
})

describe('teacher Electron entry', () => {
  it('keeps the installed identity and shows the startup card before backend readiness', async () => {
    await import('../src/main.ts')
    await vi.waitFor(() => { expect(harness.child).toBeDefined() })
    expect(harness.identity).toHaveBeenCalledWith('ai.deepseek.dsh.teacher')
    expect(harness.windows).toHaveLength(1)
    expect(harness.windows[0]?.show).toHaveBeenCalledOnce()
    const url = 'http://127.0.0.1:43210/?token=' + 'a'.repeat(43)
    harness.child!.emit('message', { type: 'ready', url })
    await vi.waitFor(() => { expect(harness.windows[1]?.focus).toHaveBeenCalledOnce() })
    expect(harness.windows[1]?.urls).toEqual([url])
    expect(harness.windows[0]?.destroy).toHaveBeenCalledOnce()
  })
  it('does not start another backend when an instance already owns the application', async () => {
    harness.singleInstance = false
    await import('../src/main.ts')
    expect(harness.quit).toHaveBeenCalledOnce()
    expect(harness.windows).toHaveLength(0)
    expect(harness.child).toBeUndefined()
  })
  it('waits for backend shutdown when quitting during startup', async () => {
    await import('../src/main.ts')
    await vi.waitFor(() => { expect(harness.child).toBeDefined() })
    const preventDefault = vi.fn()
    harness.app!.emit('before-quit', { preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(harness.quit).toHaveBeenCalledOnce() })
    expect(harness.child?.send).toHaveBeenCalledWith({ type: 'shutdown' }, expect.any(Function))
    expect(harness.windows).toHaveLength(1)
  })
  it('reports a backend startup failure and stops the failed child', async () => {
    await import('../src/main.ts')
    await vi.waitFor(() => { expect(harness.child).toBeDefined() })
    harness.child!.emit('message', { type: 'fatal', message: 'fixture startup failure' })
    await vi.waitFor(() => { expect(harness.quit).toHaveBeenCalledOnce() })
    expect(harness.fatal).toHaveBeenCalledWith('DSH Teacher 启动失败', 'fixture startup failure')
    expect(harness.child?.exitCode).toBe(0)
  })
})
