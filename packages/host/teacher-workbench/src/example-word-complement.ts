/** Upright system-font complements and removal of obsolete collection font parts. */

import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom'
import { strFromU8, strToU8 } from 'fflate'
import { formatExampleSymbolRun } from './example-word-symbol-font.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

/**
 * Keep complements upright in a Windows system font and remove obsolete embedded collection fonts.
 * @param document - collection document after its ordinary typography normalization.
 * @param entries - mutable DOCX package; only the collection's obsolete embedded fonts are removed.
 * @returns whether package parts changed; the caller separately serializes the modified document.
 */
export function normalizeExampleComplement(document: XmlDocument, entries: Record<string, Uint8Array>): boolean {
  for (const run of Array.from(document.getElementsByTagNameNS(M, 'r'))) {
    const text = run.getElementsByTagNameNS(M, 't').item(0)?.textContent ?? ''
    if (!text.includes('∁')) continue
    const parent = run.parentNode
    if (parent === null) throw new Error('Complement equation has no parent')
    const parts = text.match(/∁|[^∁]+/gu) ?? []
    for (const part of parts) {
      const target = parts.length === 1 ? run : run.cloneNode(true) as XmlElement
      if (target !== run) {
        const content = target.getElementsByTagNameNS(M, 't').item(0)
        if (content === null) throw new Error('Complement equation has no text')
        content.textContent = part
        parent.insertBefore(target, run)
      }
      if (part !== '∁') continue
      const size = Number(target.getElementsByTagNameNS(W, 'sz').item(0)?.getAttributeNS(W, 'val') ?? '24') / 2
      formatExampleSymbolRun(document, target, size)
    }
    if (parts.length > 1) parent.removeChild(run)
  }

  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  let changed = false
  for (const path of ['word/fontTable.xml', 'word/_rels/fontTable.xml.rels']) {
    const entry = entries[path]
    if (entry === undefined) continue
    const source = strFromU8(entry)
    const xml = parser.parseFromString(source, 'application/xml')
    for (const node of Array.from(xml.getElementsByTagName('*'))) {
      const ownedFont = node.namespaceURI === W && node.localName === 'font' && ['DSH Math Symbols', 'DSH Teacher Math'].includes(node.getAttributeNS(W, 'name') ?? '')
      const ownedRelationship = node.localName === 'Relationship' && [['dshComplementFont', 'fonts/dsh-complement.odttf'], ['dshTeacherMathFont', 'fonts/dsh-teacher-math.odttf']].some(([id, target]) => node.getAttribute('Id') === id && node.getAttribute('Target') === target)
      if (ownedFont || ownedRelationship) node.parentNode?.removeChild(node)
    }
    const normalized = serializer.serializeToString(xml)
    if (normalized === source) continue
    entries[path] = strToU8(normalized)
    changed = true
  }
  if (entries['word/fonts/dsh-complement.odttf'] !== undefined) {
    delete entries['word/fonts/dsh-complement.odttf']
    changed = true
  }
  if (entries['word/fonts/dsh-teacher-math.odttf'] !== undefined) {
    delete entries['word/fonts/dsh-teacher-math.odttf']
    changed = true
  }
  return changed
}
