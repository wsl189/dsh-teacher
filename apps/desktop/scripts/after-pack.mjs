/** Stage dynamic HTML-conversion dependencies that pnpm's deduped graph can omit. */

import { cp, lstat, mkdir, rm, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const PACKAGE_RUNTIME_ENTRIES = ['package.json', 'LICENSE', 'lib']

/** Remove one known package destination without following a link into its target. */
async function removePackageDestination(path) {
  let status
  try {
    status = await lstat(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }

  if (status.isSymbolicLink()) await unlink(path)
  else await rm(path, { recursive: true, force: true })
}

/** Resolve an installed package directory through one package's Node resolution base. */
function resolvePackageRoot(resolver, packageName) {
  return dirname(resolver.resolve(`${packageName}/package.json`))
}

/** Copy one package's declared runtime subset into the unpacked Electron application. */
async function copyRuntimePackage(appRoot, packageName, sourceRoot) {
  const destination = join(appRoot, 'node_modules', ...packageName.split('/'))
  await removePackageDestination(destination)
  await mkdir(destination, { recursive: true })
  for (const entry of PACKAGE_RUNTIME_ENTRIES) {
    await cp(join(sourceRoot, entry), join(destination, entry), {
      recursive: true,
      dereference: true,
      filter: source => !source.endsWith('.map') && !source.endsWith('.tsbuildinfo'),
    })
  }
}

/**
 * Copy the HTML-conversion runtime packages into an unpacked desktop application.
 * @param {{ appDir: string, appOutDir: string }} context - source application and Electron output directories.
 * @returns {Promise<void>} completion after every runtime package has been staged.
 */
export async function copyDesktopRuntimePackages({ appDir, appOutDir }) {
  const appResolver = createRequire(resolve(appDir, 'package.json'))
  const turndownRoot = resolvePackageRoot(appResolver, 'turndown')
  const turndownResolver = createRequire(join(turndownRoot, 'package.json'))
  const packages = [
    ['@joplin/turndown-plugin-gfm', resolvePackageRoot(appResolver, '@joplin/turndown-plugin-gfm')],
    ['turndown', turndownRoot],
    ['@mixmark-io/domino', resolvePackageRoot(turndownResolver, '@mixmark-io/domino')],
  ]
  const appRoot = resolve(appOutDir, 'resources', 'app')
  for (const [packageName, sourceRoot] of packages) {
    await copyRuntimePackage(appRoot, packageName, sourceRoot)
  }
}

/**
 * Stage pnpm-deduped runtime packages before electron-builder signs and compresses Windows output.
 * @param {{ appOutDir: string, electronPlatformName: string, packager: { appDir: string } }} context - electron-builder pack context.
 * @returns {Promise<void>} completion after the Windows runtime has been staged.
 */
export async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  await copyDesktopRuntimePackages({
    appDir: context.packager.projectDir,
    appOutDir: context.appOutDir,
  })
}
