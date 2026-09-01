/** Resolve desktop brand assets in source and packaged Electron runs. */

import { join } from 'node:path'

/** Electron paths used to locate the BrowserWindow icon. */
export interface DesktopAssetOptions {
  /** Whether Electron is running from an installed package. */
  readonly packaged: boolean
  /** Directory containing electron-builder extraResources. */
  readonly resourcesPath: string
  /** Application package root used by source runs. */
  readonly appPath: string
}

/**
 * Locate the checked-in icon without trusting the source checkout in installed builds.
 * @param options - Electron package state and application directories.
 * @returns the absolute ICO path passed to BrowserWindow.
 */
export function resolveDesktopIconPath(options: DesktopAssetOptions): string {
  if (options.packaged) return join(options.resourcesPath, 'icon.ico')
  return join(options.appPath, 'build', 'icon.ico')
}
