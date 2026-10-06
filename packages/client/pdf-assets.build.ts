/** Embed version-matched PDF.js binary resources and their complete license texts. */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const directories = [
  ['cMapUrl', 'cmaps'], ['standardFontDataUrl', 'standard_fonts'], ['wasmUrl', 'wasm'],
] as const

/**
 * Collect binary resources and their license notices for one PDF.js version.
 *
 * @param root - the consuming package's resolved pdfjs-dist directory.
 * @returns inline resource definitions and an artifact banner retaining their licenses.
 */
export function bundledPdfAssets(root: string): { assets: string; licenseBanner: string } {
  const assets = JSON.stringify(Object.fromEntries(directories.map(([kind, directory]) => [kind, Object.fromEntries(
    readdirSync(join(root, directory)).filter(name => !name.startsWith('LICENSE')).sort()
      .map(name => [name, readFileSync(join(root, directory, name)).toString('base64')]),
  )])))
  const licenses = ['LICENSE', ...directories.flatMap(([, directory]) =>
    readdirSync(join(root, directory)).filter(name => name.startsWith('LICENSE')).sort()
      .map(name => `${directory}/${name}`),
  )]
  const notice = licenses.map(name => `${name}\n\n${readFileSync(join(root, name), 'utf8').trimEnd()}`).join('\n\n')
  return {
    assets,
    licenseBanner: ['//! Bundled PDF.js license notices', ...notice.split('\n').map(line => `// ${line}`)].join('\n'),
  }
}
