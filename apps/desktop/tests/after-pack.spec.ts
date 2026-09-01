import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { afterPack, copyDesktopRuntimePackages } from '../scripts/after-pack.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(root: string, path: string, contents = 'fixture'): void {
  const destination = join(root, ...path.split('/'))
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, contents)
}

function createRuntimePackage(root: string, packageName: string, entry: string): void {
  write(root, `${packageName}/package.json`, `${JSON.stringify({ name: packageName })}\n`)
  write(root, `${packageName}/LICENSE`, `${packageName} license\n`)
  write(root, `${packageName}/lib/${entry}`, `${packageName} runtime\n`)
  write(root, `${packageName}/lib/ignored.js.map`, 'source map')
  write(root, `${packageName}/test/fixture.js`, 'development fixture')
}

function createFixture(): { appDir: string; appOutDir: string; dominoRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-after-pack-'))
  roots.push(root)
  const appDir = join(root, 'app')
  const appOutDir = join(root, 'win-unpacked')
  write(appDir, 'package.json', '{"name":"fixture"}\n')
  createRuntimePackage(
    join(appDir, 'node_modules'),
    '@joplin/turndown-plugin-gfm',
    'turndown-plugin-gfm.cjs.js',
  )
  createRuntimePackage(join(appDir, 'node_modules'), 'turndown', 'turndown.cjs.js')
  const dominoRoot = join(appDir, 'node_modules/turndown/node_modules')
  createRuntimePackage(dominoRoot, '@mixmark-io/domino', 'index.js')
  write(
    appOutDir,
    'resources/app/node_modules/turndown/stale.js',
    'stale collector output',
  )
  return { appDir, appOutDir, dominoRoot }
}

describe('desktop after-pack runtime staging', () => {
  it('copies direct and transitive runtime subsets while replacing collector output', async () => {
    const { appDir, appOutDir } = createFixture()

    await afterPack({
      appOutDir,
      electronPlatformName: 'win32',
      packager: { projectDir: appDir },
    })

    const appRoot = join(appOutDir, 'resources/app')
    const expected = [
      'node_modules/@joplin/turndown-plugin-gfm/lib/turndown-plugin-gfm.cjs.js',
      'node_modules/turndown/lib/turndown.cjs.js',
      'node_modules/@mixmark-io/domino/lib/index.js',
    ]
    for (const path of expected) {
      expect(readFileSync(join(appRoot, ...path.split('/')), 'utf8')).toContain('runtime')
    }
    expect(existsSync(join(appRoot, 'node_modules/turndown/stale.js'))).toBe(false)
    expect(existsSync(join(appRoot, 'node_modules/turndown/test/fixture.js'))).toBe(false)
    expect(existsSync(join(appRoot, 'node_modules/turndown/lib/ignored.js.map'))).toBe(false)
  })

  it('fails when a declared runtime entry is absent', async () => {
    const { appDir, appOutDir, dominoRoot } = createFixture()
    rmSync(join(dominoRoot, '@mixmark-io/domino/LICENSE'))

    await expect(copyDesktopRuntimePackages({ appDir, appOutDir })).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('does not stage packages for a non-Windows target', async () => {
    await expect(afterPack({
      appOutDir: 'unresolved',
      electronPlatformName: 'linux',
      packager: { projectDir: 'unresolved' },
    })).resolves.toBeUndefined()
  })
})
