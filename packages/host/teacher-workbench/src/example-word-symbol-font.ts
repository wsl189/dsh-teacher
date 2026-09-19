/** Editable textbook symbols use declared Unicode fonts and shared relation spacing. */

import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom'
import { strFromU8, strToU8 } from 'fflate'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

/** Linux readers resolve the alternate face declared in the document's font table. */
const EXAMPLE_SYMBOL_FONT = 'Segoe UI Symbol'

/**
 * Declare a Unicode alternate for readers without the Windows symbol face.
 * @param document - normalized native Word content.
 * @param entries - generated DOCX parts, including its font table.
 * @returns whether the font table changed.
 */
export function normalizeExampleSymbolFonts(document: XmlDocument, entries: Record<string, Uint8Array>): boolean {
  if (!Array.from(document.getElementsByTagNameNS(W, 'rFonts')).some(font => font.getAttributeNS(W, 'ascii') === EXAMPLE_SYMBOL_FONT)) return false
  const source = entries['word/fontTable.xml']
  if (source === undefined) throw new Error('Example Word file has no font table')
  const fonts = new DOMParser().parseFromString(strFromU8(source), 'application/xml')
  const root = fonts.documentElement
  if (root === null) throw new Error('Example Word font table is empty')
  let font = Array.from(root.getElementsByTagNameNS(W, 'font')).find(node => node.getAttributeNS(W, 'name') === EXAMPLE_SYMBOL_FONT)
  if (font === undefined) {
    font = fonts.createElementNS(W, 'w:font')
    font.setAttributeNS(W, 'w:name', EXAMPLE_SYMBOL_FONT)
    root.appendChild(font)
  }
  for (const [name, value] of [['altName', 'Noto Sans Math'], ['charset', '00'], ['family', 'swiss'], ['pitch', 'variable']] as const) {
    const property = font.getElementsByTagNameNS(W, name).item(0) ?? fonts.createElementNS(W, `w:${name}`)
    property.setAttributeNS(W, 'w:val', value)
    const order = ['altName', 'panose1', 'charset', 'family', 'notTrueType', 'pitch', 'sig', 'embedRegular', 'embedBold', 'embedItalic', 'embedBoldItalic']
    const following = Array.from(font.childNodes).find(node => order.indexOf(node.localName ?? '') > order.indexOf(name))
    font.insertBefore(property, following ?? null)
  }
  const normalized = new XMLSerializer().serializeToString(fonts)
  if (normalized === strFromU8(source)) return false
  entries['word/fontTable.xml'] = strToU8(normalized)
  return true
}

/**
 * Format a single symbol without changing adjacent mathematical letters or its local color.
 * @param document - native Word document owning the run.
 * @param run - one complement, set relation, or parallel relation run.
 * @param size - full equation size in points, independent of earlier reduced symbol runs.
 */
export function formatExampleSymbolRun(document: XmlDocument, run: XmlElement, size: number): void {
  const text = run.getElementsByTagNameNS(M, 't').item(0)
  const glyph = text?.textContent ?? ''
  const slanted = glyph === '∥' || glyph === '∦'
  let math = run.getElementsByTagNameNS(M, 'rPr').item(0)
  if (math === null) {
    math = document.createElementNS(M, 'm:rPr')
    run.insertBefore(math, run.firstChild)
  }
  let style = math.getElementsByTagNameNS(M, 'sty').item(0)
  const bold = ['b', 'bi'].includes(style?.getAttributeNS(M, 'val') ?? '')
  for (const property of Array.from(math.childNodes)) {
    if (property.namespaceURI === M && ['nor', 'scr'].includes(property.localName ?? '')) math.removeChild(property)
  }
  const normal = document.createElementNS(M, 'm:nor')
  math.insertBefore(normal, math.firstChild)
  if (style === null) {
    style = document.createElementNS(M, 'm:sty')
    math.appendChild(style)
  }
  style.setAttributeNS(M, 'm:val', bold ? (slanted ? 'bi' : 'b') : (slanted ? 'i' : 'p'))
  const properties = run.getElementsByTagNameNS(W, 'rPr').item(0)
  if (properties === null) throw new Error('Textbook symbol has no native formatting')
  const set = (name: string, attributes: Readonly<Record<string, string>> | undefined): void => {
    const current = properties.getElementsByTagNameNS(W, name).item(0)
    if (attributes === undefined) {
      current?.parentNode?.removeChild(current)
      return
    }
    const property = current ?? document.createElementNS(W, `w:${name}`)
    for (const attribute of Array.from(property.attributes)) property.removeAttributeNode(attribute)
    for (const [key, value] of Object.entries(attributes)) property.setAttributeNS(W, `w:${key}`, value)
    const order = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd']
    const following = Array.from(properties.childNodes).find(node => order.indexOf(node.localName ?? '') > order.indexOf(name))
    properties.insertBefore(property, following ?? null)
  }

  set('rFonts', { ascii: EXAMPLE_SYMBOL_FONT, hAnsi: EXAMPLE_SYMBOL_FONT, eastAsia: EXAMPLE_SYMBOL_FONT, cs: EXAMPLE_SYMBOL_FONT, hint: 'default' })
  for (const name of ['b', 'bCs']) set(name, bold ? {} : undefined)
  for (const name of ['i', 'iCs']) set(name, { val: String(slanted) })
  set('position', undefined)
  for (const name of ['sz', 'szCs']) set(name, { val: String(Math.round(size * 2)) })
  if (glyph === '∁') return
  const argument = run.parentNode
  const existing = argument?.parentNode
  if (argument === null) throw new Error('Textbook relation has no native parent')
  if (!(argument.localName === 'e' && existing?.namespaceURI === M && existing.localName === 'box'
    && (existing as XmlElement).getElementsByTagNameNS(M, 'opEmu').length > 0)) {
    const box = document.createElementNS(M, 'm:box')
    const boxProperties = document.createElementNS(M, 'm:boxPr')
    boxProperties.appendChild(document.createElementNS(M, 'm:opEmu'))
    box.appendChild(boxProperties)
    const content = document.createElementNS(M, 'm:e')
    box.appendChild(content)
    argument.replaceChild(box, run)
    content.appendChild(run)
  }
  const overlay = run.previousSibling as XmlElement | null
  const negated = overlay?.namespaceURI === M && overlay.localName === 'phant'
    && overlay.getElementsByTagNameNS(M, 'zeroWid').item(0)?.getAttributeNS(M, 'val') === '1'
    && overlay.textContent?.trim() === '\\'
  if (glyph !== '∦' && !(glyph === '∥' && negated)) return
  if (text === null) throw new Error('Not-parallel relation has no native text')
  // The visible zero-width mark keeps the parallel operator's spacing and line height.
  text.textContent = '∥'
  const mark = run.cloneNode(true) as XmlElement
  symbolProperty(mark, M, 't').textContent = '\\'
  symbolProperty(mark, M, 'sty').setAttributeNS(M, 'm:val', bold ? 'b' : 'p')
  for (const name of ['i', 'iCs']) symbolProperty(mark, W, name).setAttributeNS(W, 'w:val', 'false')
  for (const name of ['sz', 'szCs']) symbolProperty(mark, W, name).setAttributeNS(W, 'w:val', String(Math.round(size * 1.1)))
  const markProperties = symbolProperty(mark, W, 'rPr')
  const width = document.createElementNS(W, 'w:w')
  width.setAttributeNS(W, 'w:val', '150')
  markProperties.insertBefore(width, mark.getElementsByTagNameNS(W, 'sz').item(0))
  const position = document.createElementNS(W, 'w:position')
  position.setAttributeNS(W, 'w:val', String(Math.round(size / 3)))
  markProperties.insertBefore(position, mark.getElementsByTagNameNS(W, 'sz').item(0))
  // The internal offset balances the stroke's overhang across the italic lines without moving the relation.
  const padding = run.cloneNode(true) as XmlElement
  const paddingText = symbolProperty(padding, M, 't')
  paddingText.textContent = ' '
  paddingText.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
  symbolProperty(padding, M, 'sty').setAttributeNS(M, 'm:val', 'p')
  for (const name of ['i', 'iCs']) symbolProperty(padding, W, name).setAttributeNS(W, 'w:val', 'false')
  for (const name of ['sz', 'szCs']) symbolProperty(padding, W, name).setAttributeNS(W, 'w:val', String(Math.round(size)))
  const phantom = document.createElementNS(M, 'm:phant')
  const phantomProperties = document.createElementNS(M, 'm:phantPr')
  for (const name of ['show', 'zeroWid', 'zeroAsc', 'zeroDesc']) {
    const property = document.createElementNS(M, `m:${name}`)
    property.setAttributeNS(M, 'm:val', '1')
    phantomProperties.appendChild(property)
  }
  phantom.appendChild(phantomProperties)
  const overlayContent = document.createElementNS(M, 'm:e')
  phantom.appendChild(overlayContent)
  overlayContent.appendChild(padding)
  overlayContent.appendChild(mark)
  const parent = run.parentNode
  if (parent === null) throw new Error('Not-parallel relation has no native parent')
  if (negated) parent.replaceChild(phantom, overlay)
  else parent.insertBefore(phantom, run)
}

function symbolProperty(run: XmlElement, namespace: string, name: string): XmlElement {
  const property = run.getElementsByTagNameNS(namespace, name).item(0)
  if (property === null) throw new Error(`Textbook symbol is missing ${name}`)
  return property
}
