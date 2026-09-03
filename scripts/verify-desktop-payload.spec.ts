import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { c as createTar } from 'tar'
import {
  inspectDesktopPayload,
  REQUIRED_WINDOWS_RUNTIME_FILES,
} from './verify-desktop-payload.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createPayload(files: readonly string[], contents: Readonly<Record<string, string>> = {}): string {
  const container = mkdtempSync(join(tmpdir(), 'dsh-desktop-payload-'))
  roots.push(container)
  const root = join(container, 'resources', 'app')
  mkdirSync(root, { recursive: true })
  for (const file of files) {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    const fallback = file.endsWith('/package.json') || file === 'package.json' ? '{}\n' : 'fixture'
    writeFileSync(path, contents[file] ?? fallback)
  }
  return root
}

describe('desktop payload gate', () => {
  it('accepts runtime JavaScript, assets, and native addons', async () => {
    const root = createPayload([
      'package.json',
      'lib/main.js',
      'node_modules/example/dist/theme.css',
      'node_modules/example/native/addon.node',
    ])

    expect(await inspectDesktopPayload(root, { requiredFiles: [] })).toEqual({ fileCount: 4, failures: [] })
  })

  it('rejects nested source maps and TypeScript incremental compiler state', async () => {
    const root = createPayload([
      'lib/main.js',
      'node_modules/example/dist/index.js.map',
      'node_modules/example/lib/tsconfig.tsbuildinfo',
    ])

    expect(await inspectDesktopPayload(root, { requiredFiles: [] })).toEqual({
      fileCount: 3,
      failures: [
        'node_modules/example/dist/index.js.map: source map must not be packaged',
        'node_modules/example/lib/tsconfig.tsbuildinfo: TypeScript incremental compiler state must not be packaged',
      ],
    })
  })

  it('accepts required workspace dependencies and optional absent peers', async () => {
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

    expect(await inspectDesktopPayload(root, { requiredFiles: [] })).toEqual({ fileCount: 2, failures: [] })
  })

  it('rejects missing required workspace dependencies and peers', async () => {
    const manifest = JSON.stringify({
      dependencies: { '@deepseek-ai/missing-dependency': 'workspace:^' },
      peerDependencies: { '@deepseek-ai/missing-peer': 'workspace:^' },
    })
    const root = createPayload([
      'node_modules/@deepseek-ai/consumer/package.json',
    ], { 'node_modules/@deepseek-ai/consumer/package.json': manifest })

    expect(await inspectDesktopPayload(root, { requiredFiles: [] })).toEqual({
      fileCount: 1,
      failures: [
        'node_modules/@deepseek-ai/consumer/package.json: required workspace dependency @deepseek-ai/missing-dependency is absent from payload',
        'node_modules/@deepseek-ai/consumer/package.json: required workspace peer @deepseek-ai/missing-peer is absent from payload',
      ],
    })
  })

  it('requires the bundled extension code, assets, skills, and Windows native bindings', async () => {
    expect(REQUIRED_WINDOWS_RUNTIME_FILES).toContain('node_modules/turndown/lib/turndown.cjs.js')
    expect(REQUIRED_WINDOWS_RUNTIME_FILES)
      .toContain('node_modules/@joplin/turndown-plugin-gfm/lib/turndown-plugin-gfm.cjs.js')
    expect(REQUIRED_WINDOWS_RUNTIME_FILES).toContain('node_modules/@mixmark-io/domino/lib/index.js')
    expect(REQUIRED_WINDOWS_RUNTIME_FILES).toContain('../windows-mcp/python.exe')
    expect(REQUIRED_WINDOWS_RUNTIME_FILES)
      .toContain('../windows-mcp/Lib/site-packages/windows_mcp/__main__.py')
    const [missing, ...present] = REQUIRED_WINDOWS_RUNTIME_FILES
    const root = createPayload(present)

    const failures = (await inspectDesktopPayload(root)).failures
    expect(failures).toContain(
      `${missing}: required product runtime file is absent from payload`,
    )
    expect(failures.some(failure => failure.startsWith('../ppt-master.tgz: archive cannot be read:'))).toBe(true)
  })

  it('rejects an incomplete but readable PPT Master archive', async () => {
    const root = createPayload([])
    const source = join(root, 'archive-source')
    mkdirSync(source)
    writeFileSync(join(source, 'SKILL.md'), 'fixture')
    await createTar({
      cwd: source,
      file: join(root, '../ppt-master.tgz'),
      gzip: true,
      portable: true,
    }, ['SKILL.md'])

    const failures = (await inspectDesktopPayload(root)).failures
      .filter(failure => failure.startsWith('../ppt-master.tgz:'))
    expect(failures).toContain('../ppt-master.tgz:LICENSE: required skill file is absent from archive')
    expect(failures).toContain(
      '../ppt-master.tgz: packaged skill inventory is 1 files and 7 bytes; expected 12939 files and 79496215 bytes',
    )
  })

  it('accepts complete AnySearch runtime files and rejects each missing module', async () => {
    const requiredFiles = REQUIRED_WINDOWS_RUNTIME_FILES.filter(path => path.includes('/@anysearch/'))
    expect(requiredFiles).toHaveLength(12)
    expect((await inspectDesktopPayload(createPayload(requiredFiles), { requiredFiles })).failures).toEqual([])
    for (const missing of requiredFiles) {
      const root = createPayload(requiredFiles.filter(path => path !== missing))
      expect((await inspectDesktopPayload(root, { requiredFiles })).failures).toEqual([
        `${missing}: required product runtime file is absent from payload`,
      ])
    }
  })

  it('accepts the complete HTML conversion runtime and rejects each missing entry', async () => {
    const requiredFiles = REQUIRED_WINDOWS_RUNTIME_FILES.filter(path =>
      path.includes('turndown') || path.includes('/domino/'))
    expect(requiredFiles).toHaveLength(6)
    expect((await inspectDesktopPayload(createPayload(requiredFiles), { requiredFiles })).failures).toEqual([])
    for (const missing of requiredFiles) {
      const root = createPayload(requiredFiles.filter(path => path !== missing))
      expect((await inspectDesktopPayload(root, { requiredFiles })).failures).toEqual([
        `${missing}: required product runtime file is absent from payload`,
      ])
    }
  })
})
