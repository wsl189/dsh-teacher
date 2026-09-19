/** Set and parallel relations retain shared operator spacing and native editable symbols. */

import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom'
import { strFromU8, strToU8 } from 'fflate'
import { exampleOfficeMathSize } from './example-word-math.ts'
import { formatExampleSymbolRun } from './example-word-symbol-font.ts'

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const ML = 'http://www.w3.org/1998/Math/MathML'

/**
 * Normalize native set and parallel operators without depending on an embedded equation font.
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
    const nativeRuns = Array.from(equation.getElementsByTagNameNS(M, 'r'))
    for (const run of nativeRuns) {
      const text = run.getElementsByTagNameNS(M, 't').item(0)
      const next = run.nextSibling as XmlElement | null
      const overlay = next?.namespaceURI === M && next.localName === 'r' ? next.getElementsByTagNameNS(M, 't').item(0) : null
      if (text?.textContent?.endsWith('⫽') && overlay?.textContent?.startsWith('⃥')) {
        text.textContent += '⃥'
        overlay.textContent = overlay.textContent.slice(1)
        if (!overlay.textContent) next?.parentNode?.removeChild(next)
      }
    }
    const runs = nativeRuns.filter(run => run.parentNode !== null && /[⊆⊇⫋⫌⫽∥∦]/u.test(run.textContent ?? ''))
    if (runs.length === 0) continue
    const math = maths[index]
    if (math === undefined) throw new Error('Proper-set relation has no preview')
    for (const text of Array.from(math.getElementsByTagNameNS(ML, 'mtext'))) {
      if (!/[⫋⫌]/u.test(text.textContent ?? '')) continue
      const row = previews.createElementNS(ML, 'mrow')
      for (const part of (text.textContent ?? '').match(/[⫋⫌]|[^⫋⫌]+/gu) ?? []) {
        const token = previews.createElementNS(ML, /^[⫋⫌]$/u.test(part) ? 'mo' : 'mtext')
        for (const attribute of Array.from(text.attributes)) token.setAttribute(attribute.name, attribute.value)
        token.textContent = part
        row.appendChild(token)
      }
      text.parentNode?.replaceChild(row, text)
    }
    const size = exampleOfficeMathSize(equation, math)
    if (!/font-size\s*:/u.test(math.getAttribute('style') ?? '')) {
      math.setAttribute('style', `${math.getAttribute('style') ?? ''};font-size:${String(size)}pt`)
    }
    for (const run of runs) {
      const text = run.getElementsByTagNameNS(M, 't').item(0)
      const parent = run.parentNode
      if (text === null || parent === null) throw new Error('Proper-set relation has no native text')
      const normalized = (text.textContent ?? '').replaceAll('⫽⃥', '∦').replaceAll('⫽', '∥')
        .replaceAll(/[ \u00a0]*([⊆⊇⫋⫌∥∦])[ \u00a0]*/gu, '$1')
      const parts = normalized.match(/[⊆⊇⫋⫌∥∦]|[^⊆⊇⫋⫌∥∦]+/gu) ?? []
      for (const part of parts) {
        const target = parts.length === 1 ? run : run.cloneNode(true) as XmlElement
        if (target !== run) {
          const content = target.getElementsByTagNameNS(M, 't').item(0)
          if (content === null) throw new Error('Proper-set relation has no native text')
          content.textContent = part
          parent.insertBefore(target, run)
        }
        if (parts.length === 1) text.textContent = part
        if (!/^[⊆⊇⫋⫌∥∦]$/u.test(part)) continue
        trimRelationPadding(target, 'previousSibling')
        trimRelationPadding(target, 'nextSibling')
        formatExampleSymbolRun(document, target, size)
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

function trimRelationPadding(run: XmlElement, side: 'previousSibling' | 'nextSibling'): void {
  const sibling = run[side]
  if (sibling?.namespaceURI !== M || sibling.localName !== 'r') return
  const text = (sibling as XmlElement).getElementsByTagNameNS(M, 't').item(0)
  if (text === null) return
  text.textContent = (text.textContent ?? '').replace(side === 'previousSibling' ? /[ \u00a0]+$/u : /^[ \u00a0]+/u, '')
  if (!text.textContent) sibling.parentNode?.removeChild(sibling)
}
