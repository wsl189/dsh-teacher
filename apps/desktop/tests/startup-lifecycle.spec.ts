import { describe, expect, it } from 'vitest'
import { runDesktopStartup, type StartupWindow } from '../src/startup-lifecycle.ts'

describe('desktop startup lifecycle', () => {
  it('shows the startup window before backend plugins begin loading', async () => {
    const events: string[] = []
    const window: StartupWindow = { isDestroyed: () => false }

    await runDesktopStartup({
      async createWindow() {
        events.push('window-visible')
        return window
      },
      async startBackend() {
        events.push('backend-started')
        return 'http://127.0.0.1:43125/?token=fixture'
      },
      async loadBackendPage(received, url) {
        expect(received).toBe(window)
        expect(url).toContain('127.0.0.1:43125')
        events.push('backend-page')
      },
      async startUpdates() { events.push('updates') },
      shouldStop: () => false,
    })

    expect(events).toEqual(['window-visible', 'backend-started', 'backend-page', 'updates'])
  })

  it('does not start or navigate work after shutdown takes ownership', async () => {
    const events: string[] = []
    await runDesktopStartup({
      async createWindow() {
        events.push('window-visible')
        return { isDestroyed: () => false }
      },
      async startBackend() {
        events.push('backend-started')
        return 'unreachable'
      },
      async loadBackendPage() { events.push('backend-page') },
      async startUpdates() { events.push('updates') },
      shouldStop: () => true,
    })
    expect(events).toEqual(['window-visible'])
  })

  it('does not navigate a window closed while the backend starts', async () => {
    const events: string[] = []
    let destroyed = false
    await runDesktopStartup({
      async createWindow() {
        events.push('window-visible')
        return { isDestroyed: () => destroyed }
      },
      async startBackend() {
        events.push('backend-started')
        destroyed = true
        return 'http://127.0.0.1:43125/?token=fixture'
      },
      async loadBackendPage() { events.push('backend-page') },
      async startUpdates() { events.push('updates') },
      shouldStop: () => false,
    })
    expect(events).toEqual(['window-visible', 'backend-started'])
  })
})
