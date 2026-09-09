/** Textbook paragraph and inline-letter formatting for collection-owned Word XML. */

import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const FUNCTIONS = /^(?:arcsin|arccos|arctan|sin|cos|tan|cot|sec|csc|log|ln|exp|lim|max|min|det)([A-Za-z])$/u

interface Piece {
  readonly node: XmlElement
  readonly text: string
  readonly plain: boolean
  readonly start: number
  readonly end: number
}

/**
 * Separate a complete A–D option sequence from its stem and retain native equation/image nodes.
 * @param document - collection document.xml; source characters and equation order remain unchanged.
 */
export function normalizeExampleParagraphs(document: XmlDocument): void {
  const section = document.getElementsByTagNameNS(WORD_NS, 'sectPr').item(0)
  const size = section?.getElementsByTagNameNS(WORD_NS, 'pgSz').item(0)
  const margins = section?.getElementsByTagNameNS(WORD_NS, 'pgMar').item(0)
  const pageWidth = Number(size?.getAttributeNS(WORD_NS, 'w')) || 11906
  const available = pageWidth - (Number(margins?.getAttributeNS(WORD_NS, 'left')) || 1440) -
    (Number(margins?.getAttributeNS(WORD_NS, 'right')) || 1440)
  for (const paragraph of Array.from(document.getElementsByTagNameNS(WORD_NS, 'p'))) {
    if (choiceParagraph(paragraph)) {
      normalizeChoiceSpaces(paragraph)
      continue
    }
    const pieces: Piece[] = []
    let offset = 0
    for (const node of elements(paragraph)) {
      if (node.localName === 'pPr') continue
      const plain = plainRun(node)
      const label = node.namespaceURI === MATH_NS ? /^\s*([A-D])\s*[.．、]/u.exec(node.textContent ?? '') : null
      const text = plain ? node.textContent ?? '' : label === null ? '\ufffc' : `${label[1]}.\ufffc`
      pieces.push({ node, text, plain, start: offset, end: offset + text.length })
      offset += text.length
    }
    const text = pieces.map(piece => piece.text).join('')
    const matches = [...text.matchAll(/(?<![A-Za-z])([A-D])[.．、]/gu)]
    const first = matches.findIndex((match, index) => match[1] === 'A' &&
      ['B', 'C', 'D'].every((label, next) => matches[index + next + 1]?.[1] === label))
    const explicitRow = text.includes('\t') && matches.length === 2 &&
      ['AB', 'CD'].includes(matches.map(match => match[1]).join(''))
    const firstMatch = matches[0]
    const singleOption = matches.length === 1 && firstMatch !== undefined && text.slice(0, firstMatch.index).trim() === ''
    if (first < 0 && !explicitRow && !singleOption) continue
    const selected = first < 0 ? matches : matches.slice(first, first + 4)
    const starts = selected.map(match => match.index)
    const firstStart = starts[0]
    if (firstStart === undefined) continue
    if (starts.some(start => pieces.some(piece => !piece.plain && start > piece.start && start < piece.end))) continue
    const options = starts.map((start, index) => trimEdges(slicePieces(pieces, start, starts[index + 1] ?? text.length)))
    const longest = Math.max(...options.map(option => estimateWidth(option)))
    const columns = options.length >= 4 && longest + 240 <= available / 4 ? 4 :
      options.length >= 2 && longest + 240 <= available / 2 ? 2 : 1
    const parent = paragraph.parentNode
    if (parent === null) continue
    const stem = slicePieces(pieces, 0, firstStart)
    if (stem.some(node => (node.textContent ?? '').trim() !== '' || node.getElementsByTagNameNS(WORD_NS, 'drawing').length > 0)) {
      const replacement = document.createElementNS(WORD_NS, 'w:p')
      for (const node of stem) replacement.appendChild(node)
      parent.insertBefore(replacement, paragraph)
    }
    for (let index = 0; index < options.length; index += columns) {
      const row = document.createElementNS(WORD_NS, 'w:p')
      const properties = document.createElementNS(WORD_NS, 'w:pPr')
      const style = document.createElementNS(WORD_NS, 'w:pStyle')
      style.setAttributeNS(WORD_NS, 'w:val', `DshExampleChoices${String(columns)}`)
      properties.appendChild(style)
      const tabs = document.createElementNS(WORD_NS, 'w:tabs')
      for (let column = 1; column < columns; column++) {
        const tab = document.createElementNS(WORD_NS, 'w:tab')
        tab.setAttributeNS(WORD_NS, 'w:val', 'left')
        tab.setAttributeNS(WORD_NS, 'w:pos', String(Math.round(available * column / columns)))
        tabs.appendChild(tab)
      }
      properties.appendChild(tabs)
      row.appendChild(properties)
      for (let column = 0; column < columns; column++) {
        if (column > 0) {
          const run = document.createElementNS(WORD_NS, 'w:r')
          run.appendChild(document.createElementNS(WORD_NS, 'w:tab'))
          row.appendChild(run)
        }
        for (const node of options[index + column] ?? []) row.appendChild(node)
      }
      normalizeChoiceSpaces(row)
      parent.insertBefore(row, paragraph)
    }
    parent.removeChild(paragraph)
  }
  for (const paragraph of Array.from(document.getElementsByTagNameNS(WORD_NS, 'p'))) {
    if (!/^[（(]\s*[)）]$/u.test((paragraph.textContent ?? '').trim())) continue
    const parent = paragraph.parentNode
    if (parent === null || parent.nodeType !== parent.ELEMENT_NODE) continue
    const siblings = elements(parent as XmlElement)
    const index = siblings.indexOf(paragraph)
    const previous = siblings[index - 1]
    const next = siblings[index + 1]
    if (previous?.localName !== 'p' || !previous.textContent?.trim() || choiceParagraph(previous) ||
      next === undefined || !choiceParagraph(next)) continue
    for (const node of elements(paragraph).filter(node => node.localName !== 'pPr')) previous.appendChild(node)
    paragraph.parentNode?.removeChild(paragraph)
  }
}

/**
 * Place ungrouped illustrations beneath their document text; marked figure paragraphs retain their block position.
 * @param document - one collected question/explanation or a compilation with figures already grouped by source.
 */
export function normalizeExampleFigures(document: XmlDocument): void {
  const body = document.getElementsByTagNameNS(WORD_NS, 'body').item(0)
  if (body === null) throw new Error('Example Word file has no document body')
  const figures: XmlElement[] = []
  for (const paragraph of elements(body).filter(node => node.localName === 'p')) {
    if (paragraph.getElementsByTagNameNS(WORD_NS, 'pStyle').item(0)?.getAttributeNS(WORD_NS, 'val') === 'DshExampleFigure') continue
    let extracted = false
    for (const run of elements(paragraph).filter(node => node.namespaceURI === WORD_NS && node.localName === 'r')) {
      for (const drawing of elements(run).filter(node => node.localName === 'drawing')) {
        const figure = document.createElementNS(WORD_NS, 'w:p')
        const properties = document.createElementNS(WORD_NS, 'w:pPr')
        const style = document.createElementNS(WORD_NS, 'w:pStyle')
        style.setAttributeNS(WORD_NS, 'w:val', 'DshExampleFigure')
        properties.appendChild(style)
        figure.appendChild(properties)
        const image = document.createElementNS(WORD_NS, 'w:r')
        const runProperties = elements(run).find(node => node.localName === 'rPr')
        if (runProperties !== undefined) image.appendChild(runProperties.cloneNode(true))
        image.appendChild(drawing)
        figure.appendChild(image)
        figures.push(figure)
        extracted = true
      }
      if (elements(run).every(node => node.localName === 'rPr')) paragraph.removeChild(run)
    }
    if (extracted && !paragraph.textContent?.trim() && elements(paragraph).every(node =>
      node.localName === 'pPr' || plainRun(node))) body.removeChild(paragraph)
  }
  const section = elements(body).find(node => node.localName === 'sectPr')
  for (const figure of figures) body.insertBefore(figure, section ?? null)
}

/**
 * Split plain text into explicit Western font runs and italic mathematical letter runs.
 * @param document - collection document.xml; code, unresolved Markdown, native math, and drawings remain intact.
 */
export function normalizeExampleLetterRuns(document: XmlDocument): void {
  for (const paragraph of Array.from(document.getElementsByTagNameNS(WORD_NS, 'p'))) {
    const mathematicalContext = /\p{Script=Han}/u.test(paragraph.textContent ?? '') ||
      paragraph.getElementsByTagNameNS(MATH_NS, 'oMath').length > 0 ||
      paragraph.getElementsByTagNameNS(WORD_NS, 'pStyle').item(0)?.getAttributeNS(WORD_NS, 'val')?.startsWith('DshExampleChoices')
    if (!mathematicalContext) continue
    const vectors = new Set([...(paragraph.textContent ?? '').matchAll(/向量\s*([a-z](?:\s*[,，、和与]\s*[a-z])*)/gu)]
      .flatMap(match => match[1]?.match(/[a-z]/gu) ?? []))
    for (const run of elements(paragraph)) {
      if (!plainRun(run)) continue
      const text = run.textContent ?? ''
      if (/[$\\`]|!\[/u.test(text)) continue
      const pieces = [...text.matchAll(/[A-Za-z]+|[\p{Script=Greek}]+|\d+(?:\.\d+)*|[^A-Za-z\p{Script=Greek}\d]+/gu)]
      for (const piece of pieces) {
        const value = piece[0]
        const functionMatch = FUNCTIONS.exec(value)
        const suffix = text.slice(piece.index + value.length) + (run.nextSibling?.textContent ?? '')
        const label = /^[A-Da-d]$/u.test(value) && /^[.．、]/u.test(suffix)
        const citation = /^[AB]$/u.test(value) && /^版/u.test(suffix) || value === 'P' && /^\d/u.test(suffix)
        const variable = !label && !citation && (/^[A-Za-z\p{Script=Greek}]$/u.test(value) || /^[A-Z]{2,4}$/u.test(value)) &&
          !['PDF', 'PNG', 'JPG', 'DOCX'].includes(value)
        if (functionMatch !== null) {
          paragraph.insertBefore(textRun(run, value.slice(0, -1), false), run)
          paragraph.insertBefore(textRun(run, value.slice(-1), true), run)
        } else paragraph.insertBefore(textRun(run, value, variable, vectors.has(value)), run)
      }
      paragraph.removeChild(run)
    }
  }
}

function elements(parent: XmlElement): XmlElement[] {
  return Array.from(parent.childNodes).filter((node): node is XmlElement => node.nodeType === node.ELEMENT_NODE)
}

function choiceParagraph(paragraph: XmlElement): boolean {
  return paragraph.getElementsByTagNameNS(WORD_NS, 'pStyle').item(0)?.getAttributeNS(WORD_NS, 'val')?.startsWith('DshExampleChoices') === true
}

function normalizeChoiceSpaces(paragraph: XmlElement): void {
  for (const run of elements(paragraph).filter(plainRun)) {
    for (const text of Array.from(run.getElementsByTagNameNS(WORD_NS, 't'))) {
      text.textContent = (text.textContent ?? '').replace(/[\t ]+/gu, ' ')
    }
  }
}

function plainRun(node: XmlElement): boolean {
  return node.namespaceURI === WORD_NS && node.localName === 'r' && elements(node).every(child =>
    child.namespaceURI === WORD_NS && (child.localName === 't' || child.localName === 'rPr'),
  ) && node.getElementsByTagNameNS(WORD_NS, 't').length > 0
}

function textRun(source: XmlElement, text: string, variable?: boolean, vector = false): XmlElement {
  const run = source.cloneNode(false) as XmlElement
  const document = source.ownerDocument
  if (document === null) throw new Error('Collected Word text run has no owning document')
  const previous = elements(source).find(node => node.localName === 'rPr')
  const properties = previous?.cloneNode(true) as XmlElement | undefined ?? document.createElementNS(WORD_NS, 'w:rPr')
  if (variable !== undefined) {
    for (const node of elements(properties).filter(node => node.localName === 'rStyle')) properties.removeChild(node)
    if (variable) {
      const style = document.createElementNS(WORD_NS, 'w:rStyle')
      style.setAttributeNS(WORD_NS, 'w:val', vector ? 'DshExampleVector' : 'DshExampleVariable')
      properties.insertBefore(style, properties.firstChild)
    }
  }
  run.appendChild(properties)
  const value = document.createElementNS(WORD_NS, 'w:t')
  value.setAttributeNS(XML_NS, 'xml:space', 'preserve')
  value.textContent = text
  run.appendChild(value)
  return run
}

function slicePieces(pieces: readonly Piece[], start: number, end: number): XmlElement[] {
  return pieces.filter(piece => piece.start < end && piece.end > start).map(piece => piece.plain
    ? textRun(piece.node, piece.text.slice(Math.max(0, start - piece.start), Math.min(piece.text.length, end - piece.start)))
    : piece.node.cloneNode(true) as XmlElement)
}

function estimateWidth(nodes: readonly XmlElement[]): number {
  let width = 0
  for (const node of nodes) {
    for (const character of (node.textContent ?? '').trim()) {
      width += /\p{Script=Han}/u.test(character) ? 240 : /\s/u.test(character) ? 60 : 120
    }
  }
  return width
}

function trimEdges(nodes: XmlElement[]): XmlElement[] {
  for (const edge of ['start', 'end'] as const) {
    while (nodes.length > 0) {
      const index = edge === 'start' ? 0 : nodes.length - 1
      const node = nodes[index]
      if (node === undefined) break
      if (!plainRun(node)) break
      const text = node.textContent ?? ''
      const trimmed = edge === 'start' ? text.trimStart() : text.trimEnd()
      if (trimmed === '') nodes.splice(index, 1)
      else {
        nodes[index] = textRun(node, trimmed)
        break
      }
    }
  }
  return nodes
}
