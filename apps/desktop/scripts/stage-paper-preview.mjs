/** Stage the pinned standalone CAJ converter before Windows desktop packaging. */

import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const require = createRequire(new URL('../../../package.json', import.meta.url))
const { unzipSync } = require('fflate')
const target = fileURLToPath(new URL('../../../packages/host/teacher-workbench/third-party/caj2pdf/bin/win32-x64/', import.meta.url))
const url = 'https://github.com/sainnhe/caj2pdf-qt/releases/download/v0.1.6/caj2pdf-qt-windows-x86_64-v0.1.6.zip'
const digest = '39ccf21fbe32e5280f4b6c92b6ca0c49e8e88e9c30838b876c57b106bb694c01'
const names = ['caj2pdf.exe', 'mutool.exe', 'libjbigdec.dll', 'libjbig2codec.dll']
const { values } = parseArgs({ options: { archive: { type: 'string' } } })
let staged = false
try {
  staged = (await readFile(`${target}/revision.txt`, 'utf8')).trim() === digest
  if (staged) await Promise.all(names.map(name => access(`${target}/${name}`)))
} catch (error) {
  // Missing or incomplete generated binaries are staged again from the pinned archive.
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  staged = false
}
if (!staged) {
  const response = values.archive === undefined ? await fetch(url, { signal: AbortSignal.timeout(120_000) }) : null
  if (response !== null && !response.ok) throw new Error(`CAJ engine download returned HTTP ${response.status}`)
  const archive = values.archive === undefined
    ? new Uint8Array(await response.arrayBuffer()) : await readFile(values.archive)
  if (createHash('sha256').update(archive).digest('hex') !== digest) throw new Error('CAJ engine archive checksum mismatch')
  const entries = unzipSync(archive)
  await mkdir(target, { recursive: true })
  for (const name of names) {
    const bytes = entries[`external/${name}`]
    if (bytes === undefined) throw new Error(`CAJ engine archive is missing ${name}`)
    await writeFile(`${target}/${name}`, bytes)
  }
  await writeFile(`${target}/revision.txt`, `${digest}\n`)
}
console.log('Standalone CAJ paper preview engine staged (v0.1.6, Windows x64).')
