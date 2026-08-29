/** Permission policy for the Electron renderer's private loopback application. */

import type {
  BrowserWindow,
  FilesystemPermissionRequest,
  MediaAccessPermissionRequest,
  OpenExternalPermissionRequest,
  PermissionRequest,
} from 'electron'

type RequestDetails =
  | PermissionRequest
  | FilesystemPermissionRequest
  | MediaAccessPermissionRequest
  | OpenExternalPermissionRequest

function sameOrigin(value: string | undefined, expected: string): boolean {
  if (value === undefined) return true
  try {
    return new URL(value).origin === expected
  } catch {
    return false
  }
}

function mainFrameRequest(details: PermissionRequest, expectedOrigin: string): boolean {
  return details.isMainFrame && sameOrigin(details.requestingUrl, expectedOrigin)
}

function audioOnly(details: RequestDetails): details is MediaAccessPermissionRequest {
  if (!('mediaTypes' in details)) return false
  return details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio'
}

/**
 * Install the permissions needed by the private renderer and deny every other request.
 * @param window - sole application BrowserWindow using the session.
 * @param applicationUrl - validated private-loopback URL loaded into the window.
 * @returns idempotent disposer that clears the session handlers.
 */
export function installRendererPermissions(window: BrowserWindow, applicationUrl: string): () => void {
  const expectedOrigin = new URL(applicationUrl).origin
  const renderer = window.webContents
  const rendererSession = renderer.session
  rendererSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (webContents !== renderer || !details.isMainFrame
      || !sameOrigin(requestingOrigin, expectedOrigin)
      || !sameOrigin(details.requestingUrl, expectedOrigin)
      || !sameOrigin(details.securityOrigin, expectedOrigin)) return false
    if (permission === 'clipboard-sanitized-write') return true
    return permission === 'media' && details.mediaType === 'audio'
  })
  rendererSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (webContents !== renderer || !mainFrameRequest(details, expectedOrigin)) {
      callback(false)
      return
    }
    if (permission === 'clipboard-sanitized-write') {
      callback(true)
      return
    }
    callback(permission === 'media'
      && audioOnly(details)
      && sameOrigin(details.securityOrigin, expectedOrigin))
  })

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    rendererSession.setPermissionCheckHandler(null)
    rendererSession.setPermissionRequestHandler(null)
  }
}
