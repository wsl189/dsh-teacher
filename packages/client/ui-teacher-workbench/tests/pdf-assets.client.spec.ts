/** PDF mappings, fallback fonts, and decoders remain local and survive worker transfers. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { bundledPdfAssets } from '../../pdf-assets.build.ts'
import { WorkbenchPdfDataFactory } from '../src/client/pdf-assets.ts'

const require = createRequire(import.meta.url)
const bundlePath = join(import.meta.dirname, '../lib/client.js')

beforeEach(() => {
  vi.stubGlobal('__DSH_WORKBENCH_PDF_ASSETS__', {
    cMapUrl: { 'GBK-EUC-H.bcmap': 'AQID' },
    standardFontDataUrl: { 'FoxitSymbol.pfb': 'BAU=' },
    wasmUrl: { 'decoder.wasm': 'BgcI' },
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('workbench PDF resources', () => {
  it.each([
    ['cMapUrl', 'GBK-EUC-H.bcmap', [1, 2, 3]],
    ['standardFontDataUrl', 'FoxitSymbol.pfb', [4, 5]],
    ['wasmUrl', 'decoder.wasm', [6, 7, 8]],
  ] as const)('decodes %s resources from the client artifact', async (kind, filename, bytes) => {
    expect(Array.from(await new WorkbenchPdfDataFactory().fetch({ kind, filename }))).toEqual(bytes)
  })

  it('returns fresh bytes after a prior request is modified and transferred to a worker', async () => {
    const factory = new WorkbenchPdfDataFactory()
    const first = await factory.fetch({ kind: 'cMapUrl', filename: 'GBK-EUC-H.bcmap' })
    first[0] = 99
    if (!(first.buffer instanceof ArrayBuffer)) throw new Error('Expected independently transferable bytes')
    structuredClone(first, { transfer: [first.buffer] })
    expect(first.byteLength).toBe(0)
    expect(Array.from(await factory.fetch({ kind: 'cMapUrl', filename: 'GBK-EUC-H.bcmap' }))).toEqual([1, 2, 3])
  })

  it.each(['missing.bcmap', 'constructor', 'toString', '__proto__'])('rejects the unbundled filename %s', async (filename) => {
    await expect(new WorkbenchPdfDataFactory().fetch({ kind: 'cMapUrl', filename })).rejects.toThrow('not bundled')
  })

  it('embeds the installed PDF.js GBK mapping and its resource licenses', () => {
    const root = dirname(require.resolve('pdfjs-dist/package.json'))
    const resources = bundledPdfAssets(root)
    const assets: unknown = JSON.parse(resources.assets)
    expect(assets).toHaveProperty(['cMapUrl', 'GBK-EUC-H.bcmap'], readFileSync(join(root, 'cmaps/GBK-EUC-H.bcmap')).toString('base64'))
    for (const file of ['cmaps/LICENSE', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION']) {
      expect(resources.licenseBanner).toContain(readFileSync(join(root, file), 'utf8').trimEnd().split('\n').map(line => `// ${line}`).join('\n'))
    }
  })

  it.skipIf(!existsSync(bundlePath))('keeps local CMaps and their licenses in the published workbench artifact', () => {
    const root = dirname(require.resolve('pdfjs-dist/package.json'))
    const client = readFileSync(bundlePath, 'utf8')
    expect(client).toContain(bundledPdfAssets(root).licenseBanner)
    expect(client).toContain('GBK-EUC-H.bcmap')
    expect(client).toContain(readFileSync(join(root, 'cmaps/GBK-EUC-H.bcmap')).toString('base64'))
  })
})
