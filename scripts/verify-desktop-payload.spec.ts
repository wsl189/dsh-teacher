import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectDesktopPayload,
  REQUIRED_WINDOWS_RUNTIME_FILES,
} from './verify-desktop-payload.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createPayload(files: readonly string[], contents: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-payload-'))
  roots.push(root)
  for (const file of files) {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    const fallback = file.endsWith('/package.json') || file === 'package.json' ? '{}\n' : 'fixture'
    writeFileSync(path, contents[file] ?? fallback)
  }
  return root
}

describe('desktop payload gate', () => {
  it('accepts runtime JavaScript, assets, and native addons', () => {
    const root = createPayload([
      'package.json',
      'lib/main.js',
      'node_modules/example/dist/theme.css',
      'node_modules/example/native/addon.node',
    ])

    expect(inspectDesktopPayload(root, { requiredFiles: [] })).toEqual({ fileCount: 4, failures: [] })
  })

  it('rejects nested source maps and TypeScript incremental compiler state', () => {
    const root = createPayload([
      'lib/main.js',
      'node_modules/example/dist/index.js.map',
      'node_modules/example/lib/tsconfig.tsbuildinfo',
    ])

    expect(inspectDesktopPayload(root, { requiredFiles: [] })).toEqual({
      fileCount: 3,
      failures: [
        'node_modules/example/dist/index.js.map: source map must not be packaged',
        'node_modules/example/lib/tsconfig.tsbuildinfo: TypeScript incremental compiler state must not be packaged',
      ],
    })
  })

  it('accepts required workspace dependencies and optional absent peers', () => {
    const manifest = JSON.stringify({
      dependencies: { '@deepseek-ai/present': 'workspace:^' },
      peerDependencies: {
        '@deepseek-ai/present': 'workspace:^',
        '@deepseek-ai/optional': 'workspace:^',
      },
      peerDependenciesMeta: { '@deepseek-ai/optional': { optional: true } },
    })
    const root = createPayload([
      'node_modules/@deepseek-ai/consumer/package.json',
      'node_modules/@deepseek-ai/present/package.json',
    ], { 'node_modules/@deepseek-ai/consumer/package.json': manifest })

    expect(inspectDesktopPayload(root, { requiredFiles: [] })).toEqual({ fileCount: 2, failures: [] })
  })

  it('rejects missing required workspace dependencies and peers', () => {
    const manifest = JSON.stringify({
      dependencies: { '@deepseek-ai/missing-dependency': 'workspace:^' },
      peerDependencies: { '@deepseek-ai/missing-peer': 'workspace:^' },
    })
    const root = createPayload([
      'node_modules/@deepseek-ai/consumer/package.json',
    ], { 'node_modules/@deepseek-ai/consumer/package.json': manifest })

    expect(inspectDesktopPayload(root, { requiredFiles: [] })).toEqual({
      fileCount: 1,
      failures: [
        'node_modules/@deepseek-ai/consumer/package.json: required workspace dependency @deepseek-ai/missing-dependency is absent from payload',
        'node_modules/@deepseek-ai/consumer/package.json: required workspace peer @deepseek-ai/missing-peer is absent from payload',
      ],
    })
  })

  it('requires the bundled extension code, assets, skills, and Windows native bindings', () => {
    expect(REQUIRED_WINDOWS_RUNTIME_FILES).toContain('../windows-mcp/python.exe')
    expect(REQUIRED_WINDOWS_RUNTIME_FILES)
      .toContain('../windows-mcp/Lib/site-packages/windows_mcp/__main__.py')
    const [missing, ...present] = REQUIRED_WINDOWS_RUNTIME_FILES
    const root = createPayload(present)

    const failures = inspectDesktopPayload(root).failures
    expect(failures).toContain(
      `${missing}: required product runtime file is absent from payload`,
    )
    expect(failures).toContain(
      'node_modules/@deepseek-ai/dsh-skill-ppt-master/assets/ppt-master: packaged skill inventory is 9 files and 63 bytes; expected 12939 files and 79496215 bytes',
    )
  })
})
