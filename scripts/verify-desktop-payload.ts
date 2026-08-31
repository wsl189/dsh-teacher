/** Verify the runtime closure and file policy of a packaged desktop application. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

interface PackageManifest {
  dependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
  peerDependenciesMeta?: Record<string, { optional?: unknown }>
}

const PPT_MASTER_RUNTIME_ROOT = 'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master'
const PPT_MASTER_RUNTIME_FILES = 12_939
const PPT_MASTER_RUNTIME_BYTES = 79_496_215

/** Product runtime files whose omission would leave a successful but incomplete Windows build. */
export const REQUIRED_WINDOWS_RUNTIME_FILES = [
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/package.json',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/lib/index.js',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master/SKILL.md',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master/LICENSE',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master/SPONSORS.md',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master/SPONSORS_CN.md',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master/requirements.txt',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master/scripts/attribution_guard.py',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master/references/shared-standards.md',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master/templates/layouts/presentation_core/templates/17_two_picture_caption.svg',
  'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master/templates/sounds/bigsoundbank/0572.wav',
  'node_modules/@dickpy/dsh-imagegen/package.json',
  'node_modules/@dickpy/dsh-imagegen/LICENSE',
  'node_modules/@dickpy/dsh-imagegen/lib/index.js',
  'node_modules/@dickpy/dsh-imagegen/lib/client.js',
  'node_modules/@dickpy/dsh-imagegen/src/templates/cases.json',
  'node_modules/dsh-skill-mcp-panel/package.json',
  'node_modules/dsh-skill-mcp-panel/lib/index.js',
  'node_modules/dsh-skill-mcp-panel/lib/client.js',
  'node_modules/dsh-univer-office/package.json',
  'node_modules/dsh-univer-office/lib/index.js',
  'node_modules/dsh-univer-office/lib/client.js',
  'node_modules/dsh-univer-office/artifacts/gateway.cjs',
  'node_modules/dsh-univer-office/artifacts/unit-content-worker.mjs',
  'node_modules/dsh-univer-office/artifacts/render-machine/index.html',
  'node_modules/dsh-univer-office/artifacts/viewer/index.html',
  'node_modules/dsh-univer-office/skills/univer/SKILL.md',
  'node_modules/@univerjs-pro/cli-assets/resource-manifest.json',
  'node_modules/@libsql/win32-x64-msvc/index.node',
  'node_modules/@univerjs-pro/engine-formula-rust-binding-win32-x64-msvc/univer-formula.win32-x64-msvc.node',
  'node_modules/@univerjs-pro/exchange-node-binding-win32-x64-msvc/univer-exchange-node.win32-x64-msvc.node',
  '../windows-mcp/python.exe',
  '../windows-mcp/python314.dll',
  '../windows-mcp/python314.zip',
  '../windows-mcp/python314._pth',
  '../windows-mcp/LICENSE.txt',
  '../windows-mcp/Lib/site-packages/windows_mcp/__main__.py',
  '../windows-mcp/Lib/site-packages/windows_mcp-0.8.5.dist-info/METADATA',
  '../windows-mcp/Lib/site-packages/comtypes/__init__.py',
  '../windows-mcp/Lib/site-packages/dxcam/__init__.py',
  '../windows-mcp/Lib/site-packages/fastmcp/__init__.py',
  '../windows-mcp/Lib/site-packages/win32/win32api.pyd',
] as const

/** Optional inspection inputs used by platform-neutral unit fixtures. */
export interface DesktopPayloadOptions {
  /** Product files required in addition to the generic dependency and artifact checks. */
  requiredFiles?: readonly string[]
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
 * @param options - product files that must be present; defaults to the Windows runtime set.
 * @returns the inspected file count and every forbidden build artifact or missing runtime file.
 */
export function inspectDesktopPayload(
  root: string,
  options: DesktopPayloadOptions = {},
): DesktopPayloadReport {
  let fileCount = 0
  let pptMasterFileCount = 0
  let pptMasterByteCount = 0
  const failures: string[] = []
  const requiredFiles = options.requiredFiles ?? REQUIRED_WINDOWS_RUNTIME_FILES

  for (const path of requiredFiles) {
    if (!existsSync(join(root, ...path.split('/')))) {
      failures.push(`${path}: required product runtime file is absent from payload`)
    }
  }

  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue
    fileCount++
    const path = normalizedRelative(root, entry.parentPath, entry.name)
    if (path.startsWith(`${PPT_MASTER_RUNTIME_ROOT}/`)) {
      pptMasterFileCount++
      pptMasterByteCount += statSync(join(entry.parentPath, entry.name)).size
    }
    if (entry.name.endsWith('.map')) {
      failures.push(`${path}: source map must not be packaged`)
    } else if (entry.name.endsWith('.tsbuildinfo')) {
      failures.push(`${path}: TypeScript incremental compiler state must not be packaged`)
    } else if (entry.name === 'package.json' && path.startsWith('node_modules/')) {
      failures.push(...inspectManifest(root, path, join(entry.parentPath, entry.name)))
    }
  }

  if (
    options.requiredFiles === undefined
    && (pptMasterFileCount !== PPT_MASTER_RUNTIME_FILES || pptMasterByteCount !== PPT_MASTER_RUNTIME_BYTES)
  ) {
    failures.push(
      `${PPT_MASTER_RUNTIME_ROOT}: packaged skill inventory is ${String(pptMasterFileCount)} files and ${String(pptMasterByteCount)} bytes; expected ${String(PPT_MASTER_RUNTIME_FILES)} files and ${String(PPT_MASTER_RUNTIME_BYTES)} bytes`,
    )
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
      `verify-desktop-payload: ${String(report.fileCount)} packaged file(s) contain the required product files, a complete workspace runtime closure, and no source maps or compiler state.\n`,
    )
  }
}
