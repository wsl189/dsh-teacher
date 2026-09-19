/** Verify directory exclusion while the shipped gateway drains a database. */
import * as fs from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

interface Manager {
  openByPath(file: string): unknown
  createUniverfile(file: string): unknown
  beginRequestByKey(key: string): () => void
  releaseDirectory(directory: string): Promise<{ ok: true; released: number }>
  dispose(): Promise<void>
}

interface Collaboration {
  hasConnections(): boolean
  dispose(): Promise<void>
}

const require = createRequire(import.meta.url)
const pluginRoot = path.dirname(path.dirname(require.resolve('dsh-univer-office')))
const gateway = await readFile(path.join(pluginRoot, 'artifacts/gateway.cjs'), 'utf8')
const start = gateway.indexOf('var UniverfileError = class extends Error {\n')
const end = gateway.indexOf('// src/gateway-app/transport/http.ts\n', start)
if (start < 0 || end < 0) throw new Error('Bundled Univer manager module is missing')
// The bundle has no module exports. Evaluate its manager with the existing collaboration factory seam.
const Manager = runInNewContext(`${gateway.slice(start, end)}\nUniverfileManager`, {
  Buffer,
  import_node_fs7: fs,
  import_node_path6: path,
  EventHub: class { hasConnections(): boolean { return false } },
}) as new (options: { createCollab: (file: string) => Collaboration }) => Manager

it('blocks every path within a closing directory until its database drains, leaving sibling paths available', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'dsh-univer-release-'))
  const directory = path.join(temporary, 'managed')
  const sibling = `${directory}-other`
  const draining = Promise.withResolvers<undefined>()
  let drainingStarted = false
  const first = path.join(directory, 'first.univer')
  const second = path.join(directory, 'second.univer')
  const created = path.join(directory, 'new.univer')
  const manager = new Manager({
    createCollab: file => ({
      hasConnections: () => false,
      dispose: async () => {
        if (file === first) {
          drainingStarted = true
          await draining.promise
        }
      },
    }),
  })
  let released: Promise<{ ok: true; released: number }> | undefined
  try {
    await mkdir(directory)
    await mkdir(sibling)
    await Promise.all([first, second, path.join(sibling, 'other.univer')].map(file => writeFile(file, 'fixture')))
    manager.openByPath(first)
    released = manager.releaseDirectory(directory)
    void released.catch(() => undefined)
    expect(drainingStarted).toBe(true)
    expect(() => manager.openByPath(second)).toThrow('closing')
    expect(() => manager.createUniverfile(created)).toThrow('closing')
    expect(() => manager.beginRequestByKey(Buffer.from(second).toString('base64url'))).toThrow('closing')
    await expect(manager.releaseDirectory(path.join(directory, 'nested'))).rejects.toThrow('still in use')
    await expect(manager.releaseDirectory(temporary)).rejects.toThrow('still in use')
    expect(() => manager.openByPath(path.join(sibling, 'other.univer'))).not.toThrow()
    draining.resolve(undefined)
    expect(await released).toEqual({ ok: true, released: 1 })
    expect(() => manager.openByPath(second)).not.toThrow()
    expect(() => manager.createUniverfile(created)).not.toThrow()
  } finally {
    draining.resolve(undefined)
    await released?.catch(() => undefined)
    await manager.dispose()
    await rm(temporary, { recursive: true, force: true })
  }
})
