import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectDesktopPayload } from './verify-desktop-payload.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createPayload(files: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-payload-'))
  roots.push(root)
  for (const file of files) {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'fixture')
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

    expect(inspectDesktopPayload(root)).toEqual({ fileCount: 4, failures: [] })
  })

  it('rejects nested source maps and TypeScript incremental compiler state', () => {
    const root = createPayload([
      'lib/main.js',
      'node_modules/example/dist/index.js.map',
      'node_modules/example/lib/tsconfig.tsbuildinfo',
    ])

    expect(inspectDesktopPayload(root)).toEqual({
      fileCount: 3,
      failures: [
        'node_modules/example/dist/index.js.map: source map must not be packaged',
        'node_modules/example/lib/tsconfig.tsbuildinfo: TypeScript incremental compiler state must not be packaged',
      ],
    })
  })
})
