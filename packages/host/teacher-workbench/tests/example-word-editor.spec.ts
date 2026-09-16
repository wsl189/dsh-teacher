/** Word editor round trips preserve mathematical objects and explicit user formatting. */

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { strFromU8, unzipSync, strToU8, zipSync } from 'fflate'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { createExampleWord, compileExampleWord, normalizeExampleWord } from '../src/example-word.ts'
import { readExampleWordEditor, saveExampleWordEditor, exampleWordParagraphsSchema } from '../src/example-word-editor.ts'
import { exampleHeadingEvidence, exampleWordNeedsHeading, removeExampleHeading } from '../src/example-word-heading.ts'

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
function xml(bytes: Uint8Array) { return new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']!), 'application/xml') }
function equations(bytes: Uint8Array) { return Array.from(xml(bytes).getElementsByTagNameNS(M, 'oMath')).map(node => new XMLSerializer().serializeToString(node)) }

describe('collection Word editing', () => {
  it.each([String.raw`A\text{ ⫋ }B\text{ ⫌ }C`, String.raw`\textbf{⫋⫌}`, String.raw`\subsetneqq\supsetneqq`])('keeps %s compact without changing equation size across saves and export', async (latex) => {
    let bytes = await createExampleWord(`$${latex}$`)
    for (const size of [12, 18, 5, 24, 12]) {
      const model = readExampleWordEditor(bytes)
      bytes = saveExampleWordEditor(bytes, model.paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, size, latex: inline.latex + '+1' } : inline),
      })))
      for (const document of [bytes, await compileExampleWord([{ bytes }])]) {
        expect(readExampleWordEditor(document).paragraphs.flatMap(row => row.content).filter(inline => inline.kind === 'equation').map(inline => inline.size)).toEqual([size])
        const runs = Array.from(xml(document).getElementsByTagNameNS(M, 'r'))
        const relations = runs.filter(run => run.textContent === '⫋' || run.textContent === '⫌')
        expect(relations).toHaveLength(2)
        for (const run of relations) {
          expect(run.getElementsByTagNameNS(W, 'sz').item(0)?.getAttributeNS(W, 'val')).toBe(String(Math.round(size * 2 * 0.8)))
          expect(run.getElementsByTagNameNS(W, 'position').item(0)?.getAttributeNS(W, 'val')).toBe(String(Math.round(size * 2 * 0.08)))
          expect(run.getElementsByTagNameNS(W, 'rFonts').item(0)?.getAttributeNS(W, 'ascii')).toBe('Cambria Math')
        }
        for (const run of runs.filter(run => /[ABC]/u.test(run.textContent ?? ''))) {
          expect(run.getElementsByTagNameNS(W, 'sz').item(0)?.getAttributeNS(W, 'val') ?? '24').toBe(String(size * 2))
          expect(run.getElementsByTagNameNS(W, 'position').length).toBe(0)
        }
        expect(await normalizeExampleWord(document)).toBeUndefined()
      }
    }
  })

  it.each(['sin', 'cos', 'tan', 'log', 'lg', 'ln'])('keeps local bold on the %s function name after editing', async (name) => {
    let bytes = await createExampleWord(`$\\mathbf{\\${name}}x+\\${name} y$`)
    for (const suffix of ['+1', '+2']) {
      bytes = saveExampleWordEditor(bytes, readExampleWordEditor(bytes).paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })))
      for (const document of [bytes, await compileExampleWord([{ bytes }])]) {
        const runs = Array.from(xml(document).getElementsByTagNameNS(M, 'r')).filter(run => run.textContent === name)
        expect(runs).toHaveLength(2)
        expect(runs.map(run => run.getElementsByTagNameNS(W, 'b').length > 0)).toEqual([true, false])
        expect(runs.map(run => run.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val'))).toEqual(['b', 'p'])
      }
    }
  })

  it('keeps a locally bold summation sign in its native control properties', async () => {
    let bytes = await createExampleWord(String.raw`$\mathbf{\sum}_{1}^{n}x+\sum_{1}^{n}y$`)
    for (const suffix of ['+1', '+2']) {
      bytes = saveExampleWordEditor(bytes, readExampleWordEditor(bytes).paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })))
      for (const document of [bytes, await compileExampleWord([{ bytes }])]) {
        const operators = Array.from(xml(document).getElementsByTagNameNS(M, 'naryPr'))
        expect(operators).toHaveLength(2)
        expect(operators.map(operator => operator.getElementsByTagNameNS(W, 'b').length > 0)).toEqual([true, false])
      }
    }
  })

  it('repairs saved summations with text outside native runs before exporting', async () => {
    const original = await createExampleWord(String.raw`$\sum_{i=1}^{n} x+1+2$`)
    const document = xml(original)
    const equation = document.getElementsByTagNameNS(M, 'oMath').item(0)!
    const suffix = equation.lastChild!
    const text = suffix.textContent ?? ''
    expect(text).toBe('+1+2')
    equation.removeChild(suffix)
    equation.getElementsByTagNameNS(M, 'e').item(0)!.appendChild(document.createTextNode(text))
    const entries = unzipSync(original)
    entries['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(document))
    const repaired = await normalizeExampleWord(zipSync(entries))
    expect(repaired).toBeDefined()
    expect(equations(await compileExampleWord([{ bytes: repaired! }]))).toEqual(equations(repaired!))
    const normalized = xml(repaired!).getElementsByTagNameNS(M, 'oMath').item(0)!
    expect(normalized.textContent).toBe(equation.textContent)
    for (const element of Array.from(normalized.getElementsByTagNameNS(M, '*'))) {
      if (element.localName !== 't') expect(Array.from(element.childNodes).filter(node => node.nodeType === 3 && node.textContent?.trim())).toHaveLength(0)
    }
  })

  it.each([
    String.raw`\sum_{i=1}^{n} x+y+2`, String.raw`\prod_{i=1}^{n} x+y+2`, String.raw`\int_{0}^{1} x+2`,
    String.raw`\sum_{i=1}^{n}\frac{x}{y}+2`, String.raw`\sum_{i=1}^{n}\sum_{j=1}^{m} a_{ij}+2`,
  ])('keeps native text runs and operand colors after %s through editing and export', async (latex) => {
    let bytes = await createExampleWord(`$\\textcolor{blue}{${latex}}$`)
    let expected = xml(bytes).getElementsByTagNameNS(M, 'oMath').item(0)!.textContent ?? ''
    for (const suffix of ['+3', '+4']) {
      bytes = saveExampleWordEditor(bytes, readExampleWordEditor(bytes).paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })))
      expected += suffix
      const exported = await compileExampleWord([{ bytes }])
      for (const document of [bytes, exported]) {
        const equation = xml(document).getElementsByTagNameNS(M, 'oMath').item(0)!
        expect(equation.textContent).toBe(expected)
        for (const element of Array.from(equation.getElementsByTagNameNS(M, '*'))) {
          if (element.localName === 't') continue
          expect(Array.from(element.childNodes).filter(node => node.nodeType === 3 && node.textContent?.trim())).toHaveLength(0)
        }
        const operand = Array.from(equation.getElementsByTagNameNS(M, 'r')).find(run => /[xa]/u.test(run.textContent ?? ''))!
        expect(operand.getElementsByTagNameNS(W, 'color').item(0)?.getAttributeNS(W, 'val')).toBe('0000FF')
      }
      expect(equations(exported)).toEqual(equations(bytes))
    }
  })

  it.each([String.raw`\perp`, String.raw`\bot`, '⊥'])('keeps local bold on %s after repeated editing', async (command) => {
    let bytes = await createExampleWord(`$${command}+\\mathbf{${command}}$`)
    for (const suffix of ['+1', '+2']) {
      bytes = saveExampleWordEditor(bytes, readExampleWordEditor(bytes).paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })))
      for (const document of [bytes, await compileExampleWord([{ bytes }])]) {
        const runs = Array.from(xml(document).getElementsByTagNameNS(M, 'r')).filter(run => run.textContent?.includes('⊥'))
        expect(runs).toHaveLength(2)
        expect(runs.map(run => run.getElementsByTagNameNS(W, 'b').length > 0)).toEqual([false, true])
      }
    }
  })

  it.each([String.raw`\Leftrightarrow`, String.raw`\Longleftrightarrow`])('keeps the length of %s with local bold across repeated saves', async (command) => {
    let bytes = await createExampleWord(`$${command}+\\boldsymbol{${command}}$`)
    let expected = xml(bytes).getElementsByTagNameNS(M, 'oMath').item(0)!.textContent ?? ''
    for (const suffix of ['+1', '+2']) {
      const model = readExampleWordEditor(bytes)
      bytes = saveExampleWordEditor(bytes, model.paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })))
      expected += suffix
      for (const document of [bytes, await compileExampleWord([{ bytes }])]) {
        expect(xml(document).getElementsByTagNameNS(M, 'oMath').item(0)!.textContent).toBe(expected)
      }
    }
  })

  it('keeps multi-letter function names upright in native Word after editing', async () => {
    const original = await createExampleWord(String.raw`$\lg x+\ln y+\sin z$`)
    const model = readExampleWordEditor(original)
    const saved = saveExampleWordEditor(original, model.paragraphs.map(row => ({ ...row,
      content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + '+1' } : inline),
    })))
    for (const bytes of [original, saved, await compileExampleWord([{ bytes: saved }])]) {
      const functions = Array.from(xml(bytes).getElementsByTagNameNS(M, 'r')).filter(run => ['lg', 'ln', 'sin'].includes(run.textContent ?? ''))
      expect(functions).toHaveLength(3)
      for (const run of functions) expect(run.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val')).toBe('p')
    }
  })

  it.each(['vec', 'overrightarrow', 'hat', 'widehat', 'bar', 'overline', 'tilde', 'dot', 'ddot'])('keeps the %s accent attached to its letters when reopening and editing', async (command) => {
    let bytes = await createExampleWord(`$\\boldsymbol{\\${command}{AB}}$`)
    for (const suffix of ['+1', '+2']) {
      const model = readExampleWordEditor(bytes)
      expect(model.equations[0]!.latex).toContain(`\\${command}{`)
      expect(model.equations[0]!.latex).not.toContain('\\overset')
      bytes = saveExampleWordEditor(bytes, model.paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })))
    }
    for (const document of [bytes, await compileExampleWord([{ bytes }])]) {
      const equation = xml(document).getElementsByTagNameNS(M, 'oMath').item(0)!
      expect(equation.textContent).toBe('AB+1+2')
      expect(equation.getElementsByTagNameNS(M, ['overline', 'bar'].includes(command) ? 'bar' : 'acc').length).toBe(1)
    }
  })

  it.each([
    ['mathbb', 'double-struck'], ['mathcal', 'script'], ['mathfrak', 'fraktur'], ['mathsf', 'sans-serif'], ['mathtt', 'monospace'],
  ])('keeps local bold and the %s alphabet together across repeated saves', async (command, script) => {
    let bytes = await createExampleWord(`$\\mathbf{\\${command}{N}}+\\${command}{N}$`)
    for (const suffix of ['+1', '+2']) {
      bytes = saveExampleWordEditor(bytes, readExampleWordEditor(bytes).paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })))
      for (const document of [bytes, await compileExampleWord([{ bytes }])]) {
        const runs = Array.from(xml(document).getElementsByTagNameNS(M, 'r')).filter(run => run.textContent === 'N')
        expect(runs).toHaveLength(2)
        for (const run of runs) expect(run.getElementsByTagNameNS(M, 'scr').item(0)?.getAttributeNS(M, 'val')).toBe(script)
        expect(runs[0]!.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val')).toBe('b')
        expect(runs[0]!.getElementsByTagNameNS(W, 'b').length).toBe(1)
        expect(runs[1]!.getElementsByTagNameNS(W, 'b').length).toBe(0)
      }
    }
  })

  it.each([
    String.raw`\boldsymbol{\text{∁}_U A+\frac{x}{\sqrt{y}}}`,
    String.raw`\boldsymbol{f''(x)+\widehat{ABC}}`,
    String.raw`A\text{ ⫋ }B\textbf{ ⫌ }C+AB\text{ ⫽⃥ }CD`,
  ])('keeps compound emphasis and textbook symbols in editable native structures: %s', async (latex) => {
    const original = await createExampleWord('符号')
    const paragraph = readExampleWordEditor(original).paragraphs[0]!
    const saved = saveExampleWordEditor(original, [{ ...paragraph, content: [{ kind: 'equation', original: null, latex, size: 18, bold: false }] }])
    const model = readExampleWordEditor(saved)
    const edited = saveExampleWordEditor(saved, model.paragraphs.map(row => ({ ...row,
      content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + '+1' } : inline),
    })))
    for (const bytes of [saved, edited, await compileExampleWord([{ bytes: edited }])]) {
      const equation = xml(bytes).getElementsByTagNameNS(M, 'oMath').item(0)!
      for (const text of Array.from(equation.getElementsByTagNameNS(M, 't'))) {
        expect(Array.from(text.childNodes).filter(node => node.nodeType === 1)).toHaveLength(0)
      }
      for (const run of Array.from(equation.getElementsByTagNameNS(M, 'r'))) {
        expect(run.getElementsByTagNameNS(W, 'rFonts').item(0)?.getAttributeNS(W, 'eastAsia'))
          .toBe('Cambria Math')
      }
      expect(equation.textContent?.replaceAll(/\s/gu, '')).toContain(latex.includes('∁') ? '∁UA' : latex.includes("f''") ? 'f′′(x)' : 'A⫋B⫌C+AB⫽⃥CD')
      expect(await normalizeExampleWord(bytes)).toBeUndefined()
    }
  })

  it.each([
    ['mathcal', 'script'], ['mathfrak', 'fraktur'], ['mathbb', 'double-struck'], ['mathsf', 'sans-serif'], ['mathtt', 'monospace'],
  ])('retains the %s mathematical alphabet and repairs a saved document with the alphabet missing', async (command, script) => {
    const original = await createExampleWord(`$\\${command}{C}$`)
    const model = readExampleWordEditor(original)
    const saved = saveExampleWordEditor(original, model.paragraphs.map(row => ({ ...row,
      content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, size: 18, bold: true } : inline),
    })))
    const broken = unzipSync(saved)
    const document = xml(saved)
    const alphabet = document.getElementsByTagNameNS(M, 'scr').item(0)!
    expect(alphabet.getAttributeNS(M, 'val')).toBe(script)
    alphabet.parentNode!.removeChild(alphabet)
    broken['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(document))
    const repaired = await normalizeExampleWord(zipSync(broken))
    expect(repaired).toBeDefined()
    for (const bytes of [saved, repaired!]) {
      expect(xml(bytes).getElementsByTagNameNS(M, 'scr').item(0)?.getAttributeNS(M, 'val')).toBe(script)
      expect(xml(bytes).getElementsByTagNameNS(M, 'nor').length).toBe(0)
      expect(readExampleWordEditor(bytes).paragraphs[0]!.content[0]).toMatchObject({ kind: 'equation', size: 18, bold: true })
      expect(await normalizeExampleWord(bytes)).toBeUndefined()
    }
  })

  it('repairs an invalid compound native text run without losing saved size or emphasis', async () => {
    const original = await createExampleWord(String.raw`$\boldsymbol{b=(1,-\sqrt{3})}$`)
    const document = xml(original)
    const equation = document.getElementsByTagNameNS(M, 'oMath').item(0)!
    const run = document.createElementNS(M, 'm:r')
    const text = document.createElementNS(M, 'm:t')
    while (equation.firstChild !== null) text.appendChild(equation.firstChild)
    run.appendChild(text)
    equation.appendChild(run)
    const entries = unzipSync(original)
    entries['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(document))
    const repaired = await normalizeExampleWord(zipSync(entries))
    expect(repaired).toBeDefined()
    const restored = xml(repaired!).getElementsByTagNameNS(M, 'oMath').item(0)!
    expect(restored.textContent).toBe('b=(1,−3)')
    expect(restored.getElementsByTagNameNS(M, 'rad')).toHaveLength(1)
    for (const leaf of Array.from(restored.getElementsByTagNameNS(M, 't'))) expect(leaf.childNodes.length).toBe(1)
    expect(restored.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val')).toBe('bi')
    expect(await normalizeExampleWord(repaired!)).toBeUndefined()
  })

  it.each([
    { latex: String.raw`\mathbf{\subsetneqq}\subsetneqq`, glyph: '⫋' },
    { latex: String.raw`\mathbfit{\supsetneqq}\supsetneqq`, glyph: '⫌' },
    { latex: String.raw`\mathbf{\leqslant}\leqslant`, glyph: '⩽' },
    { latex: String.raw`\mathbfit{\geqslant}\geqslant`, glyph: '⩾' },
    { latex: String.raw`\mathbf{\subseteq}\subseteq`, glyph: '⊆' },
    { latex: String.raw`\mathbf{\supseteq}\supseteq`, glyph: '⊇' },
    { latex: String.raw`\mathbf{\complement}\complement`, glyph: '∁' },
    { latex: String.raw`\mathbf{\forall}\forall`, glyph: '∀' },
    { latex: String.raw`\mathbf{\exists}\exists`, glyph: '∃' },
    { latex: String.raw`\mathbf{\nexists}\nexists`, glyph: '∄' },
    { latex: String.raw`\mathbf{\nparallel}\nparallel`, glyph: '∦' },
    { latex: String.raw`\mathbf{\odot}\odot`, glyph: '⊙' },
    { latex: String.raw`\textbf{▱}\text{▱}`, glyph: '▱' },
    { latex: String.raw`\textbf{⫽}\text{⫽}`, glyph: '⫽' },
  ])('preserves local bold on $glyph while its neighbor stays regular through edits and export', async ({ latex, glyph }) => {
    const original = await createExampleWord('符号：')
    const paragraph = readExampleWordEditor(original).paragraphs[0]!
    let bytes = saveExampleWordEditor(original, [{ ...paragraph, content: [{ kind: 'equation', original: null, latex, size: 12, bold: false }] }])
    for (const suffix of ['', '+1', '+2']) {
      if (suffix) bytes = saveExampleWordEditor(bytes, readExampleWordEditor(bytes).paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })))
      for (const document of [bytes, await compileExampleWord([{ bytes }])]) {
        const runs = Array.from(xml(document).getElementsByTagNameNS(M, 'r')).filter(run => run.textContent?.includes(glyph))
        expect(runs).toHaveLength(2)
        expect(runs[0]!.textContent).toBe(glyph)
        expect(runs[0]!.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val')).toBe('b')
        expect(runs[0]!.getElementsByTagNameNS(W, 'b').length).toBe(1)
        expect(runs[1]!.getElementsByTagNameNS(W, 'b').length).toBe(0)
      }
    }
  })

  it.each([String.raw`\text{∁}`, String.raw`\complement`])('keeps the complement upright and its set names italic in saved and compiled Word: %s', async (command) => {
    const original = await createExampleWord(`$${command}_U A$`)
    const saved = saveExampleWordEditor(original, readExampleWordEditor(original).paragraphs.map(row => ({ ...row,
      content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + '+1' } : inline),
    })))
    for (const bytes of [original, saved, await compileExampleWord([{ bytes: saved }])]) {
      const equation = xml(bytes).getElementsByTagNameNS(M, 'oMath').item(0)!
      const runs = Array.from(equation.getElementsByTagNameNS(M, 'r'))
      const sign = runs.find(run => run.textContent === '∁')!
      const style = sign.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val')
        ?? (sign.getElementsByTagNameNS(M, 'nor').length > 0 ? 'p' : 'i')
      expect(style).toBe('p')
      expect(sign.getElementsByTagNameNS(M, 'nor')).toHaveLength(0)
      const fonts = sign.getElementsByTagNameNS(W, 'rFonts').item(0)!
      for (const slot of ['ascii', 'hAnsi', 'eastAsia', 'cs']) expect(fonts.getAttributeNS(W, slot)).toBe('Cambria Math')
      const entries = unzipSync(bytes)
      expect(entries['word/fonts/dsh-complement.odttf']).toBeUndefined()
      expect(strFromU8(entries['word/document.xml']!)).not.toContain('DSH Math Symbols')
      const letters = runs.filter(run => /[UA]/.test(run.textContent ?? ''))
      expect(letters.flatMap(run => run.textContent?.match(/[UA]/g) ?? [])).toEqual(['U', 'A'])
      for (const letter of letters) {
        expect(letter.getElementsByTagNameNS(M, 'nor').length).toBe(0)
        expect(letter.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val') ?? 'i').toBe('i')
      }
      expect(equation.getElementsByTagNameNS(M, 'sub').item(0)?.textContent).toBe('U')
      expect(await normalizeExampleWord(bytes)).toBeUndefined()
    }
  })

  it('repairs the missing-glyph text font without changing equation letters, formatting, or preview MathML', async () => {
    const original = await createExampleWord(String.raw`$\textcolor{blue}{\textbf{X∁Y∁}}+\text{∁}_U A$`)
    const edited = saveExampleWordEditor(original, readExampleWordEditor(original).paragraphs.map(row => ({ ...row,
      content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, size: 18 } : inline),
    })))
    const entries = unzipSync(edited)
    entries['word/document.xml'] = strToU8(strFromU8(entries['word/document.xml']!).replaceAll('Cambria Math', 'DSH Math Symbols').replaceAll('<m:sty', '<m:nor m:val="1"/><m:sty'))
    entries['word/fontTable.xml'] = strToU8(`<w:fonts xmlns:w="${W}"><w:font w:name="Other Font"/><w:font w:name="DSH Math Symbols"><w:embedRegular/></w:font></w:fonts>`)
    entries['word/_rels/fontTable.xml.rels'] = strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="otherFont" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/other.odttf"/><Relationship Id="dshComplementFont" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/dsh-complement.odttf"/></Relationships>')
    entries['word/fonts/other.odttf'] = new Uint8Array([1, 2, 3])
    entries['word/fonts/dsh-complement.odttf'] = new Uint8Array([4, 5, 6])
    const repaired = await normalizeExampleWord(zipSync(entries))
    expect(repaired).toBeDefined()
    const output = unzipSync(repaired!)
    expect(output['docProps/custom.xml']).toEqual(entries['docProps/custom.xml'])
    expect(output['word/fonts/dsh-complement.odttf']).toBeUndefined()
    expect(strFromU8(output['word/fontTable.xml']!)).not.toContain('DSH Math Symbols')
    expect(strFromU8(output['word/_rels/fontTable.xml.rels']!)).not.toContain('dshComplementFont')
    expect(output['word/fonts/other.odttf']).toEqual(entries['word/fonts/other.odttf'])
    expect(strFromU8(output['word/fontTable.xml']!)).toContain('Other Font')
    expect(strFromU8(output['word/_rels/fontTable.xml.rels']!)).toContain('Id="otherFont"')
    const runs = Array.from(xml(repaired!).getElementsByTagNameNS(M, 'r'))
    expect(runs.map(run => run.textContent).join('')).toBe('X∁Y∁+∁UA')
    expect(runs.filter(run => run.textContent === '∁')).toHaveLength(3)
    for (const run of runs) {
      expect(run.getElementsByTagNameNS(W, 'rFonts').item(0)?.getAttributeNS(W, 'ascii'))
        .toBe('Cambria Math')
      expect(run.getElementsByTagNameNS(W, 'sz').item(0)?.getAttributeNS(W, 'val')).toBe('36')
    }
    for (const run of runs.slice(0, 4)) {
      expect(run.getElementsByTagNameNS(W, 'b').length).toBe(1)
      expect(run.getElementsByTagNameNS(W, 'color').item(0)?.getAttributeNS(W, 'val')).toBe('0000FF')
    }
    expect(await normalizeExampleWord(repaired!)).toBeUndefined()
    expect(unzipSync(await createExampleWord('$A+B$'))['word/fonts/dsh-complement.odttf']).toBeUndefined()
  })

  it.each([
    { latex: String.raw`\complement_U A`, text: '∁UA' },
    { latex: String.raw`A\subsetneqq B\supsetneqq C`, text: 'A⫋B⫌C' },
    { latex: String.raw`A\subseteq B\supseteq C`, text: 'A⊆B⊇C' },
    { latex: String.raw`a\leqslant b\geqslant c`, text: 'a⩽b⩾c' },
    { latex: "f'(x)", text: 'f′(x)' },
    { latex: "f''(x)", text: 'f′′(x)' },
    { latex: "f'''(x)", text: 'f′′′(x)' },
    { latex: String.raw`\forall x\exists y\nexists z`, text: '∀x∃y∄z' },
    { latex: String.raw`AB\nparallel CD`, text: 'AB∦CD' },
    { latex: String.raw`\odot O`, text: '⊙O' },
    { latex: String.raw`\text{▱}ABCD`, text: '▱ABCD' },
  ])('retains $text through repeated equation edits and Word export', async ({ latex, text }) => {
    const original = await createExampleWord('符号：')
    const paragraph = readExampleWordEditor(original).paragraphs[0]!
    let bytes = saveExampleWordEditor(original, [{ ...paragraph, content: [{ kind: 'equation', original: null, latex, size: 12, bold: false }] }])
    for (const suffix of ['+1', '+2']) {
      bytes = saveExampleWordEditor(bytes, readExampleWordEditor(bytes).paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })))
    }
    const exported = await compileExampleWord([{ bytes }])
    for (const document of [bytes, exported]) {
      expect(xml(document).getElementsByTagNameNS(M, 'oMath').item(0)?.textContent?.replaceAll(/\s/gu, '')).toBe(text + '+1+2')
    }
  })

  it.each([
    String.raw`\mathbfit{b}=(1,-\sqrt{3})`,
    String.raw`\mathbfit{b=\left(1,-\sqrt{3}\right)}`,
    String.raw`\colorbox{yellow}{$\textcolor{blue}{\mathbfit{b}=(1,-\sqrt{3})}$}`,
  ])('saves, reopens, edits, and exports the complete MathLive formula %s', async (latex) => {
    const original = await createExampleWord('已知：')
    const first = readExampleWordEditor(original).paragraphs[0]!
    const saved = saveExampleWordEditor(original, [{ ...first, content: [{ kind: 'equation', original: null, latex, size: 14, bold: false }] }])
    const reopened = readExampleWordEditor(saved)
    const edited = saveExampleWordEditor(saved, reopened.paragraphs.map(paragraph => ({ ...paragraph,
      content: paragraph.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: `${inline.latex}+1` } : inline),
    })))
    const exported = await compileExampleWord([{ bytes: edited }])
    for (const bytes of [saved, edited, exported]) {
      const equation = xml(bytes).getElementsByTagNameNS(M, 'oMath').item(0)!
      expect(equation.textContent).toContain('b=(1,−3)')
      const letter = Array.from(equation.getElementsByTagNameNS(M, 'r')).find(run => run.textContent === 'b')!
      expect(letter.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val')).toBe('bi')
      expect(readExampleWordEditor(bytes).equations[0]?.mathml).not.toContain('<annotation')
      if (latex.includes('colorbox')) {
        expect(equation.getElementsByTagNameNS(W, 'color').item(0)?.getAttributeNS(W, 'val')).toBe('0000FF')
        expect(equation.getElementsByTagNameNS(W, 'shd').item(0)?.getAttributeNS(W, 'fill')).toBe('FFFF00')
      }
    }
    expect(xml(exported).getElementsByTagNameNS(M, 'oMath').item(0)?.textContent).toContain('+1')
  })

  it('keeps nested formula colors on letters, accents, roots, and fraction bars through saving and export', async () => {
    const original = await createExampleWord(String.raw`$\textcolor{blue}{\hat{a}+\frac{x}{\textcolor{red}{y}}+\sqrt{z}}+\textcolor{#00aa66}{c}+d$`)
    const model = readExampleWordEditor(original)
    expect(model.equations[0]?.latex).toContain('\\textcolor{#0000ff}')
    expect(model.equations[0]?.latex).toContain('\\textcolor{#ff0000}')
    const formatted = model.paragraphs.map(paragraph => ({ ...paragraph,
      content: paragraph.content.map(inline => inline.kind === 'equation' ? { ...inline, size: 18, bold: true } : inline),
    }))
    const saved = saveExampleWordEditor(original, formatted)
    const compiled = await compileExampleWord([{ bytes: saved }, { bytes: saved, pageBreakBefore: true }])
    for (const bytes of [original, saved, compiled]) {
      const equation = xml(bytes).getElementsByTagNameNS(M, 'oMath').item(0)!
      const runs = Array.from(equation.getElementsByTagNameNS(M, 'r')).map(run => ({ text: run.getElementsByTagNameNS(M, 't').item(0)?.textContent ?? '', color: run.getElementsByTagNameNS(W, 'color').item(0)?.getAttributeNS(W, 'val') }))
      for (const letter of ['a', 'x', 'z']) expect(runs.find(run => run.text.includes(letter))?.color).toBe('0000FF')
      expect(runs.find(run => run.text.includes('y'))?.color).toBe('FF0000')
      expect(runs.find(run => run.text.includes('c'))?.color).toBe('00AA66')
      expect(runs.find(run => run.text.includes('d'))?.color).toBeUndefined()
      for (const structure of ['acc', 'f', 'rad']) expect(equation.getElementsByTagNameNS(M, `${structure}Pr`).item(0)?.getElementsByTagNameNS(W, 'color').item(0)?.getAttributeNS(W, 'val')).toBe('0000FF')
      expect(await normalizeExampleWord(bytes)).toBeUndefined()
    }
    const parts = unzipSync(saved)
    const legacy = xml(saved)
    for (const color of Array.from(legacy.getElementsByTagNameNS(W, 'color'))) color.parentNode!.removeChild(color)
    parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(legacy))
    const repaired = await normalizeExampleWord(zipSync(parts))
    expect(repaired).toBeDefined()
    expect(readExampleWordEditor(repaired!).paragraphs).toEqual(formatted)
    expect(equations(repaired!)).toEqual(equations(saved))
    expect(await normalizeExampleWord(repaired!)).toBeUndefined()
    const reopened = readExampleWordEditor(repaired!)
    const reedited = saveExampleWordEditor(repaired!, reopened.paragraphs.map(paragraph => ({ ...paragraph,
      content: paragraph.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: `${inline.latex}+1` } : inline),
    })))
    expect(xml(reedited).getElementsByTagNameNS(W, 'color').length).toBeGreaterThan(0)
    expect(readExampleWordEditor(reedited).equations[0]?.latex).toContain('\\textcolor{#ff0000}')
  })

  it('preserves independently colored repeated letters and background fills', async () => {
    const bytes = await createExampleWord(String.raw`$\textcolor{red}{a}\textcolor{blue}{a}+\colorbox{yellow}{b}$`)
    const native = xml(bytes)
    const colors = Array.from(native.getElementsByTagNameNS(M, 'r')).filter(run => run.textContent === 'a').map(run => run.getElementsByTagNameNS(W, 'color').item(0)?.getAttributeNS(W, 'val'))
    expect(colors).toEqual(['FF0000', '0000FF'])
    expect(Array.from(native.getElementsByTagNameNS(W, 'shd')).map(node => node.getAttributeNS(W, 'fill'))).toContain('FFFF00')
  })

  it('retains the compact slanted parallel glyph through editing, bold changes, and export', async () => {
    const original = await createExampleWord(String.raw`$AB\text{ ⫽ }CD$`)
    const model = readExampleWordEditor(original)
    const formatted = model.paragraphs.map(paragraph => ({ ...paragraph,
      content: paragraph.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: model.equations[0]!.latex, bold: true } : inline),
    }))
    const saved = saveExampleWordEditor(original, formatted)
    const compiled = await compileExampleWord([{ bytes: saved }])
    for (const bytes of [original, saved, compiled]) {
      const text = xml(bytes).getElementsByTagNameNS(M, 'oMath').item(0)?.textContent
      expect(text?.replaceAll('\u00a0', '')).toBe('AB⫽CD')
      expect(readExampleWordEditor(bytes).equations[0]?.latex).toContain('⫽')
    }
  })

  it('keeps growing left braces and editable rows through equation-system formatting and export', async () => {
    const original = await createExampleWord(String.raw`$\textcolor{blue}{\begin{cases}x+y=3\\\mathbf{a}=2\\x-y=1\end{cases}}$`)
    const model = readExampleWordEditor(original)
    const formatted = model.paragraphs.map(paragraph => ({ ...paragraph,
      content: paragraph.content.map(inline => inline.kind === 'equation' ? { ...inline, bold: true, size: 18 } : inline),
    }))
    const saved = saveExampleWordEditor(original, formatted)
    const compiled = await compileExampleWord([{ bytes: saved }])
    const regular = saveExampleWordEditor(saved, model.paragraphs)
    for (const bytes of [original, saved, compiled, regular]) {
      const document = xml(bytes)
      const delimiters = document.getElementsByTagNameNS(M, 'd')
      expect(delimiters.length).toBe(1)
      const system = delimiters.item(0)!
      expect(system.getElementsByTagNameNS(M, 'begChr').item(0)?.getAttributeNS(M, 'val')).toBe('{')
      expect(system.getElementsByTagNameNS(M, 'endChr').item(0)?.getAttributeNS(M, 'val')).toBe('')
      expect(system.getElementsByTagNameNS(M, 'grow').item(0)?.getAttributeNS(M, 'val')).toBe('1')
      expect(system.getElementsByTagNameNS(M, 'dPr').item(0)?.getElementsByTagNameNS(W, 'color').item(0)?.getAttributeNS(W, 'val')).toBe('0000FF')
      expect(system.getElementsByTagNameNS(M, 'mcJc').item(0)?.getAttributeNS(M, 'val')).toBe('left')
      expect(Array.from(system.getElementsByTagNameNS(M, 'mr')).map(row => row.textContent)).toEqual(['x+y=3', 'a=2', 'x−y=1'])
      expect(await normalizeExampleWord(bytes)).toBeUndefined()
    }
    expect(readExampleWordEditor(compiled).paragraphs).toEqual(formatted)
  })

  it('saves five-point text and equations through compilation and rejects smaller editor sizes', async () => {
    const original = await createExampleWord('注：$x=1$。')
    const paragraphs = readExampleWordEditor(original).paragraphs.map(paragraph => ({ ...paragraph,
      content: paragraph.content.map(inline => inline.kind === 'text' ? { ...inline, format: { ...inline.format, size: 5 } }
        : inline.kind === 'equation' ? { ...inline, size: 5 } : inline),
    }))
    expect(exampleWordParagraphsSchema.parse(paragraphs)).toEqual(paragraphs)
    const saved = saveExampleWordEditor(original, paragraphs)
    const compiled = await compileExampleWord([{ bytes: saved }])
    expect(readExampleWordEditor(compiled).paragraphs).toEqual(paragraphs)
    expect(readExampleWordEditor(compiled).equations[0]?.mathml).toContain('5pt')
    for (const kind of ['text', 'equation']) {
      const smaller = paragraphs.map(paragraph => ({ ...paragraph,
        content: paragraph.content.map(inline => inline.kind !== kind ? inline
          : inline.kind === 'text' ? { ...inline, format: { ...inline.format, size: 4.5 } } : { ...inline, size: 4.5 }),
      }))
      expect(exampleWordParagraphsSchema.safeParse(smaller).success).toBe(false)
    }
  })

  it('retains native equations and embedded images while saving text, fonts, emphasis, and spacing through compilation', async () => {
    const image = await sharp({ create: { width: 70, height: 50, channels: 3, background: 'white' } }).png().toBuffer()
    const original = await createExampleWord('已知 $\\boldsymbol{a}+\\vec{b}=\\frac{1}{2}$，求值。\n（1）计算。\n（2）证明。\n（i）第一步。\n![](images/a.png)', [{ name: 'images/a.png', mediaType: 'image/png', contentBase64: image.toString('base64') }])
    const model = readExampleWordEditor(original)
    expect(model.paragraphs.map(p => p.indent)).toEqual([0, 12, 12, 24, 0])
    const paragraphs = model.paragraphs.map((paragraph, index) => index === 0 ? { ...paragraph, lineSpacing: 1.75, alignment: 'center' as const, content: paragraph.content.map(inline => inline.kind === 'text' ? { ...inline, text: `${inline.text}编辑`, format: { ...inline.format, font: 'Arial', eastAsiaFont: '楷体', size: 16, bold: true, underline: true } } : inline) } : paragraph)
    const saved = saveExampleWordEditor(original, paragraphs)
    expect(equations(saved)).toEqual(equations(original))
    expect(readExampleWordEditor(saved).paragraphs).toEqual(paragraphs)
    expect(Object.entries(unzipSync(saved)).filter(([name]) => name.startsWith('word/media/'))).toEqual(Object.entries(unzipSync(original)).filter(([name]) => name.startsWith('word/media/')))
    expect(await normalizeExampleWord(saved)).toBeUndefined()
    expect(exampleWordNeedsHeading(saved)).toBe(false)
    const compiled = await compileExampleWord([{ bytes: saved }, { bytes: saved, blankLinesBefore: true }])
    expect(readExampleWordEditor(compiled).paragraphs[0]).toEqual(paragraphs[0])
    expect(equations(compiled)).toEqual([...equations(saved), ...equations(saved)])
    expect(readExampleWordEditor(compiled).images).toHaveLength(2)
  })

  it('inserts and replaces editable equations, updates previews, and handles a text-only starting document', async () => {
    const original = await createExampleWord('求解：')
    const model = readExampleWordEditor(original)
    const first = model.paragraphs[0]!
    const saved = saveExampleWordEditor(original, [{ ...first, content: [...first.content, { kind: 'equation', original: null, latex: '\\frac{x+1}{2}=3', size: 18, bold: false }] }])
    expect(equations(saved)).toHaveLength(1)
    const edited = readExampleWordEditor(saved)
    expect(edited.equations[0]?.latex).toContain('frac')
    expect(edited.equations[0]?.mathml).toContain('18pt')
    expect(edited.paragraphs[0]?.content.at(-1)).toMatchObject({ kind: 'equation', size: 18 })
    const replaced = saveExampleWordEditor(saved, [{ ...edited.paragraphs[0]!, content: [{ kind: 'equation', original: 0, latex: 'x=5', size: 12, bold: false }] }])
    expect(xml(replaced).documentElement?.textContent).toBe('x=5')
    expect(readExampleWordEditor(replaced).equations).toHaveLength(1)
    expect(() => saveExampleWordEditor(saved, [{ ...first, content: [{ kind: 'equation', original: 0, latex: '\\doesNotExist{', size: 12, bold: false }] }])).toThrow()
    expect(() => saveExampleWordEditor(saved, [{ ...first, content: [{ kind: 'image', original: 8 }] }])).toThrow('Unknown image')
    expect(exampleWordParagraphsSchema.safeParse([{ ...first, lineSpacing: 0 }]).success).toBe(false)
  })

  it('keeps equation bold through reopening and export, and removes it without losing intrinsic vector styles', async () => {
    const original = await createExampleWord(String.raw`求值：$\sqrt{x}+\frac{a}{b}+\mathbf{v}$。`)
    const model = readExampleWordEditor(original)
    const withBold = (paragraphs: typeof model.paragraphs, bold: boolean) => paragraphs.map(paragraph => ({ ...paragraph,
      content: paragraph.content.map(inline => inline.kind === 'equation' ? { ...inline, bold } : inline),
    }))
    const boldParagraphs = withBold(model.paragraphs, true)
    expect(exampleWordParagraphsSchema.parse(boldParagraphs)).toEqual(boldParagraphs)
    expect(exampleWordParagraphsSchema.safeParse(withBold(model.paragraphs, 'true' as unknown as boolean)).success).toBe(false)
    const saved = saveExampleWordEditor(original, boldParagraphs)
    const reopened = readExampleWordEditor(saved)
    expect(reopened.paragraphs).toEqual(boldParagraphs)
    expect(reopened.equations[0]?.latex).toBe(model.equations[0]?.latex)
    expect(reopened.equations[0]?.mathml).toContain('font-weight:bold')
    const styles = Array.from(xml(saved).getElementsByTagNameNS(M, 'r')).map(run => run.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val'))
    expect(styles.length).toBeGreaterThan(3)
    expect(styles.every(style => style === 'b' || style === 'bi')).toBe(true)
    expect(xml(saved).getElementsByTagNameNS(M, 'radPr').item(0)?.getElementsByTagName('w:b').length).toBe(1)
    const compiled = await compileExampleWord([{ bytes: saved }, { bytes: saved, blankLinesBefore: true }])
    expect(equations(compiled)).toEqual([...equations(saved), ...equations(saved)])
    expect(readExampleWordEditor(compiled).paragraphs[0]).toEqual(boldParagraphs[0])
    const normal = saveExampleWordEditor(saved, withBold(reopened.paragraphs, false))
    expect(readExampleWordEditor(normal).paragraphs).toEqual(model.paragraphs)
    expect(readExampleWordEditor(normal).equations[0]?.latex).toBe(model.equations[0]?.latex)
    const runs = Array.from(xml(normal).getElementsByTagNameNS(M, 'r'))
    expect(runs.find(run => run.textContent === 'v')?.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val')).toBe('bi')
    expect(runs.find(run => run.textContent === 'x')?.getElementsByTagNameNS(M, 'sty').length).toBe(0)
  })

  it('retains option alignment while allowing a following paragraph to inherit unused tab stops', async () => {
    const original = await createExampleWord('求值。A.1 B.2 C.3 D.4')
    const model = readExampleWordEditor(original)
    const options = model.paragraphs.find(paragraph => paragraph.tabs.length === 3)!
    const next = { ...options, content: [{ kind: 'text' as const, text: '补充说明。', format: { font: 'Arial', eastAsiaFont: '宋体', size: 12, bold: false, italic: false, underline: false } }] }
    const saved = saveExampleWordEditor(original, [...model.paragraphs, next])
    const styles = Array.from(xml(saved).getElementsByTagName('w:pStyle')).map(style => style.getAttribute('w:val'))
    expect(styles).toEqual(['DshExampleEdited', 'DshExampleEditedChoices4', 'DshExampleEdited'])
    expect(readExampleWordEditor(saved).paragraphs.at(-1)).toEqual(next)
  })

  it('rechecks old heading decisions and removes later metadata while retaining continuation subparts', async () => {
    const original = await createExampleWord('【题4】（人教版）已知 $x>0$。\n（1）求值。\n【题4续】（变设问）\n（2）证明。\n（i）讨论。\n（ii）结论。')
    const reviewed = removeExampleHeading(original, [{ paragraph: 0, prefix: '【题4】（人教版）' }, { paragraph: 2, prefix: '【题4续】（变设问）' }])
    expect(exampleHeadingEvidence(reviewed).text).toBe('已知 ⟪math:0⟫。\n（1）求值。\n（2）证明。\n（i）讨论。\n（ii）结论。\n')
    expect(readExampleWordEditor(reviewed).paragraphs.map(p => p.indent)).toEqual([0, 12, 12, 24, 24])
    expect(equations(reviewed)).toEqual(equations(original))
    expect(() => removeExampleHeading(original, [{ paragraph: 1, prefix: '（1）' }])).toThrow()
    const entries = unzipSync(reviewed)
    entries['docProps/custom.xml'] = strToU8(strFromU8(entries['docProps/custom.xml']!).replace('>2</vt:lpwstr>', '>1</vt:lpwstr>'))
    expect(exampleWordNeedsHeading(zipSync(entries))).toBe(true)
  })
})
