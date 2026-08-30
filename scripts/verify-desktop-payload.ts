/** Verify that a packaged desktop application omits development-only build artifacts. */

import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** Result of inspecting one unpacked Electron application payload. */
export interface DesktopPayloadReport {
  /** Number of non-directory entries inspected. */
  fileCount: number
  /** Repository-independent relative diagnostics for forbidden artifacts. */
  failures: string[]
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
    process.stderr.write('verify-desktop-payload: development-only build artifacts found:\n')
    for (const failure of report.failures.slice(0, 20)) process.stderr.write(`  ${failure}\n`)
    if (report.failures.length > 20) {
      process.stderr.write(`  ... ${String(report.failures.length - 20)} more\n`)
    }
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-desktop-payload: ${String(report.fileCount)} packaged file(s) contain no source maps or compiler state.\n`,
    )
  }
}
