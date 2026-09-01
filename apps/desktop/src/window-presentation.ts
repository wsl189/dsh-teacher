/** Constructor options for the desktop startup and application windows. */

/** Fixed transparent window used while the local brand card is visible. */
export const STARTUP_WINDOW_OPTIONS = {
  width: 380,
  height: 340,
  center: true,
  show: false,
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  roundedCorners: true,
  hasShadow: false,
  skipTaskbar: true,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
} as const

/** Normal framed window used by the authenticated Web application. */
export const APPLICATION_WINDOW_OPTIONS = {
  width: 1440,
  height: 900,
  minWidth: 980,
  minHeight: 640,
  center: true,
  show: false,
  backgroundColor: '#f7f8fa',
  autoHideMenuBar: true,
  resizable: true,
  minimizable: true,
  maximizable: true,
  fullscreenable: true,
} as const
