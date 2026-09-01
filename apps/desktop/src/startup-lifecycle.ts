/** Ordered desktop startup independent from Electron's process-global APIs. */

/** Minimum window state needed by the startup coordinator. */
export interface StartupWindow {
  /** Whether the user or operating system already destroyed the window. */
  isDestroyed(): boolean
}

/** Operations owned by the Electron main process. */
export interface DesktopStartupOperations<Window extends StartupWindow> {
  /** Create, load, and show the local startup page. */
  createWindow(): Promise<Window>
  /** Fork the backend and resolve its authenticated URL. */
  startBackend(): Promise<string>
  /** Replace the startup page with the private Web page. */
  loadBackendPage(window: Window, url: string): Promise<void>
  /** Start update checks after the application page loads. */
  startUpdates(): Promise<void>
  /** Whether application shutdown superseded startup. */
  shouldStop(): boolean
}

/**
 * Show the local window before backend plugin initialization begins, then hand
 * that same window to the authenticated Web application.
 * @param operations - Electron-owned window, backend, update, and stop operations.
 * @returns after the application page and updater are ready, or early when shutdown owns startup.
 */
export async function runDesktopStartup<Window extends StartupWindow>(
  operations: DesktopStartupOperations<Window>,
): Promise<void> {
  const window = await operations.createWindow()
  if (operations.shouldStop() || window.isDestroyed()) return
  const url = await operations.startBackend()
  if (operations.shouldStop() || window.isDestroyed()) return
  await operations.loadBackendPage(window, url)
  await operations.startUpdates()
}
