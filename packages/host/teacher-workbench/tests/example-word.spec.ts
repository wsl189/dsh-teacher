import { describe, expect, it } from 'vitest'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import sharp from 'sharp'
import { compileExampleWord, createExampleWord, exampleWordNeedsImages, normalizeExampleWord } from '../src/example-word.ts'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const equation = String.raw`$\overrightarrow{PA}\cdot(\overrightarrow{PB}+\overrightarrow{PC})$`

function documentXml(bytes: Uint8Array) {
  const xml = unzipSync(bytes)['word/document.xml']
  if (xml === undefined) throw new Error('missing Word document')
  const text = strFromU8(xml)
  return { text, document: new DOMParser().parseFromString(text, 'application/xml') }
}

describe('editable equations in collected Word documents', () => {
  it('retains comparisons and ampersands inside editable equations', async () => {
    const bytes = await createExampleWord(String.raw`范围 $0<x<1$，条件 $a>b>0$，标记 $\text{A\&B}$。`)
    const { text } = documentXml(bytes)
    const document = new DOMParser({ onError: (_level, message) => { throw new Error(message) } })
      .parseFromString(text, 'application/xml')
    const math = Array.from(document.getElementsByTagNameNS(MATH_NS, 'oMath')).map(node => node.textContent)
    expect(math).toEqual(['0<x<1', 'a>b>0', 'A&B'])
    expect(await normalizeExampleWord(bytes)).toBeUndefined()
  })

  it('keeps Roman subpart labels upright in their printed case while body variables remain italic', async () => {
    const source = ['（i）已知变量 i，求 $i^2$。', '(ii) 讨论变量 v。', '（I）求点 I 的位置。',
      '(II) 证明直线 AB 平行。', '（ⅲ）验证结论。', '(iv) Check the result.', '（1）变量 i 的值。'].join('\n')
    const original = await createExampleWord(source)
    const entries = unzipSync(original)
    const document = documentXml(original).document
    const firstLabel = Array.from(document.getElementsByTagNameNS(WORD_NS, 'r')).find(run => run.textContent === 'i')!
    const properties = firstLabel.getElementsByTagNameNS(WORD_NS, 'rPr').item(0)!
    const style = document.createElementNS(WORD_NS, 'w:rStyle')
    style.setAttributeNS(WORD_NS, 'w:val', 'DshExampleVariable')
    properties.appendChild(style)
    firstLabel.getElementsByTagNameNS(WORD_NS, 'i').item(0)!.setAttributeNS(WORD_NS, 'w:val', 'true')
    entries['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(document))
    const legacy = zipSync(entries)
    const repaired = await normalizeExampleWord(legacy)
    expect(repaired).toBeDefined()
    const combined = await compileExampleWord([{ bytes: legacy }, { bytes: original, blankLinesBefore: true }])
    for (const [bytes, copies] of [[original, 1], [repaired!, 1], [combined, 2]] as const) {
      const doc = documentXml(bytes).document
      const paragraphs = Array.from(doc.getElementsByTagNameNS(WORD_NS, 'p')).filter(p => p.textContent?.trim())
      expect(paragraphs.map(p => p.textContent)).toEqual(Array.from({ length: copies }, () => source.replace('$i^2$', 'i2').split('\n')).flat())
      for (const [index, paragraph] of paragraphs.entries()) {
        let offset = 0
        const prefixEnd = (paragraph.textContent ?? '').search(/[)）]/u) + 1
        for (const run of Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 'r'))) {
          if (offset < prefixEnd) {
            expect(run.getElementsByTagNameNS(WORD_NS, 'i').item(0)?.getAttributeNS(WORD_NS, 'val')).toBe('false')
          } else if (/^[iIv]$/u.test(run.textContent ?? '')) {
            expect(run.getElementsByTagNameNS(WORD_NS, 'i').item(0)?.getAttributeNS(WORD_NS, 'val')).toBe('true')
          }
          offset += run.textContent?.length ?? 0
        }
        expect(paragraph.getElementsByTagNameNS(WORD_NS, 'ind').item(0)?.getAttributeNS(WORD_NS, 'left'))
          .toBe(index % 7 === 6 ? '240' : '480')
      }
      expect(doc.getElementsByTagNameNS(MATH_NS, 'sSup').length).toBe(copies)
      expect(await normalizeExampleWord(bytes)).toBeUndefined()
    }
  })

  it('indents Roman-numbered subquestions in saved and compiled Word without changing their text or equations', async () => {
    const source = '已知曲线的方程。\n（1）求曲线的方程；\n（2）讨论下列情况。\n（i）若 $k=2$，证明直线过定点。\n(ii) 若 $k=3$，求交点。\n（Ⅲ）验证所得结论。\n（3）说明理由，条件（i）仍成立。'
    const original = await createExampleWord(source)
    const entries = unzipSync(original)
    entries['word/document.xml'] = strToU8(strFromU8(entries['word/document.xml']!).replace(/<w:ind\b[^>]*\/>/gu, ''))
    const legacy = zipSync(entries)
    const repaired = await normalizeExampleWord(legacy)
    expect(repaired).toBeDefined()
    const combined = await compileExampleWord([{ bytes: legacy }, { bytes: original, blankLinesBefore: true }])
    for (const [bytes, copies] of [[original, 1], [repaired!, 1], [combined, 2]] as const) {
      const document = documentXml(bytes).document
      const paragraphs = Array.from(document.getElementsByTagNameNS(WORD_NS, 'p')).filter(paragraph => paragraph.textContent?.trim())
      expect(paragraphs.map((paragraph) => {
        const indent = paragraph.getElementsByTagNameNS(WORD_NS, 'ind').item(0)
        if (indent === null) return null
        expect(paragraph.getElementsByTagNameNS(WORD_NS, 'keepLines').item(0)?.getAttributeNS(WORD_NS, 'val')).toBe('true')
        return [indent.getAttributeNS(WORD_NS, 'left'), indent.getAttributeNS(WORD_NS, 'firstLine')]
      })).toEqual(Array.from({ length: copies }, () => [null, ['240', '0'], ['240', '0'], ['480', '0'], ['480', '0'], ['480', '0'], ['240', '0']]).flat())
      expect(document.documentElement?.textContent).toBe(documentXml(original).document.documentElement?.textContent?.repeat(copies))
      expect(document.getElementsByTagNameNS(MATH_NS, 'oMath').length).toBe(2 * copies)
      expect(await normalizeExampleWord(bytes)).toBeUndefined()
    }
  })

  it('keeps lowercase mathematical letters bold italic in previews, downloads, and compiled Word', async () => {
    const source = String.raw`已知平面向量 $\mathbf{a}$，$\mathbf{b}$，且 $|\mathbf{a}|=2$，求 $\mathbf{a}$ 在 $\mathbf{b}$ 上的投影。$\mathbf{A}+\mathrm{a}+\sin a+\textbf{a}$`
    const original = await createExampleWord(source)
    const saved = unzipSync(original)
    saved['word/document.xml'] = strToU8(strFromU8(saved['word/document.xml']!)
      .replaceAll('<m:sty m:val="bi"', '<m:nor/><m:sty m:val="b"').replaceAll('<w:i/>', ''))
    saved['docProps/custom.xml'] = strToU8(strFromU8(saved['docProps/custom.xml']!).replaceAll('bold-italic', 'bold'))
    const legacy = zipSync(saved)
    const repaired = await normalizeExampleWord(legacy)
    expect(repaired).toBeDefined()
    const combined = await compileExampleWord([{ bytes: legacy }, { bytes: original, blankLinesBefore: true }])
    for (const [bytes, copies] of [[original, 1], [repaired!, 1], [combined, 2]] as const) {
      const doc = documentXml(bytes).document
      const variables = Array.from(doc.getElementsByTagNameNS(MATH_NS, 'r')).filter(run =>
        run.getElementsByTagNameNS(MATH_NS, 'sty').item(0)?.getAttributeNS(MATH_NS, 'val') === 'bi',
      )
      expect(variables.map(run => run.textContent)).toEqual(Array.from({ length: copies }, () => ['a', 'b', 'a', 'a', 'b']).flat())
      for (const variable of variables) {
        expect(variable.getElementsByTagNameNS(MATH_NS, 'nor').length).toBe(0)
        expect(variable.getElementsByTagNameNS(WORD_NS, 'rFonts').item(0)?.getAttributeNS(WORD_NS, 'ascii')).toBe('Cambria Math')
      }
      const ordinary = Array.from(doc.getElementsByTagNameNS(MATH_NS, 'r')).filter(run =>
        ['p', 'b'].includes(run.getElementsByTagNameNS(MATH_NS, 'sty').item(0)?.getAttributeNS(MATH_NS, 'val') ?? '') && /^[Aa]$/u.test(run.textContent ?? ''),
      )
      expect(ordinary.map(run => run.textContent)).toEqual(Array.from({ length: copies }, () => ['A', 'a', 'a']).flat())
      expect(doc.documentElement?.textContent).toBe(documentXml(original).document.documentElement?.textContent?.repeat(copies))
      const custom = new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['docProps/custom.xml']!), 'application/xml')
      expect(custom.documentElement?.textContent).toContain('mathvariant="bold-italic"')
      expect(await normalizeExampleWord(bytes)).toBeUndefined()
    }
  })

  it.each(['count', 'text'])('rejects a saved equation %s mismatch before changing letter formatting', async (mismatch) => {
    const bytes = await createExampleWord(String.raw`已知 $\mathbf{a}$，求其长度。`)
    const entries = unzipSync(bytes)
    entries['docProps/custom.xml'] = strToU8(strFromU8(entries['docProps/custom.xml']!).replaceAll('bold-italic', 'bold'))
    const document = documentXml(bytes).document
    if (mismatch === 'count') {
      const equation = document.getElementsByTagNameNS(MATH_NS, 'oMath').item(0)!
      equation.parentNode!.removeChild(equation)
    } else document.getElementsByTagNameNS(MATH_NS, 't').item(0)!.textContent = 'b'
    entries['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(document))
    await expect(normalizeExampleWord(zipSync(entries))).rejects.toThrow(mismatch === 'count'
      ? 'do not match their preview data' : 'would change equation text')
  })

  it('uses explicit Times New Roman letter and digit runs with italic variables and upright function names', async () => {
    const source = '[2019人教A版P20]已知平面向量 a，b，|a|=1，求 sinD；求四边形 ABCD 的面积。'
    const bytes = await createExampleWord(source)
    const { document } = documentXml(bytes)
    const runs = Array.from(document.getElementsByTagNameNS(WORD_NS, 'r'))
    for (const value of ['a', 'b', 'D', 'ABCD']) {
      const selected = runs.filter(run => run.textContent === value)
      expect(selected.length).toBeGreaterThan(0)
      for (const run of selected) {
        expect(run.getElementsByTagNameNS(WORD_NS, 'i').item(0)?.getAttributeNS(WORD_NS, 'val')).toBe('true')
        expect(run.getElementsByTagNameNS(WORD_NS, 'rFonts').item(0)?.getAttributeNS(WORD_NS, 'ascii')).toBe('Times New Roman')
      }
    }
    for (const value of ['1', 'sin', 'A', 'P', '2019', '20']) {
      expect(runs.find(run => run.textContent === value)?.getElementsByTagNameNS(WORD_NS, 'i').item(0)?.getAttributeNS(WORD_NS, 'val'))
        .toBe('false')
    }
    expect(runs.filter(run => run.textContent === 'a' || run.textContent === 'b')
      .every(run => run.getElementsByTagNameNS(WORD_NS, 'b').item(0)?.getAttributeNS(WORD_NS, 'val') === 'true')).toBe(true)
    expect(document.documentElement?.textContent).toBe(source)
    expect(await normalizeExampleWord(bytes)).toBeUndefined()
  })

  it('separates a collapsed option row from its stem with native tabs and retains every equation through export', async () => {
    const bytes = await createExampleWord(String.raw`已知向量 a，b，求其坐标。（） A. $\frac{1}{2}$ B. $-\frac{1}{2}$ C. $\sqrt{3}$ D. 2`)
    const original = documentXml(bytes).document
    const paragraphs = Array.from(original.getElementsByTagNameNS(WORD_NS, 'p'))
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]?.textContent).not.toContain('A.')
    expect(paragraphs[1]?.getElementsByTagNameNS(WORD_NS, 'pStyle').item(0)?.getAttributeNS(WORD_NS, 'val')).toBe('DshExampleChoices4')
    expect(paragraphs[1]?.getElementsByTagNameNS(WORD_NS, 'tabs').item(0)?.childNodes.length).toBe(3)
    const labels = Array.from(paragraphs[1]!.getElementsByTagNameNS(WORD_NS, 'r')).filter(run => /^[A-D]$/u.test(run.textContent ?? ''))
    expect(labels).toHaveLength(4)
    expect(labels.every(run => run.getElementsByTagNameNS(WORD_NS, 'i').item(0)?.getAttributeNS(WORD_NS, 'val') === 'false')).toBe(true)
    expect(await normalizeExampleWord(bytes)).toBeUndefined()
    const compiled = await compileExampleWord([{ bytes }, { bytes, blankLinesBefore: true }])
    expect(documentXml(compiled).document.getElementsByTagNameNS(MATH_NS, 'oMath').length).toBe(6)
    expect(documentXml(compiled).document.getElementsByTagNameNS(WORD_NS, 'tabs').length).toBe(2)
  })

  it('retains two-column and vertical option rows and removes Markdown-only empty paragraphs', async () => {
    const source = '题干\n\nA. 1\tB. 2\nC. 3\tD. 4\n\n题干\nA. 1\nB. 2\nC. 3\nD. 4'
    const bytes = await createExampleWord(source)
    const document = documentXml(bytes).document
    const paragraphs = Array.from(document.getElementsByTagNameNS(WORD_NS, 'p'))
    expect(paragraphs.map(paragraph => paragraph.getElementsByTagNameNS(WORD_NS, 'pStyle').item(0)?.getAttributeNS(WORD_NS, 'val')))
      .toEqual([undefined, 'DshExampleChoices2', 'DshExampleChoices2', undefined, ...Array<string>(4).fill('DshExampleChoices1')])
    expect(paragraphs.every(paragraph => (paragraph.textContent ?? '').trim() !== '')).toBe(true)
    expect(await normalizeExampleWord(bytes)).toBeUndefined()
  })

  it('keeps option labels next to formulas in generated and previously normalized Word files', async () => {
    const bytes = await createExampleWord('题干中的投影向量为\n（  ）\nA.\t$\\frac{1}{2}$\tB.\t$-\\frac{1}{2}$\nC.\t$\\frac{1}{4}$\tD.\t$-\\frac{1}{4}$')
    const entries = unzipSync(bytes)
    const original = documentXml(bytes).document
    const paragraphs = Array.from(original.getElementsByTagNameNS(WORD_NS, 'p'))
    expect(paragraphs.map(paragraph => paragraph.textContent)).toEqual(['题干中的投影向量为（  ）', 'A. 12B. −12', 'C. 14D. −14'])
    const saved = strFromU8(entries['word/document.xml']!).replaceAll('>. </w:t>', '>.\t</w:t>')
    expect(saved).toContain('>.\t</w:t>')
    entries['word/document.xml'] = strToU8(saved)
    const repaired = await normalizeExampleWord(zipSync(entries))
    expect(repaired).toBeDefined()
    const result = documentXml(repaired!).document
    expect(result.documentElement?.textContent).toBe(original.documentElement?.textContent)
    expect(result.getElementsByTagNameNS(MATH_NS, 'oMath').length).toBe(4)
    expect(Array.from(result.getElementsByTagNameNS(WORD_NS, 't')).every(text => !text.textContent?.includes('\t'))).toBe(true)
    expect(result.getElementsByTagNameNS(WORD_NS, 'tab').length).toBe(4)
    expect(await normalizeExampleWord(repaired!)).toBeUndefined()
  })

  it('aligns leading and inline illustrations to the right below the complete question without changing text or media', async () => {
    const image = await sharp({ create: { width: 120, height: 80, channels: 3, background: 'white' } }).png().toBuffer()
    const bytes = await createExampleWord('![首图](images/figure.png)\n题干前文 ![插图](images/figure.png) 后文。\nA. 1 B. 2 C. 3 D. 4', [
      { name: 'images/figure.png', mediaType: 'image/png', contentBase64: image.toString('base64') },
    ])
    const document = documentXml(bytes).document
    const paragraphs = Array.from(document.getElementsByTagNameNS(WORD_NS, 'p'))
    expect(paragraphs.map(paragraph => paragraph.textContent)).toEqual(['题干前文  后文。', 'A. 1B. 2C. 3D. 4', '', ''])
    for (const figure of paragraphs.slice(-2)) {
      expect(figure.getElementsByTagNameNS(WORD_NS, 'drawing').length).toBe(1)
      expect(figure.getElementsByTagNameNS(WORD_NS, 'jc').item(0)?.getAttributeNS(WORD_NS, 'val')).toBe('right')
    }
    expect(await normalizeExampleWord(bytes)).toBeUndefined()
    for (const figure of paragraphs.slice(-2)) {
      figure.getElementsByTagNameNS(WORD_NS, 'jc').item(0)!.setAttributeNS(WORD_NS, 'w:val', 'center')
    }
    const entries = unzipSync(bytes)
    entries['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(document))
    const updated = await normalizeExampleWord(zipSync(entries))
    expect(documentXml(updated!).text).toBe(documentXml(bytes).text)
  })

  it.each(['paired', 'grouped'])('embeds question and explanation images without relationship collisions in %s exports', async (layout) => {
    const sources: Buffer[] = []
    for (const color of ['red', 'blue']) {
      const image = await sharp({ create: { width: 1200, height: 600, channels: 3, background: color } }).png().toBuffer()
      sources.push(await createExampleWord(`![${color}](images/figure.png)\n正文 $x_1^2$\n![末尾图片](images/figure.png)`, [
        { name: 'images/figure.png', mediaType: 'image/png', contentBase64: image.toString('base64') },
      ]))
    }
    const sourceMedia = sources.map(bytes => Object.entries(unzipSync(bytes)).find(([name]) => /^word\/media\/.+\.png$/u.test(name))![1])
    const compiled = await compileExampleWord(sources.map((bytes, index) => ({
      bytes, pageBreakBefore: layout === 'grouped' && index > 0, blankLinesBefore: index > 0,
    })))
    const entries = unzipSync(compiled)
    const { document, text } = documentXml(compiled)
    const relationships = new DOMParser().parseFromString(strFromU8(entries['word/_rels/document.xml.rels']!), 'application/xml')
    const media = Array.from(document.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip'))
      .map((blip) => {
        const id = blip.getAttribute('r:embed')
        const target = Array.from(relationships.getElementsByTagName('Relationship')).find(node => node.getAttribute('Id') === id)!.getAttribute('Target')
        return entries[`word/${target}`]
      })
    expect(media).toEqual([sourceMedia[0], sourceMedia[0], sourceMedia[1], sourceMedia[1]])
    const content = Array.from(document.getElementsByTagNameNS(WORD_NS, 'p'))
      .filter(paragraph => paragraph.textContent?.trim() || paragraph.getElementsByTagNameNS(WORD_NS, 'drawing').length > 0)
      .map(paragraph => paragraph.getElementsByTagNameNS(WORD_NS, 'drawing').length > 0 ? 'image' : paragraph.textContent)
    expect(content).toEqual(['正文 x12', 'image', 'image', '正文 x12', 'image', 'image'])
    expect(document.getElementsByTagNameNS(MATH_NS, 'sSubSup').length).toBe(2)
    expect(document.documentElement?.textContent).not.toContain('![')
    expect(text).toContain('cx="2743200" cy="1371600"')
    for (const figure of Array.from(document.getElementsByTagNameNS(WORD_NS, 'p')).filter(paragraph =>
      paragraph.getElementsByTagNameNS(WORD_NS, 'drawing').length > 0)) {
      expect(figure.getElementsByTagNameNS(WORD_NS, 'jc').item(0)?.getAttributeNS(WORD_NS, 'val')).toBe('right')
    }
    expect(await normalizeExampleWord(compiled)).toBeUndefined()
    expect(exampleWordNeedsImages(compiled)).toBe(false)
  })

  it('shrinks oversized saved drawings without changing pixels, text formatting, or aspect ratio', async () => {
    const images = await Promise.all(([[900, 1200], [120, 80]] as const).map(async ([width, height], index) => ({
      name: `images/${String(index)}.png`, mediaType: 'image/png' as const,
      contentBase64: (await sharp({ create: { width, height, channels: 3, background: 'white' } }).png().toBuffer()).toString('base64'),
    })))
    const original = await createExampleWord('已知四边形 $ABCD$。\n![](images/0.png)\n![](images/1.png)', images)
    const entries = unzipSync(original)
    const doc = documentXml(original).document
    const drawing = doc.getElementsByTagNameNS(WORD_NS, 'drawing').item(0)!
    const inline = drawing.getElementsByTagName('wp:extent').item(0)!
    const picture = drawing.getElementsByTagName('a:ext').item(0)!
    for (const extent of [inline, picture]) {
      extent.setAttribute('cx', '5715000')
      extent.setAttribute('cy', '7620000')
    }
    const paragraph = doc.getElementsByTagNameNS(WORD_NS, 'p').item(1)!
    paragraph.getElementsByTagNameNS(WORD_NS, 'pStyle').item(0)!.setAttributeNS(WORD_NS, 'w:val', 'DshExampleEdited')
    entries['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(doc))
    const legacy = zipSync(entries)
    const repaired = await normalizeExampleWord(legacy)
    expect(repaired).toBeDefined()
    const compiled = await compileExampleWord([{ bytes: legacy }, { bytes: original, blankLinesBefore: true }])
    const expected = [[1543050, 2057400], [1143000, 762000]]
    for (const [bytes, copies] of [[original, 1], [repaired!, 1], [compiled, 2]] as const) {
      const document = documentXml(bytes).document
      const extents = (tag: string) => Array.from(document.getElementsByTagName(tag))
        .map(element => [Number(element.getAttribute('cx')), Number(element.getAttribute('cy'))])
      expect(extents('wp:extent')).toEqual(Array.from({ length: copies }, () => expected).flat())
      expect(extents('a:ext')).toEqual(extents('wp:extent'))
      expect(await normalizeExampleWord(bytes)).toBeUndefined()
    }
    const restored = documentXml(repaired!).document
    expect(restored.documentElement?.textContent).toBe(doc.documentElement?.textContent)
    expect(new XMLSerializer().serializeToString(restored.getElementsByTagNameNS(WORD_NS, 'p').item(1)!.firstChild!))
      .toBe(new XMLSerializer().serializeToString(paragraph.firstChild!))
    const media = (parts: Record<string, Uint8Array>) => Object.entries(parts).filter(([name]) => name.startsWith('word/media/'))
    expect(media(unzipSync(repaired!))).toEqual(media(entries))
    inline.setAttribute('cx', '0')
    entries['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(doc))
    await expect(normalizeExampleWord(zipSync(entries))).rejects.toThrow('image data or dimensions are invalid')
  })

  it('restores saved Markdown illustrations while preserving neighboring native equations and original text', async () => {
    const bytes = await createExampleWord('原来的题目 $x_1^2$。')
    const entries = unzipSync(bytes)
    entries['word/document.xml'] = strToU8(strFromU8(entries['word/document.xml']!).replace('</w:body>',
      '<w:p><w:r><w:t>前文 ![](images/figure.png) 后文</w:t></w:r></w:p></w:body>'))
    const saved = zipSync(entries)
    expect(exampleWordNeedsImages(saved)).toBe(true)
    const image = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'white' } }).png().toBuffer()
    const restored = await compileExampleWord([{ bytes: saved, images: [
      { name: 'images/figure.png', mediaType: 'image/png', contentBase64: image.toString('base64') },
    ] }, { bytes: await createExampleWord('下一题'), blankLinesBefore: true }])
    const doc = documentXml(restored).document
    expect(doc.documentElement?.textContent).toContain('前文  后文')
    expect(doc.documentElement?.textContent).toContain('原来的题目')
    expect(doc.getElementsByTagNameNS(MATH_NS, 'sSubSup').length).toBe(1)
    expect(doc.getElementsByTagNameNS(WORD_NS, 'drawing').length).toBe(1)
    const content = Array.from(doc.getElementsByTagNameNS(WORD_NS, 'p'))
      .filter(paragraph => paragraph.textContent?.trim() || paragraph.getElementsByTagNameNS(WORD_NS, 'drawing').length > 0)
      .map(paragraph => paragraph.getElementsByTagNameNS(WORD_NS, 'drawing').length > 0 ? 'image' : paragraph.textContent)
    expect(content).toEqual(['原来的题目 x12。', '前文  后文', 'image', '下一题'])
    expect(exampleWordNeedsImages(restored)).toBe(false)
    expect(unzipSync(restored)['docProps/custom.xml']).toEqual(entries['docProps/custom.xml'])
  })

  it('rejects missing image bytes and external Word image relationships', async () => {
    await expect(createExampleWord('![](images/missing.png)')).rejects.toThrow('illustration is unavailable')
    await expect(createExampleWord('![](https://example.invalid/figure.png)')).rejects.toThrow('illustration is unavailable')
    const image = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'white' } }).png().toBuffer()
    const bytes = await createExampleWord('![](images/figure.png)', [
      { name: 'images/figure.png', mediaType: 'image/png', contentBase64: image.toString('base64') },
    ])
    const entries = unzipSync(bytes)
    entries['word/_rels/document.xml.rels'] = strToU8(strFromU8(entries['word/_rels/document.xml.rels']!)
      .replace('Target="media/', 'TargetMode="External" Target="https://example.invalid/'))
    await expect(compileExampleWord([{ bytes: zipSync(entries) }])).rejects.toThrow('image relationship is unavailable')
  })

  it('uses one body size and font set while retaining mathematical bold, upright letters, and native structures', async () => {
    const bytes = await createExampleWord(String.raw`# 题目 ABC $\mathrm{AB}+\mathbf{A}+\frac{x_1^2}{\sin A}$
普通正文 ABC`)
    const { document, text } = documentXml(bytes)
    for (const run of Array.from(document.getElementsByTagNameNS(WORD_NS, 'r'))) {
      const fonts = run.getElementsByTagNameNS(WORD_NS, 'rFonts').item(0)!
      expect(fonts.getAttributeNS(WORD_NS, 'ascii')).toBe('Times New Roman')
      expect(fonts.getAttributeNS(WORD_NS, 'eastAsia')).toBe('宋体')
      expect(run.getElementsByTagNameNS(WORD_NS, 'b').item(0)?.getAttributeNS(WORD_NS, 'val')).toBe('false')
    }
    for (const run of Array.from(document.getElementsByTagNameNS(MATH_NS, 'r'))) {
      expect(run.getElementsByTagNameNS(WORD_NS, 'rFonts').item(0)?.getAttributeNS(WORD_NS, 'ascii')).toBe('Cambria Math')
      const children = Array.from(run.childNodes).map(child => child.nodeName)
      if (children.includes('m:rPr')) expect(children.indexOf('m:rPr')).toBeLessThan(children.indexOf('w:rPr'))
    }
    expect(Array.from(document.getElementsByTagNameNS(WORD_NS, 'sz')).every(node => node.getAttributeNS(WORD_NS, 'val') === '24'))
      .toBe(true)
    expect(text).not.toMatch(/w:val="30"|m:val="undefined"/u)
    expect(text).toContain('<m:sty m:val="p"')
    expect(text).toContain('<m:sty m:val="b"')
    const entries = unzipSync(bytes)
    expect(strFromU8(entries['word/settings.xml']!)).toContain('m:val="Cambria Math"')
    expect(strFromU8(entries['docProps/custom.xml']!)).toContain('mathvariant=&quot;bold&quot;')
    expect(await normalizeExampleWord(bytes)).toBeUndefined()
  })

  it('repairs typography in a saved native Word without changing text, preview data, or equation content', async () => {
    const original = await createExampleWord(String.raw`# 题目 $\mathbf{A}+\mathrm{AB}+\frac{x^2}{3}$`)
    const entries = unzipSync(original)
    const xml = strFromU8(entries['word/document.xml']!)
      .replaceAll('Times New Roman', 'Calibri').replaceAll('Cambria Math', 'Arial')
      .replaceAll('w:val="24"', 'w:val="36"').replaceAll('<w:b w:val="false"/>', '<w:b/>')
    entries['word/document.xml'] = strToU8(xml)
    const repaired = await normalizeExampleWord(zipSync(entries))
    expect(repaired).toBeDefined()
    const after = documentXml(repaired!)
    expect(after.document.documentElement?.textContent).toBe(documentXml(original).document.documentElement?.textContent)
    expect(after.text).not.toMatch(/Calibri|Arial|w:val="36"/u)
    expect(after.text).toContain('<m:sty m:val="b"')
    expect(after.document.getElementsByTagNameNS(MATH_NS, 'f').length).toBe(1)
    expect(unzipSync(repaired!)['docProps/custom.xml']).toEqual(entries['docProps/custom.xml'])
    expect(await normalizeExampleWord(repaired!)).toBeUndefined()
  })

  it('exports vector accents, fractions, and powers as Office equations between Chinese text', async () => {
    const { text, document } = documentXml(
      await createExampleWord(
        `# 变式题\n已知等边三角形，求 ${equation} 的最小值。答案：$-\\frac{3}{2}$，检验 $x_1^2$。`,
      ),
    )
    expect(document.getElementsByTagNameNS(MATH_NS, 'oMath').length).toBe(3)
    expect(
      Array.from(document.getElementsByTagNameNS(MATH_NS, 'oMath')).every(node => node.parentNode?.localName === 'p'),
    ).toBe(true)
    expect(document.getElementsByTagNameNS(MATH_NS, 'acc').length).toBe(3)
    expect(document.getElementsByTagNameNS(MATH_NS, 'f').length).toBe(1)
    expect(document.getElementsByTagNameNS(MATH_NS, 'sSubSup').length).toBe(1)
    expect(text).not.toContain('\\overrightarrow')
    expect(text).not.toContain('\\frac')
    expect(text).not.toContain('<w:drawing')
    expect(document.getElementsByTagNameNS(WORD_NS, 'body').item(0)?.textContent).toContain('已知等边三角形，求')
    expect(text).toContain('的最小值。答案：')
  })

  it('keeps multiline display equations together and does not convert escaped currency or code', async () => {
    const { text, document } = documentXml(
      await createExampleWord('售价 \\$20；代码 `$x$`。\n$$\n\\frac{1}{2}+\\sqrt{x}\n$$\n下一段'),
    )
    expect(document.getElementsByTagNameNS(MATH_NS, 'oMath').length).toBe(1)
    expect(document.getElementsByTagNameNS(MATH_NS, 'rad').length).toBe(1)
    expect(text).toContain('`$x$`')
    expect(text).toContain('下一段')
    expect(text).not.toContain('$$')
  })

  it('retains unsupported OCR math literally without losing neighboring equations or prose', async () => {
    const { text, document } = documentXml(
      await createExampleWord(String.raw`前文 $\unknowncommand{x}$ 后文 $\frac{1}{2}$`),
    )
    expect(text).toContain(String.raw`$\unknowncommand{x}$`)
    expect(document.getElementsByTagNameNS(MATH_NS, 'oMath').length).toBe(1)
    expect(text).toContain('后文')
  })

  it('converts escaped tab whitespace inside OCR formulas without changing TeX commands, row breaks, or code', async () => {
    const source = [
      String.raw`A. $2\sqrt{5}\t\t\t$ B. 10 C. 2 D. 5`,
      String.raw`$\tan\theta+\text{t}$`,
      String.raw`$\begin{aligned}x&=1\\t&=2\end{aligned}$`,
      '代码 `\\t`；路径 images\\t.png',
    ].join('\n')
    const bytes = await createExampleWord(source)
    const combined = await compileExampleWord([{ bytes }])
    for (const saved of [bytes, combined]) {
      const { text, document } = documentXml(saved)
      expect(document.getElementsByTagNameNS(MATH_NS, 'oMath').length).toBe(3)
      expect(document.getElementsByTagNameNS(MATH_NS, 'rad').length).toBe(1)
      expect(Array.from(document.getElementsByTagNameNS(MATH_NS, 'oMath')).map(node => node.textContent))
        .toEqual(['25', 'tan\u2061θ+t', 'x=1t=2'])
      expect(text).not.toContain('\\sqrt')
      expect(document.getElementsByTagNameNS(WORD_NS, 'body').item(0)?.textContent).toContain('代码 `\\t`；路径 images\\t.png')
    }
  })

  it('normalizes saved text-only DOCX and leaves formatted native equations byte-stable', async () => {
    const original = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({ children: [new TextRun({ text: '变式题', bold: true })] }),
              new Paragraph({ children: [new TextRun(`求 ${equation} 的最小值。`)] }),
            ],
          },
        ],
      }),
    )
    const rebuilt = await normalizeExampleWord(original)
    expect(rebuilt).toBeDefined()
    const { text, document } = documentXml(rebuilt!)
    expect(document.getElementsByTagNameNS(MATH_NS, 'oMath').length).toBe(1)
    expect(Array.from(document.getElementsByTagNameNS(WORD_NS, 'b')).every(node => node.getAttributeNS(WORD_NS, 'val') === 'false')).toBe(true)
    expect(text).toContain('变式题')
    expect(text).toContain('的最小值。')
    expect(await normalizeExampleWord(rebuilt!)).toBeUndefined()
    expect(await normalizeExampleWord(await createExampleWord('普通题目'))).toBeUndefined()
  })

  it('compiles native and saved text-only equations with uniform typography and no nested paragraph wrappers', async () => {
    const saved = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: '保留标题', bold: true })] }),
      new Paragraph(String.raw`旧文件 $\frac{1}{2}$`),
    ] }] }))
    const bytes = await compileExampleWord([
      { bytes: await createExampleWord(`求 ${equation} 和 $x_1^2$。`) },
      { bytes: saved, pageBreakBefore: true },
    ])
    const { document, text } = documentXml(bytes)
    expect(document.getElementsByTagNameNS(MATH_NS, 'acc').length).toBe(3)
    expect(document.getElementsByTagNameNS(MATH_NS, 'sSubSup').length).toBe(1)
    expect(document.getElementsByTagNameNS(MATH_NS, 'f').length).toBe(1)
    expect(text).toContain('保留标题')
    expect(text).not.toContain('<w:b/>')
    expect(Array.from(document.getElementsByTagNameNS(WORD_NS, 'p')).every(p =>
      p.parentNode?.localName === 'body' && p.getElementsByTagNameNS(WORD_NS, 'pPr').length <= 1,
    )).toBe(true)
  })
  it('separates items with exactly two single-spaced blank lines after trimming source edge whitespace', async () => {
    const bytes = await compileExampleWord([
      { bytes: await createExampleWord('第一题\n\n') },
      { bytes: await createExampleWord('\n\n第二题\n\n'), blankLinesBefore: true },
    ])
    const paragraphs = Array.from(documentXml(bytes).document.getElementsByTagNameNS(WORD_NS, 'p'))
    expect(paragraphs.map(paragraph => paragraph.textContent)).toEqual(['第一题', '', '', '第二题'])
    for (const paragraph of paragraphs.slice(1, 3)) {
      const spacing = paragraph.getElementsByTagNameNS(WORD_NS, 'spacing').item(0)!
      expect(spacing.getAttributeNS(WORD_NS, 'line')).toBe('240')
      expect(spacing.getAttributeNS(WORD_NS, 'before')).toBe('0')
      expect(spacing.getAttributeNS(WORD_NS, 'after')).toBe('0')
    }
  })
  it('refuses unsupported body content instead of silently dropping it from an export', async () => {
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('table content')] })] })] }),
    ] }] }))
    await expect(compileExampleWord([{ bytes }])).rejects.toThrow('only generated paragraphs')
  })

})
