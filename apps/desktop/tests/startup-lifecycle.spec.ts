import { describe, expect, it } from 'vitest'
import { runDesktopStartup, type StartupWindow } from '../src/startup-lifecycle.ts'

describe('desktop startup lifecycle', () => {
  it('shows the startup card before loading and swapping to the application window', async () => {
    const events: string[] = []
    const startupWindow: StartupWindow = { isDestroyed: () => false }
    const applicationWindow: StartupWindow = { isDestroyed: () => false }

    await runDesktopStartup({
      async createStartupWindow() {
        events.push('startup-visible')
        return startupWindow
      },
      async startBackend() {
        events.push('backend-started')
        return 'http://127.0.0.1:43125/?token=fixture'
      },
      async createApplicationWindow(url) {
        expect(url).toContain('127.0.0.1:43125')
        events.push('application-loaded')
        return applicationWindow
      },
      showApplicationWindow(received) {
        expect(received).toBe(applicationWindow)
        events.push('application-visible')
      },
      destroyWindow(received) {
        expect(received).toBe(startupWindow)
        events.push('startup-destroyed')
      },
      async startUpdates() { events.push('updates') },
      shouldStop: () => false,
    })

    expect(events).toEqual([
      'startup-visible',
      'backend-started',
      'application-loaded',
      'application-visible',
      'startup-destroyed',
      'updates',
    ])
  })

  it('does not start the backend after shutdown takes ownership', async () => {
    const events: string[] = []
    await runDesktopStartup({
      async createStartupWindow() {
        events.push('startup-visible')
        return { isDestroyed: () => false }
      },
      async startBackend() {
        events.push('backend-started')
        return 'unreachable'
      },
      async createApplicationWindow() {
        events.push('application-loaded')
        return { isDestroyed: () => false }
      },
      showApplicationWindow() { events.push('application-visible') },
      destroyWindow() { events.push('window-destroyed') },
      async startUpdates() { events.push('updates') },
      shouldStop: () => true,
    })
    expect(events).toEqual(['startup-visible'])
  })

  it('does not create an application window when the startup card closes during backend startup', async () => {
    const events: string[] = []
    let startupDestroyed = false
    await runDesktopStartup({
      async createStartupWindow() {
        events.push('startup-visible')
        return { isDestroyed: () => startupDestroyed }
      },
      async startBackend() {
        events.push('backend-started')
        startupDestroyed = true
        return 'http://127.0.0.1:43125/?token=fixture'
      },
      async createApplicationWindow() {
        events.push('application-loaded')
        return { isDestroyed: () => false }
      },
      showApplicationWindow() { events.push('application-visible') },
      destroyWindow() { events.push('window-destroyed') },
      async startUpdates() { events.push('updates') },
      shouldStop: () => false,
    })
    expect(events).toEqual(['startup-visible', 'backend-started'])
  })

  it('destroys the hidden application window when the startup card closes during navigation', async () => {
    const events: string[] = []
    let startupDestroyed = false
    let applicationDestroyed = false
    const startupWindow: StartupWindow = { isDestroyed: () => startupDestroyed }
    const applicationWindow: StartupWindow = { isDestroyed: () => applicationDestroyed }

    await runDesktopStartup({
      async createStartupWindow() {
        events.push('startup-visible')
        return startupWindow
      },
      async startBackend() {
        events.push('backend-started')
        return 'http://127.0.0.1:43125/?token=fixture'
      },
      async createApplicationWindow() {
        events.push('application-loaded')
        startupDestroyed = true
        return applicationWindow
      },
      showApplicationWindow() { events.push('application-visible') },
      destroyWindow(received) {
        expect(received).toBe(applicationWindow)
        applicationDestroyed = true
        events.push('application-destroyed')
      },
      async startUpdates() { events.push('updates') },
      shouldStop: () => false,
    })

    expect(applicationDestroyed).toBe(true)
    expect(events).toEqual([
      'startup-visible',
      'backend-started',
      'application-loaded',
      'application-destroyed',
    ])
  })

  it('destroys the hidden application window when shutdown takes ownership during navigation', async () => {
    const events: string[] = []
    let shouldStop = false
    const startupWindow: StartupWindow = { isDestroyed: () => false }
    const applicationWindow: StartupWindow = { isDestroyed: () => false }

    await runDesktopStartup({
      async createStartupWindow() {
        events.push('startup-visible')
        return startupWindow
      },
      async startBackend() {
        events.push('backend-started')
        return 'http://127.0.0.1:43125/?token=fixture'
      },
      async createApplicationWindow() {
        events.push('application-loaded')
        shouldStop = true
        return applicationWindow
      },
      showApplicationWindow() { events.push('application-visible') },
      destroyWindow(received) {
        expect(received).toBe(applicationWindow)
        events.push('application-destroyed')
      },
      async startUpdates() { events.push('updates') },
      shouldStop: () => shouldStop,
    })

    expect(events).toEqual([
      'startup-visible',
      'backend-started',
      'application-loaded',
      'application-destroyed',
    ])
  })

  it('closes the startup card when the hidden application window disappears', async () => {
    const events: string[] = []
    const startupWindow: StartupWindow = { isDestroyed: () => false }

    await runDesktopStartup({
      async createStartupWindow() {
        events.push('startup-visible')
        return startupWindow
      },
      async startBackend() {
        events.push('backend-started')
        return 'http://127.0.0.1:43125/?token=fixture'
      },
      async createApplicationWindow() {
        events.push('application-destroyed')
        return { isDestroyed: () => true }
      },
      showApplicationWindow() { events.push('application-visible') },
      destroyWindow(received) {
        expect(received).toBe(startupWindow)
        events.push('startup-destroyed')
      },
      async startUpdates() { events.push('updates') },
      shouldStop: () => false,
    })

    expect(events).toEqual([
      'startup-visible',
      'backend-started',
      'application-destroyed',
      'startup-destroyed',
    ])
  })
})
