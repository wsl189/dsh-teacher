import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { installRendererPermissions } from '../src/renderer-permissions.ts'

type CheckHandler = Exclude<Parameters<BrowserWindow['webContents']['session']['setPermissionCheckHandler']>[0], null>
type RequestHandler = Exclude<Parameters<BrowserWindow['webContents']['session']['setPermissionRequestHandler']>[0], null>

function fixture() {
  let check: CheckHandler | null = null
  let request: RequestHandler | null = null
  const renderer = { id: 1 }
  const setPermissionCheckHandler = vi.fn((next: CheckHandler | null) => { check = next })
  const setPermissionRequestHandler = vi.fn((next: RequestHandler | null) => { request = next })
  const window = {
    webContents: {
      ...renderer,
      session: { setPermissionCheckHandler, setPermissionRequestHandler },
    },
  } as unknown as BrowserWindow
  const dispose = installRendererPermissions(window, 'http://127.0.0.1:43125/')
  return {
    check: () => check!,
    request: () => request!,
    renderer: window.webContents,
    foreignRenderer: { id: 2 } as never,
    setPermissionCheckHandler,
    setPermissionRequestHandler,
    dispose,
  }
}

const checkDetails = {
  isMainFrame: true,
  requestingUrl: 'http://127.0.0.1:43125/chat',
  securityOrigin: 'http://127.0.0.1:43125',
  mediaType: 'audio' as const,
}

const requestDetails = {
  isMainFrame: true,
  requestingUrl: 'http://127.0.0.1:43125/chat',
  securityOrigin: 'http://127.0.0.1:43125',
  mediaTypes: ['audio'] as Array<'audio' | 'video'>,
}

describe('desktop renderer permissions', () => {
  it('allows microphone audio and clipboard writes only for the owning loopback renderer', () => {
    const policy = fixture()
    expect(policy.check()(policy.renderer, 'media', 'http://127.0.0.1:43125', checkDetails)).toBe(true)
    expect(policy.check()(policy.renderer, 'clipboard-sanitized-write', 'http://127.0.0.1:43125', {
      isMainFrame: true,
      requestingUrl: 'http://127.0.0.1:43125/chat',
    })).toBe(true)

    const callback = vi.fn()
    policy.request()(policy.renderer, 'media', callback, requestDetails)
    expect(callback).toHaveBeenLastCalledWith(true)
    policy.request()(policy.renderer, 'clipboard-sanitized-write', callback, {
      isMainFrame: true,
      requestingUrl: 'http://127.0.0.1:43125/chat',
    })
    expect(callback).toHaveBeenLastCalledWith(true)
  })

  it('denies video, subframes, foreign renderers, origins, and unrelated permissions', () => {
    const policy = fixture()
    expect(policy.check()(policy.renderer, 'media', 'http://127.0.0.1:43125', {
      ...checkDetails,
      mediaType: 'video',
    })).toBe(false)
    expect(policy.check()(policy.renderer, 'media', 'http://127.0.0.1:43125', {
      ...checkDetails,
      isMainFrame: false,
    })).toBe(false)
    expect(policy.check()(policy.foreignRenderer, 'media', 'http://127.0.0.1:43125', checkDetails)).toBe(false)
    expect(policy.check()(policy.renderer, 'media', 'https://example.test', checkDetails)).toBe(false)
    expect(policy.check()(policy.renderer, 'geolocation', 'http://127.0.0.1:43125', checkDetails)).toBe(false)

    const callback = vi.fn()
    policy.request()(policy.renderer, 'media', callback, {
      ...requestDetails,
      mediaTypes: ['audio', 'video'],
    })
    policy.request()(policy.renderer, 'media', callback, {
      ...requestDetails,
      requestingUrl: 'https://example.test/',
    })
    policy.request()(policy.foreignRenderer, 'media', callback, requestDetails)
    policy.request()(policy.renderer, 'notifications', callback, requestDetails)
    expect(callback.mock.calls).toEqual([[false], [false], [false], [false]])
  })

  it('rejects malformed origins and clears both handlers exactly once', () => {
    const policy = fixture()
    expect(policy.check()(policy.renderer, 'media', 'not a URL', checkDetails)).toBe(false)
    expect(policy.check()(policy.renderer, 'media', 'http://127.0.0.1:43125', {
      ...checkDetails,
      securityOrigin: 'not a URL',
    })).toBe(false)

    policy.dispose()
    policy.dispose()
    expect(policy.setPermissionCheckHandler.mock.calls).toEqual([[expect.any(Function)], [null]])
    expect(policy.setPermissionRequestHandler.mock.calls).toEqual([[expect.any(Function)], [null]])
  })
})
