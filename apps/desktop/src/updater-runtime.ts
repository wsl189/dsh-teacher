/** Runtime adapter for electron-updater's CommonJS entry. */

import updaterPackage from 'electron-updater'

/** The platform updater exposed through Node's CommonJS default export. */
export const autoUpdater = updaterPackage.autoUpdater
