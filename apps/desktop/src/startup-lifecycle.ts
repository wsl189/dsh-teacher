/** Ordered desktop startup independent from Electron's process-global APIs. */

/** Minimum window state needed by the startup coordinator. */
export interface StartupWindow {
  /**
   * Report whether the user or operating system already destroyed the window.
   * @returns true after the native window is gone.
   */
  isDestroyed(): boolean
}

/** Operations owned by the Electron main process. */
export interface DesktopStartupOperations<Window extends StartupWindow> {
  /**
   * Create, load, and show the local startup page.
   * @returns the visible startup window after its data URL loads.
   */
  createStartupWindow(): Promise<Window>
  /**
   * Fork the backend and resolve its authenticated URL.
   * @returns the validated private application URL.
   */
  startBackend(): Promise<string>
  /**
   * Create a hidden ordinary window and load the private Web page.
   * @param url - validated private application URL.
   * @returns the hidden application window after its page loads.
   */
  createApplicationWindow(url: string): Promise<Window>
  /**
   * Show the loaded ordinary application window.
   * @param window - fully loaded application window.
   */
  showApplicationWindow(window: Window): void
  /**
   * Destroy a coordinator-owned startup or hidden application window.
   * @param window - window that must not remain alive.
   */
  destroyWindow(window: Window): void
  /** Start update checks after the application page loads. */
  startUpdates(): Promise<void>
  /**
   * Report whether application shutdown superseded startup.
   * @returns true after shutdown takes ownership.
   */
  shouldStop(): boolean
}

/**
 * Show the local card before backend plugin initialization begins, then swap it
 * for an ordinary application window after the authenticated page loads.
 * @param operations - Electron-owned window, backend, update, and stop operations.
 * @returns after the application page and updater are ready, or early when shutdown owns startup.
 */
export async function runDesktopStartup<Window extends StartupWindow>(
  operations: DesktopStartupOperations<Window>,
): Promise<void> {
  const startupWindowPromise = operations.createStartupWindow()
  const backendResult = operations.startBackend().then(
    url => ({ ok: true, url }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  )
  const startupWindow = await startupWindowPromise
  if (operations.shouldStop() || startupWindow.isDestroyed()) return
  const backend = await backendResult
  if (!backend.ok) throw backend.error
  const url = backend.url
  if (operations.shouldStop() || startupWindow.isDestroyed()) return
  const applicationWindow = await operations.createApplicationWindow(url)
  if (operations.shouldStop() || startupWindow.isDestroyed()) {
    if (!applicationWindow.isDestroyed()) operations.destroyWindow(applicationWindow)
    return
  }
  if (applicationWindow.isDestroyed()) {
    operations.destroyWindow(startupWindow)
    return
  }
  operations.showApplicationWindow(applicationWindow)
  operations.destroyWindow(startupWindow)
  await operations.startUpdates()
}
