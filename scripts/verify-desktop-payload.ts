/** Verify the runtime closure and file policy of a packaged desktop application. */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

interface PackageManifest {
  dependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
  peerDependenciesMeta?: Record<string, { optional?: unknown }>
}

/** Result of inspecting one unpacked Electron application payload. */
export interface DesktopPayloadReport {
  /** Number of non-directory entries inspected. */
  fileCount: number
  /** Repository-independent relative diagnostics for forbidden artifacts. */
  failures: string[]
}

/** Whether a parsed JSON value is a string-keyed object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Return workspace dependency names from a manifest field. */
function workspaceDependencies(value: unknown): string[] {
  if (!isRecord(value)) return []
  return Object.entries(value)
    .filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[1].startsWith('workspace:'))
    .map(([name]) => name)
    .sort()
}

/** Whether the root-level packaged module contains a package manifest. */
function hasPackagedPackage(root: string, packageName: string): boolean {
  return existsSync(join(root, 'node_modules', ...packageName.split('/'), 'package.json'))
}

/** Inspect one packaged manifest for missing required workspace packages. */
function inspectManifest(root: string, path: string, manifestPath: string): string[] {
  let manifest: PackageManifest
  try {
    const value: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!isRecord(value)) return [`${path}: package manifest must contain a JSON object`]
    manifest = value
  } catch {
    return [`${path}: package manifest must contain valid JSON`]
  }

  const failures: string[] = []
  for (const dependency of workspaceDependencies(manifest.dependencies)) {
    if (!hasPackagedPackage(root, dependency)) {
      failures.push(`${path}: required workspace dependency ${dependency} is absent from payload`)
    }
  }

  const peerMeta = isRecord(manifest.peerDependenciesMeta) ? manifest.peerDependenciesMeta : {}
  for (const peer of workspaceDependencies(manifest.peerDependencies)) {
    const metadata = peerMeta[peer]
    if (isRecord(metadata) && metadata.optional === true) continue
    if (!hasPackagedPackage(root, peer)) {
      failures.push(`${path}: required workspace peer ${peer} is absent from payload`)
    }
  }
  return failures
}

/** Normalize an unpacked-payload path for stable cross-platform diagnostics. */
function normalizedRelative(root: string, parentPath: string, name: string): string {
  return relative(root, join(parentPath, name)).split(sep).join('/')
}

/**
 * Inspect one unpacked Electron application for files the desktop does not consume at runtime.
 * @param root - absolute path to the unpacked application's `resources/app` directory.
 * @returns the inspected file count and every forbidden build artifact.
 */
export function inspectDesktopPayload(root: string): DesktopPayloadReport {
  let fileCount = 0
  const failures: string[] = []

  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue
    fileCount++
    const path = normalizedRelative(root, entry.parentPath, entry.name)
    if (entry.name.endsWith('.map')) {
      failures.push(`${path}: source map must not be packaged`)
    } else if (entry.name.endsWith('.tsbuildinfo')) {
      failures.push(`${path}: TypeScript incremental compiler state must not be packaged`)
    } else if (entry.name === 'package.json' && path.startsWith('node_modules/')) {
      failures.push(...inspectManifest(root, path, join(entry.parentPath, entry.name)))
    }
  }

  failures.sort()
  return { fileCount, failures }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const input = process.argv[2]
  if (input === undefined || process.argv.length !== 3) {
    throw new Error('usage: verify-desktop-payload <unpacked resources/app directory>')
  }
  const root = resolve(input)
  const report = inspectDesktopPayload(root)
  if (report.failures.length > 0) {
    process.stderr.write('verify-desktop-payload: packaged payload violations found:\n')
    for (const failure of report.failures.slice(0, 20)) process.stderr.write(`  ${failure}\n`)
    if (report.failures.length > 20) {
      process.stderr.write(`  ... ${String(report.failures.length - 20)} more\n`)
    }
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-desktop-payload: ${String(report.fileCount)} packaged file(s) contain a complete workspace runtime closure and no source maps or compiler state.\n`,
    )
  }
}
