/** Native complement runs that use the equation font in Word and WPS. */

import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom'
import { strFromU8, strToU8 } from 'fflate'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

/**
 * Keep complements upright in native math and remove the unsupported embedded text-font assignment.
 * @param document - collection document after its ordinary typography normalization.
 * @param entries - mutable DOCX package; only the collection's complement font parts are removed.
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
      let math = target.getElementsByTagNameNS(M, 'rPr').item(0)
      if (math === null) {
        math = document.createElementNS(M, 'm:rPr')
        target.insertBefore(math, target.firstChild)
      }
      let style = math.getElementsByTagNameNS(M, 'sty').item(0)
      const bold = ['b', 'bi'].includes(style?.getAttributeNS(M, 'val') ?? '')
      // WPS can omit a complement in normal-text mode when its text font is unavailable.
      for (const property of Array.from(math.childNodes)) {
        if (property.namespaceURI === M && ['nor', 'scr'].includes(property.localName ?? '')) math.removeChild(property)
      }
      if (style === null) {
        style = document.createElementNS(M, 'm:sty')
        math.appendChild(style)
      }
      style.setAttributeNS(M, 'm:val', bold ? 'b' : 'p')
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
      const ownedFont = node.namespaceURI === W && node.localName === 'font' && node.getAttributeNS(W, 'name') === 'DSH Math Symbols'
      const ownedRelationship = node.localName === 'Relationship' && node.getAttribute('Id') === 'dshComplementFont' && node.getAttribute('Target') === 'fonts/dsh-complement.odttf'
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
  return changed
}
