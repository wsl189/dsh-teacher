/** Exact paragraph-prefix removal after visual heading identification; body XML and media remain intact. */

import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { normalizeExampleWordTypography } from './example-word-typography.ts'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const CUSTOM_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
const VT_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'
const REVIEWED = 'dsh.example.headingReviewed'
const IMAGE = '⟪image⟫'

/** Immutable Word projection supplied alongside the original image to the heading child. */
export interface ExampleHeadingEvidence {
  readonly text: string
  readonly paragraphs: readonly { readonly index: number; readonly text: string }[]
  /** Atomic markers preserve native equation boundaries in a copied heading prefix. */
  readonly equations: readonly { readonly marker: string; readonly text: string }[]
}

/** Exact metadata at the beginning of one zero-based Word paragraph. */
export interface ExampleHeadingRemoval {
  readonly paragraph: number
  readonly prefix: string
}

interface Piece {
  readonly node: XmlElement
  readonly text: string
  readonly start: number
  readonly end: number
  readonly plain: boolean
}

/**
 * Check whether this saved revision still needs visual heading identification.
 * @param bytes - one collection-generated Word document.
 * @returns false only when the document records a completed identification, including a no-heading result.
 */
export function exampleWordNeedsHeading(bytes: Uint8Array): boolean {
  const custom = unzipSync(bytes)['docProps/custom.xml']
  if (custom === undefined) return true
  const properties = new DOMParser().parseFromString(strFromU8(custom), 'application/xml')
  return !Array.from(properties.getElementsByTagNameNS(CUSTOM_NS, 'property'))
    .some(property => property.getAttribute('name') === REVIEWED && property.textContent === '2')
}

/**
 * Project saved Word text without flattening native equations into editable prose.
 * @param bytes - normalized question or explanation DOCX.
 * @returns exact text for prefix selection, with separately labelled native equations.
 */
export function exampleHeadingEvidence(bytes: Uint8Array): ExampleHeadingEvidence {
  return projectWord(bytes).evidence
}

/**
 * Delete exact paragraph prefixes identified by the child and record completion in the Word file.
 * @param bytes - the same normalized DOCX used to build the child evidence.
 * @param headings - paragraph positions and exact prefixes, or an empty list for a no-heading decision.
 * @returns reviewed DOCX; invalid prefixes throw before any bytes are replaced.
 */
export function removeExampleHeading(bytes: Uint8Array, headings: readonly ExampleHeadingRemoval[]): Buffer {
  const { entries, document, pieces, evidence, ranges } = projectWord(bytes)
  const seen = new Set<number>()
  const deletions = headings.map(({ paragraph, prefix }) => {
    const range = ranges[paragraph]
    const text = evidence.paragraphs[paragraph]?.text
    if (!Number.isInteger(paragraph) || seen.has(paragraph) || range === undefined || text === undefined ||
      !prefix || !text.startsWith(prefix) || prefix.includes(IMAGE) || /^\s*[（(]\s*(?:\d+|[ivx]+)\s*[）)]/iu.test(prefix.normalize('NFKC')) ||
      pieces.some(piece => !piece.plain && piece.start < range.start + prefix.length && piece.end > range.start + prefix.length)) {
      throw new Error('The heading result must be an exact prefix that leaves native objects intact')
    }
    seen.add(paragraph)
    return { start: range.start, end: range.start + text.length - text.slice(prefix.length).trimStart().length }
  })
  if (deletions.length > 0 && pieces.every(piece => piece.text.replaceAll(IMAGE, '').trim() === '' ||
    deletions.some(range => piece.start >= range.start && piece.end <= range.end))) {
    throw new Error('The heading result must be an exact prefix that leaves the question body intact')
  }
  const equations = Array.from(document.getElementsByTagNameNS(MATH_NS, 'oMath'))
  for (const piece of pieces) {
    const deletion = deletions.find(range => piece.start >= range.start && piece.start < range.end)
    if (deletion === undefined) continue
    const end = deletion.end
    if (piece.end <= end) piece.node.parentNode?.removeChild(piece.node)
    else {
      piece.node.textContent = piece.text.slice(end - piece.start)
      piece.node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    }
  }
  for (const { paragraph } of headings) {
    const range = ranges[paragraph]
    const ending = pieces.find(piece => piece.text === '\n' && piece.start === range?.end)?.node
    if (ending !== undefined && !ending.textContent?.trim() && ending.getElementsByTagNameNS(WORD_NS, 'drawing').length === 0) ending.parentNode?.removeChild(ending)
  }
  const retained = new Set(Array.from(document.getElementsByTagNameNS(MATH_NS, 'oMath')))
  const removed = equations.flatMap((equation, index) => retained.has(equation) ? [] : [index])
  const custom = entries['docProps/custom.xml']
  const parser = new DOMParser()
  const properties = parser.parseFromString(custom === undefined
    ? `<Properties xmlns="${CUSTOM_NS}" xmlns:vt="${VT_NS}"/>` : strFromU8(custom), 'application/xml')
  const root = properties.documentElement
  if (root === null) throw new Error('Example Word custom properties are empty')
  const serializer = new XMLSerializer()
  if (removed.length > 0) {
    const property = Array.from(root.getElementsByTagNameNS(CUSTOM_NS, 'property'))
      .find(node => node.getAttribute('name') === 'dsh.example.mathml')
    if (property !== undefined) {
      const preview = parser.parseFromString(property.textContent ?? '', 'application/xml')
      const mathml = Array.from(preview.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math'))
      if (mathml.length !== equations.length) throw new Error('Example Word equations and preview MathML do not align')
      const removedIndexes = new Set(removed)
      for (const [index, equation] of mathml.entries()) if (removedIndexes.has(index)) equation.parentNode?.removeChild(equation)
      const value = property.firstChild
      if (value === null) throw new Error('Example Word preview property has no value')
      value.textContent = serializer.serializeToString(preview)
    }
  }
  const current = Array.from(root.getElementsByTagNameNS(CUSTOM_NS, 'property'))
  let reviewed = current.find(property => property.getAttribute('name') === REVIEWED)
  if (reviewed === undefined) {
    reviewed = properties.createElementNS(CUSTOM_NS, 'property')
    reviewed.setAttribute('fmtid', '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}')
    reviewed.setAttribute('pid', String(Math.max(1, ...current.map(property => Number(property.getAttribute('pid')))) + 1))
    reviewed.setAttribute('name', REVIEWED)
    root.appendChild(reviewed)
  }
  reviewed.textContent = ''
  const value = properties.createElementNS(VT_NS, 'vt:lpwstr')
  value.textContent = '2'
  reviewed.appendChild(value)
  entries['word/document.xml'] = strToU8(serializer.serializeToString(document))
  entries['docProps/custom.xml'] = strToU8(serializer.serializeToString(properties))
  // docx emits the custom-properties part and relationships even when its property list is empty.
  const reviewedBytes = Buffer.from(zipSync(entries))
  return normalizeExampleWordTypography(reviewedBytes) ?? reviewedBytes
}

function projectWord(bytes: Uint8Array) {
  const entries = unzipSync(bytes)
  const xml = entries['word/document.xml']
  if (xml === undefined) throw new Error('Example Word file has no document XML')
  const document = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
  const body = document.getElementsByTagNameNS(WORD_NS, 'body').item(0)
  if (body === null) throw new Error('Example Word file has no document body')
  const pieces: Piece[] = []
  const equations: { marker: string; text: string }[] = []
  const paragraphs: { index: number; text: string }[] = []
  const ranges: { start: number; end: number }[] = []
  let offset = 0
  const append = (node: XmlElement, text: string, plain = false): void => {
    pieces.push({ node, text, plain, start: offset, end: offset + text.length })
    offset += text.length
  }
  const collect = (node: XmlElement): void => {
    if (node.namespaceURI === MATH_NS && ['oMath', 'oMathPara'].includes(node.localName ?? '')) {
      const marker = `⟪math:${String(equations.length)}⟫`
      equations.push({ marker, text: node.textContent ?? '' })
      append(node, marker)
    } else if (node.namespaceURI === WORD_NS && node.localName === 't') append(node, node.textContent ?? '', true)
    else if (node.namespaceURI === WORD_NS && ['tab', 'br', 'cr'].includes(node.localName ?? '')) append(node, ' ')
    else if (node.namespaceURI === WORD_NS && ['p', 'r', 'hyperlink'].includes(node.localName ?? '')) {
      for (const child of Array.from(node.childNodes)) if (child.nodeType === child.ELEMENT_NODE) collect(child as XmlElement)
    } else if (!['pPr', 'rPr', 'sectPr'].includes(node.localName ?? '')) append(node, IMAGE)
  }
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType !== node.ELEMENT_NODE || node.localName === 'sectPr') continue
    const start = offset
    const pieceStart = pieces.length
    collect(node as XmlElement)
    paragraphs.push({ index: paragraphs.length, text: pieces.slice(pieceStart).map(piece => piece.text).join('') })
    ranges.push({ start, end: offset })
    append(node as XmlElement, '\n')
  }
  return { entries, document, pieces, ranges, evidence: { text: pieces.map(piece => piece.text).join(''), paragraphs, equations } }
}
