/** Type declarations for the desktop runtime-staging electron-builder hook. */

/** Source application and unpacked Electron output directories. */
export interface DesktopRuntimeCopyContext {
  /** Desktop package directory used as the Node dependency resolution base. */
  appDir: string
  /** Platform output directory that contains Electron's `resources` directory. */
  appOutDir: string
}

/** Minimal electron-builder pack context consumed by the runtime-staging hook. */
export interface DesktopAfterPackContext {
  /** Platform output directory that contains Electron's `resources` directory. */
  appOutDir: string
  /** Electron platform identifier such as `win32`. */
  electronPlatformName: string
  /** Packager fields needed to resolve desktop dependencies. */
  packager: {
    /** Desktop package directory used as the Node dependency resolution base. */
    projectDir: string
  }
}

/** Filename used by the packager and desktop runtime environment. */
export declare const PPT_MASTER_ARCHIVE_NAME: 'ppt-master.tgz'

/**
 * Copy the HTML-conversion runtime packages into an unpacked desktop application.
 * @param context - source application and Electron output directories.
 * @returns completion after every runtime package has been staged.
 */
export declare function copyDesktopRuntimePackages(
  context: DesktopRuntimeCopyContext,
): Promise<void>

/**
 * Replace the loose packaged PPT Master tree with its deterministic archive.
 * @param appOutDir - unpacked Electron output containing `resources/app`.
 * @returns completion after the archive is durable and the loose tree is absent.
 */
export declare function archivePptMasterDistribution(appOutDir: string): Promise<void>

/**
 * Stage pnpm-deduped runtime packages before electron-builder signs and compresses Windows output.
 * @param context - electron-builder pack context.
 * @returns completion after the Windows runtime has been staged.
 */
export declare function afterPack(context: DesktopAfterPackContext): Promise<void>
