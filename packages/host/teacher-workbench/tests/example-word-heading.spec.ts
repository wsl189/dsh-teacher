import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { compileExampleWord, createExampleWord, normalizeExampleWord } from '../src/example-word.ts'
import { exampleHeadingEvidence, exampleWordNeedsHeading, removeExampleHeading } from '../src/example-word-heading.ts'

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const CUSTOM_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
const parser = new DOMParser()

function document(bytes: Uint8Array) {
  return parser.parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']!), 'application/xml')
}

describe('Word headings identified by a visual child', () => {
  it('removes a prefix across paragraphs and native title equations while retaining body equations, subparts, and images', async () => {
    const image = await sharp({ create: { width: 60, height: 40, channels: 3, background: 'white' } }).png().toBuffer()
    const original = await createExampleWord('【题 4】\n（2019 人教 $A$ 版必修第二册 P33 探究变式）已知 $A(2,3)$，求 $x^2$。\n（1）求坐标。\n（2）说明理由。\n![](images/a.png)', [
      { name: 'images/a.png', mediaType: 'image/png', contentBase64: image.toString('base64') },
    ])
    const before = exampleHeadingEvidence(original)
    expect(before.text).toContain('人教 ⟪math:0⟫ 版')
    expect(before.equations).toHaveLength(3)
    expect(exampleWordNeedsHeading(original)).toBe(true)
    const reviewed = removeExampleHeading(original, before.paragraphs.slice(0, 2).map(({ index, text }) => ({ paragraph: index, prefix: text.includes('已知') ? text.slice(0, text.indexOf('已知')) : text })))
    const expectedEquations = Array.from(document(original).getElementsByTagNameNS(MATH_NS, 'oMath')).slice(1)
      .map(node => new XMLSerializer().serializeToString(node))
    expect(Array.from(document(reviewed).getElementsByTagNameNS(MATH_NS, 'oMath')).map(node => new XMLSerializer().serializeToString(node)))
      .toEqual(expectedEquations)
    expect(document(reviewed).documentElement?.textContent).toBe('已知 A(2,3)，求 x2。（1）求坐标。（2）说明理由。')
    const entries = unzipSync(reviewed)
    expect(Object.entries(entries).filter(([path]) => path.startsWith('word/media/')))
      .toEqual(Object.entries(unzipSync(original)).filter(([path]) => path.startsWith('word/media/')))
    const property = Array.from(parser.parseFromString(strFromU8(entries['docProps/custom.xml']!), 'application/xml')
      .getElementsByTagNameNS(CUSTOM_NS, 'property')).find(node => node.getAttribute('name') === 'dsh.example.mathml')!
    expect(parser.parseFromString(property.textContent ?? '', 'application/xml').getElementsByTagName('math').length).toBe(2)
    expect(exampleWordNeedsHeading(reviewed)).toBe(false)
    expect(await normalizeExampleWord(reviewed)).toBeUndefined()
    for (const pageBreakBefore of [false, true]) {
      const exported = await compileExampleWord([{ bytes: reviewed }, { bytes: reviewed, blankLinesBefore: true, pageBreakBefore }])
      expect(exampleWordNeedsHeading(exported)).toBe(false)
      expect(document(exported).documentElement?.textContent).not.toContain('2019')
      expect(document(exported).getElementsByTagNameNS(MATH_NS, 'oMath').length).toBe(4)
    }
  })

  it('records no-heading decisions without deleting conditions or subpart numbers', async () => {
    const original = await createExampleWord('（1）已知 $x>0$，某教材售价为2019元，求总价。\n（2）证明结论。')
    const reviewed = removeExampleHeading(original, [])
    expect(document(reviewed).documentElement?.textContent).toBe(document(original).documentElement?.textContent)
    expect(exampleHeadingEvidence(reviewed)).toEqual(exampleHeadingEvidence(original))
    expect(exampleWordNeedsHeading(reviewed)).toBe(false)
    expect(await normalizeExampleWord(reviewed)).toBeUndefined()
  })

  it('rejects rewritten prefixes, a cutoff inside a native equation, and deletion of the entire body', async () => {
    const original = await createExampleWord('【题4】（人教 $A$ 版）已知 $x>0$，求解。')
    const evidence = exampleHeadingEvidence(original)
    for (const prefix of ['【题5】', evidence.text, evidence.text.slice(0, evidence.text.indexOf('math:0') + 3)]) {
      expect(() => removeExampleHeading(original, [{ paragraph: 0, prefix }])).toThrow('exact prefix')
    }
  })

  it('retains the package registration for reviewed plain-text Word files', async () => {
    const reviewed = removeExampleHeading(await createExampleWord('【例题甲】题目正文。'), [{ paragraph: 0, prefix: '【例题甲】' }])
    const entries = unzipSync(reviewed)
    expect(strFromU8(entries['[Content_Types].xml']!)).toContain('/docProps/custom.xml')
    expect(strFromU8(entries['_rels/.rels']!)).toContain('docProps/custom.xml')
    expect(exampleHeadingEvidence(reviewed).text).toBe('题目正文。\n')
    expect(exampleWordNeedsHeading(reviewed)).toBe(false)
  })
})
