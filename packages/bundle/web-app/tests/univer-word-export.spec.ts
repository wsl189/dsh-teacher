/** Verify native Word equations and defaults in the shipped Univer export adapter. */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const pluginRoot = dirname(dirname(require.resolve('dsh-univer-office')))
const requirePlugin = createRequire(join(pluginRoot, 'package.json'))
// The external repack publishes JavaScript; these declarations cover the adapter's tested exports.
const policy = await import(/* @vite-ignore */ pathToFileURL(join(pluginRoot, 'lib/docx-policy.js')).href) as {
  normalizeWordExport(bytes: Uint8Array): Uint8Array
  exportNativeWord(output: string, writer: (temporary: string) => Promise<void>): Promise<void>
}
const zip = requirePlugin('fflate') as {
  zipSync(parts: Record<string, Uint8Array>): Uint8Array
  unzipSync(bytes: Uint8Array): Record<string, Uint8Array>
  strToU8(text: string): Uint8Array
  strFromU8(bytes: Uint8Array): string
}
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const styles = `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsia="宋体"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
const temporaryRoots: string[] = []

function fixture(body: string, additional: Record<string, string> = {}): Uint8Array {
  return zip.zipSync(Object.fromEntries(Object.entries({
    'word/document.xml': `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': styles,
    'word/_rels/document.xml.rels': '<Relationships/>',
    'word/media/image.png': 'unchanged illustration bytes',
    ...additional,
  }).map(([name, text]) => [name, zip.strToU8(text)])))
}

function xml(bytes: Uint8Array, name = 'word/document.xml'): string {
  return zip.strFromU8(zip.unzipSync(bytes)[name]!)
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 3 })))
})

describe('Word export defaults', () => {
  it('converts math across styled runs and retains surrounding text, explicit fonts, Chinese fonts and media', () => {
    const input = fixture(String.raw`<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="宋体"/><w:b/></w:rPr><w:t>ABC 123 中文 \(\frac{x</w:t></w:r><w:r><w:t>_1+2}{\sqrt{y}}=3\) cost $5 and $10.</w:t></w:r></w:p>`)
    const output = policy.normalizeWordExport(input)
    const document = xml(output)
    expect(document).toContain('<m:f>')
    expect(document).toContain('<m:sSub>')
    expect(document).toContain('<m:rad>')
    expect(document).not.toContain('\(')
    expect(document).toContain('ABC 123 中文 ')
    expect(document).toContain(' cost $5 and $10.')
    expect(document).toContain('w:ascii="Arial" w:eastAsia="宋体"')
    expect(xml(output, 'word/styles.xml')).toContain('w:ascii="Times New Roman"')
    expect(xml(output, 'word/styles.xml')).toContain('w:hAnsi="Times New Roman"')
    expect(xml(output, 'word/styles.xml')).toContain('w:eastAsia="宋体"')
    expect(xml(output, 'word/styles.xml')).not.toContain('minorHAnsi')
    for (const name of ['word/media/image.png', 'word/_rels/document.xml.rels']) {
      expect(zip.unzipSync(output)[name]).toEqual(zip.unzipSync(input)[name])
    }
  })

  it('uses Times New Roman for equation letters and digits without flattening operators or mathematical alphabets', () => {
    const output = policy.normalizeWordExport(fixture(String.raw`<w:p><w:r><w:t>\(x+12=\sin y+\mathbf{v}+\mathbb{R}\)</w:t></w:r></w:p>`))
    const document = xml(output)
    const runs = [...document.matchAll(/<m:r>([\s\S]*?)<\/m:r>/gu)].map(match => match[1]!)
    for (const value of ['x', '12', 'sin', 'y', 'v']) {
      const run = runs.find(run => run.includes(`>${value}</m:t>`))
      expect(run).toContain('w:ascii="Times New Roman"')
      expect(run).toContain('<m:nor m:val="1"/>')
      expect(run).toContain(`w:i w:val="${['x', 'y'].includes(value) ? '1' : '0'}"`)
    }
    expect(runs.find(run => run.includes('>+</m:t>'))).toContain('w:ascii="Cambria Math"')
    expect(document).toContain('m:scr m:val="double-struck"')
    expect(document).not.toContain('<w:drawing')
  })

  it('keeps display fractions, matrices and integrals native inside document parts and tables', () => {
    const output = policy.normalizeWordExport(fixture(String.raw`<w:tbl><w:tr><w:tc><w:p><w:r><w:t>\[\int_0^1 x^2 dx=\frac{1}{3}+\begin{pmatrix}a&amp;b\\c&amp;d\end{pmatrix}\]</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`, {
      'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Header \\(x^2\\)</w:t></w:r></w:p></w:hdr>`.replaceAll('\\\\', '\\'),
      'word/footer1.xml': `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>Footer \\(n_1\\)</w:t></w:r></w:p></w:ftr>`.replaceAll('\\\\', '\\'),
    }))
    const document = xml(output)
    expect(document).toContain('<w:tbl>')
    expect(document).toContain('<m:oMathPara>')
    expect(document).toContain('<m:nary>')
    expect(document).toContain('<m:f>')
    expect(document).toContain('<m:m>')
    expect(xml(output, 'word/header1.xml')).toContain('<m:sSup>')
    expect(xml(output, 'word/footer1.xml')).toContain('<m:sSub>')
  })

  it('preserves existing native equations and produces the same XML on a second export normalization', () => {
    const math = '<m:oMath><m:r><m:rPr><m:sty m:val="bi"/></m:rPr><m:t>x</m:t></m:r></m:oMath>'
    const first = policy.normalizeWordExport(fixture(`<w:p>${math}<w:r><w:t> 中文 123</w:t></w:r></w:p>`))
    expect(xml(first)).toContain(math)
    expect(xml(policy.normalizeWordExport(first))).toBe(xml(first))
    expect(xml(policy.normalizeWordExport(first), 'word/styles.xml')).toBe(xml(first, 'word/styles.xml'))
  })

  it.each([String.raw`\(\unsupported{a}\)`, String.raw`\(\)`, String.raw`\(x`, String.raw`\(x\]`, String.raw`\(\[x\]\)`])(
    'rejects invalid marked equations instead of exporting plain text: %s', (text) => {
      expect(() => policy.normalizeWordExport(fixture(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`))).toThrow('DOCX_EQUATION_INVALID')
    },
  )

  it('does not drop drawings or field nodes to join a formula', () => {
    expect(() => policy.normalizeWordExport(fixture(String.raw`<w:p><w:r><w:t>\(x</w:t></w:r><w:r><w:drawing/></w:r><w:r><w:t>+1\)</w:t></w:r></w:p>`))).toThrow('uninterrupted paragraph')
    expect(() => policy.normalizeWordExport(fixture(String.raw`<w:p><w:r><w:t>\(x+1\)</w:t><w:drawing/></w:r></w:p>`))).toThrow('unsupported drawing or field run')
  })

  it('publishes the complete converted file and preserves an existing destination on conversion failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-word-export-'))
    temporaryRoots.push(root)
    const output = join(root, 'result.docx')
    const valid = fixture(String.raw`<w:p><w:r><w:t>\(x^2\)</w:t></w:r></w:p>`)
    await policy.exportNativeWord(output, path => writeFile(path, valid))
    const saved = await readFile(output)
    expect(xml(saved)).toContain('<m:sSup>')
    const invalid = fixture(String.raw`<w:p><w:r><w:t>\(\unknown\)</w:t></w:r></w:p>`)
    await expect(policy.exportNativeWord(output, path => writeFile(path, invalid))).rejects.toThrow('DOCX_EQUATION_INVALID')
    expect(await readFile(output)).toEqual(saved)
    expect(await readdir(root)).toEqual(['result.docx'])
    await expect(policy.exportNativeWord(output, () => Promise.reject(new Error('upstream export failed')))).rejects.toThrow('upstream export failed')
    expect(await readFile(output)).toEqual(saved)
    expect(await readdir(root)).toEqual(['result.docx'])
  })
})
