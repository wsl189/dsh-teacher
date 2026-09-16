/** Compact native proper-set relations without changing their Unicode characters. */

import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom'
import { strFromU8, strToU8 } from 'fflate'
import { exampleOfficeMathSize } from './example-word-math.ts'

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const ML = 'http://www.w3.org/1998/Math/MathML'

/**
 * Size and raise Cambria Math proper-set signs relative to the saved equation size.
 * @param document - native collection document after ordinary typography normalization.
 * @param entries - DOCX parts, including the matching preview MathML and its equation sizes.
 * @returns whether the preview metadata changed; the caller serializes the native document.
 */
export function normalizeExampleRelations(document: XmlDocument, entries: Record<string, Uint8Array>): boolean {
  const source = entries['docProps/custom.xml']
  if (source === undefined) return false
  const parser = new DOMParser()
  const custom = parser.parseFromString(strFromU8(source), 'application/xml')
  const saved = Array.from(custom.getElementsByTagName('property')).find(node => node.getAttribute('name') === 'dsh.example.mathml')?.firstChild
  if (saved === undefined || saved === null) return false
  const previews = parser.parseFromString(saved.textContent ?? '', 'application/xml')
  const maths = Array.from(previews.getElementsByTagNameNS(ML, 'math'))
  const equations = Array.from(document.getElementsByTagNameNS(M, 'oMath'))
  if (maths.length !== equations.length) throw new Error('Collected Word equations do not match their preview data')
  for (const [index, equation] of equations.entries()) {
    const runs = Array.from(equation.getElementsByTagNameNS(M, 'r')).filter(run => /[⫋⫌]/u.test(run.textContent ?? ''))
    if (runs.length === 0) continue
    const math = maths[index]
    if (math === undefined) throw new Error('Proper-set relation has no preview')
    const size = exampleOfficeMathSize(equation, math)
    if (!/font-size\s*:/u.test(math.getAttribute('style') ?? '')) {
      math.setAttribute('style', `${math.getAttribute('style') ?? ''};font-size:${String(size)}pt`)
    }
    for (const run of runs) {
      const text = run.getElementsByTagNameNS(M, 't').item(0)
      const parent = run.parentNode
      if (text === null || parent === null) throw new Error('Proper-set relation has no native text')
      const parts = (text.textContent ?? '').match(/[⫋⫌]|[^⫋⫌]+/gu) ?? []
      for (const part of parts) {
        const target = parts.length === 1 ? run : run.cloneNode(true) as XmlElement
        if (target !== run) {
          const content = target.getElementsByTagNameNS(M, 't').item(0)
          if (content === null) throw new Error('Proper-set relation has no native text')
          content.textContent = part
          parent.insertBefore(target, run)
        }
        if (part !== '⫋' && part !== '⫌') continue
        const properties = target.getElementsByTagNameNS(W, 'rPr').item(0)
        if (properties === null) throw new Error('Proper-set relation has no native formatting')
        for (const [name, value] of [['position', Math.round(size * 2 * 0.08)], ['sz', Math.round(size * 2 * 0.8)], ['szCs', Math.round(size * 2 * 0.8)]] as const) {
          let property = properties.getElementsByTagNameNS(W, name).item(0)
          if (property === null) {
            property = document.createElementNS(W, `w:${name}`)
            properties.appendChild(property)
          }
          property.setAttributeNS(W, 'w:val', String(value))
          const following = Array.from(properties.childNodes).find(node =>
            ['position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd'].indexOf(node.localName ?? '') > ['position', 'sz', 'szCs'].indexOf(name))
          if (following !== undefined) properties.insertBefore(property, following)
        }
      }
      if (parts.length > 1) parent.removeChild(run)
    }
  }
  const serializer = new XMLSerializer()
  const metadata = serializer.serializeToString(previews)
  if (metadata === saved.textContent) return false
  saved.textContent = metadata
  entries['docProps/custom.xml'] = strToU8(serializer.serializeToString(custom))
  return true
}
