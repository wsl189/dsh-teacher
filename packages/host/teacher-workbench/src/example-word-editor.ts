/** Structured editing of collection DOCX paragraphs with native equation and image preservation. */

import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { MathMLToLaTeX } from 'mathml-to-latex'
import { exampleLatexToOffice, exampleMathmlToOffice, formatExampleOfficeMath } from './example-word-math.ts'
import { z } from 'zod'
import { removeExampleHeading } from './example-word-heading.ts'
import type { TeacherExampleTextFormat, TeacherExampleWordEditor, TeacherExampleWordInline, TeacherExampleWordParagraph } from './example-types.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const ML = 'http://www.w3.org/1998/Math/MathML'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const parser = new DOMParser()
const serializer = new XMLSerializer()
const formatSchema = z.object({
  font: z.string().min(1).max(100), eastAsiaFont: z.string().min(1).max(100), size: z.number().min(5).max(96),
  bold: z.boolean(), italic: z.boolean(), underline: z.boolean(),
}).strict()

/** Validated editor paragraphs with text and equation sizes between 5 and 96 points. */
export const exampleWordParagraphsSchema = z.array(z.object({
  alignment: z.enum(['left', 'center', 'right', 'both']), lineSpacing: z.number().min(1).max(3),
  indent: z.number().min(0).max(288), firstLine: z.number().min(-288).max(288),
  spaceBefore: z.number().min(0).max(144), spaceAfter: z.number().min(0).max(144),
  tabs: z.array(z.number().min(0).max(720)).max(20),
  content: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string(), format: formatSchema }).strict(),
    z.object({ kind: z.literal('equation'), original: z.number().int().nonnegative().nullable(), latex: z.string().min(1), size: z.number().min(5).max(96), bold: z.boolean() }).strict(),
    z.object({ kind: z.literal('image'), original: z.number().int().nonnegative() }).strict(),
    z.object({ kind: z.literal('break') }).strict(),
  ])),
}).strict()).min(1)

/**
 * Read editable content directly from the current saved Word artifact.
 * @param bytes - normalized collection DOCX, including preview MathML and embedded media.
 * @returns paragraph content and immutable object previews without accepting client XML.
 */
export function readExampleWordEditor(bytes: Uint8Array): Omit<TeacherExampleWordEditor, 'sourceId' | 'wordRevision'> {
  const original = openWord(bytes)
  return { paragraphs: original.paragraphs, equations: original.equations, images: original.images }
}

/**
 * Apply validated user edits while retaining unchanged native equations, images, and package relationships.
 * @param bytes - the exact Word revision from which the browser editor was loaded.
 * @param paragraphs - ordered paragraphs; image/equation indexes address this revision only.
 * @returns DOCX with user-owned formatting and matching preview MathML.
 */
export function saveExampleWordEditor(bytes: Uint8Array, paragraphs: readonly TeacherExampleWordParagraph[]): Buffer {
  const original = openWord(bytes)
  const { document, body, entries } = original
  const section = children(body).find(node => node.localName === 'sectPr')
  for (const node of children(body)) if (node !== section) body.removeChild(node)
  const equations: string[] = []
  for (const paragraph of paragraphs) {
    const p = document.createElementNS(W, 'w:p')
    const properties = document.createElementNS(W, 'w:pPr')
    p.appendChild(properties)
    const columns = paragraph.tabs.length + 1
    const tabCount = paragraph.content.reduce((count, inline) => count + (inline.kind === 'text' ? (inline.text.match(/\t/gu) ?? []).length : 0), 0)
    property(properties, 'pStyle', { val: tabCount === columns - 1 && [2, 4].includes(columns) ? `DshExampleEditedChoices${String(columns)}` : 'DshExampleEdited' })
    property(properties, 'widowControl', { val: 'true' })
    if (paragraph.tabs.length > 0) {
      const tabs = document.createElementNS(W, 'w:tabs')
      properties.appendChild(tabs)
      for (const position of paragraph.tabs) {
        const tab = document.createElementNS(W, 'w:tab')
        tab.setAttributeNS(W, 'w:val', 'left')
        tab.setAttributeNS(W, 'w:pos', String(Math.round(position * 20)))
        tabs.appendChild(tab)
      }
    }
    property(properties, 'spacing', { before: String(Math.round(paragraph.spaceBefore * 20)), after: String(Math.round(paragraph.spaceAfter * 20)), line: String(Math.round(paragraph.lineSpacing * 240)), lineRule: 'auto' })
    property(properties, 'ind', { left: String(Math.round(paragraph.indent * 20)), ...(paragraph.firstLine < 0 ? { hanging: String(Math.round(-paragraph.firstLine * 20)) } : { firstLine: String(Math.round(paragraph.firstLine * 20)) }) })
    property(properties, 'jc', { val: paragraph.alignment })
    for (const inline of paragraph.content) {
      if (inline.kind === 'text') {
        const run = document.createElementNS(W, 'w:r')
        const pr = document.createElementNS(W, 'w:rPr')
        run.appendChild(pr)
        property(pr, 'rFonts', { ascii: inline.format.font, hAnsi: inline.format.font, eastAsia: inline.format.eastAsiaFont, cs: inline.format.font })
        property(pr, 'b', { val: String(inline.format.bold) })
        property(pr, 'i', { val: String(inline.format.italic) })
        property(pr, 'sz', { val: String(Math.round(inline.format.size * 2)) })
        property(pr, 'szCs', { val: String(Math.round(inline.format.size * 2)) })
        property(pr, 'u', { val: inline.format.underline ? 'single' : 'none' })
        for (const text of inline.text.split(/([\t\n])/u)) {
          const node = document.createElementNS(W, text === '\t' ? 'w:tab' : text === '\n' ? 'w:br' : 'w:t')
          if (node.localName === 't') {
            node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
            node.textContent = text
          }
          run.appendChild(node)
        }
        p.appendChild(run)
      } else if (inline.kind === 'equation') {
        const previous = inline.original === null ? undefined : original.equations[inline.original]
        if (inline.original !== null && previous === undefined) throw new Error('Unknown equation reference')
        let native: XmlElement | undefined
        let mathml: string
        if (previous !== undefined && inline.latex === previous.latex) {
          native = original.nativeEquations[inline.original ?? -1]
          mathml = previous.mathml
        } else {
          const converted = exampleLatexToOffice(inline.latex, false)
          native = converted.office
          mathml = converted.mathml
        }
        if (native === undefined) throw new Error('Equation XML is missing')
        const preview = parser.parseFromString(mathml, 'application/xml').documentElement
        if (preview === null) throw new Error('Equation preview is missing')
        const boldChanged = equationBold(preview) !== inline.bold
        if (boldChanged) {
          // Intrinsic letter styles stay in MathML when whole-equation bold is removed.
          preview.removeAttribute('style')
          native = exampleMathmlToOffice(serializer.serializeToString(preview))
        }
        const clone = document.importNode(native, true)
        const currentSize = Number(native.getElementsByTagNameNS(W, 'sz').item(0)?.getAttributeNS(W, 'val') ?? '24') / 2
        if (currentSize !== inline.size || boldChanged) {
          formatExampleOfficeMath(clone, inline.size, inline.bold)
          preview.setAttribute('style', `font-size:${String(inline.size)}pt;font-weight:${inline.bold ? 'bold' : 'normal'}`)
          mathml = serializer.serializeToString(preview)
        }
        p.appendChild(clone)
        equations.push(mathml)
      } else if (inline.kind === 'image') {
        const image = original.nativeImages[inline.original]
        if (image === undefined) throw new Error('Unknown image reference')
        p.appendChild(document.importNode(image, true))
      } else {
        const run = document.createElementNS(W, 'w:r')
        run.appendChild(document.createElementNS(W, 'w:br'))
        p.appendChild(run)
      }
    }
    body.insertBefore(p, section ?? null)
  }
  const previewProperty = customMath(entries)
  const value = previewProperty.property.firstChild
  if (value === null) throw new Error('Word preview property has no value')
  value.textContent = `<equations>${equations.join('')}</equations>`
  entries['docProps/custom.xml'] = strToU8(serializer.serializeToString(previewProperty.document))
  entries['word/document.xml'] = strToU8(serializer.serializeToString(document))
  return removeExampleHeading(zipSync(entries), [])
}

function openWord(bytes: Uint8Array) {
  const entries = unzipSync(bytes)
  const xml = entries['word/document.xml']
  if (xml === undefined) throw new Error('Word document XML is missing')
  const document = parser.parseFromString(strFromU8(xml), 'application/xml')
  const body = document.getElementsByTagNameNS(W, 'body').item(0)
  if (body === null) throw new Error('Word body is missing')
  const preview = parser.parseFromString(customMath(entries).property.textContent ?? '<equations/>', 'application/xml')
  const equations = Array.from(preview.getElementsByTagNameNS(ML, 'math')).map((node) => {
    const mathml = serializer.serializeToString(node)
    return { mathml, latex: MathMLToLaTeX.convert(mathml) }
  })
  const nativeEquations = Array.from(document.getElementsByTagNameNS(M, 'oMath'))
  if (equations.length !== nativeEquations.length) throw new Error('Equation preview count does not match Word')
  const nativeImages: XmlElement[] = []
  const images: TeacherExampleWordEditor['images'][number][] = []
  const relationships = parser.parseFromString(strFromU8(entries['word/_rels/document.xml.rels'] ?? strToU8('<Relationships/>')), 'application/xml')
  const paragraphs: TeacherExampleWordParagraph[] = []
  for (const p of children(body)) {
    if (p.localName === 'sectPr') continue
    if (p.namespaceURI !== W || p.localName !== 'p') throw new Error('Only collection Word paragraphs are editable')
    const pr = children(p).find(node => node.localName === 'pPr')
    const alignment = attr(pr, 'jc', 'val')
    const content: TeacherExampleWordInline[] = []
    const collect = (node: XmlElement): void => {
      if (node.namespaceURI === M && node.localName === 'oMath') {
        const original = nativeEquations.indexOf(node)
        const equation = equations[original]
        if (equation === undefined) throw new Error('Equation preview is missing')
        const math = preview.getElementsByTagNameNS(ML, 'math').item(original)
        if (math === null) throw new Error('Equation preview is missing')
        content.push({ kind: 'equation', original, latex: equation.latex, size: Number(node.getElementsByTagNameNS(W, 'sz').item(0)?.getAttributeNS(W, 'val') ?? '24') / 2, bold: equationBold(math) })
      } else if (node.namespaceURI === W && node.localName === 'r') {
        const runPr = children(node).find(child => child.localName === 'rPr')
        const format = readFormat(runPr)
        for (const child of children(node)) {
          if (child.localName === 't' || child.localName === 'tab') content.push({ kind: 'text', text: child.localName === 'tab' ? '\t' : child.textContent ?? '', format })
          else if (['br', 'cr'].includes(child.localName ?? '')) content.push({ kind: 'break' })
          else if (child.localName === 'drawing') {
            const relationship = child.getElementsByTagNameNS(A, 'blip').item(0)?.getAttributeNS(R, 'embed')
            const target = Array.from(relationships.getElementsByTagName('Relationship')).find(item => item.getAttribute('Id') === relationship)?.getAttribute('Target')
            const path = target?.startsWith('/') ? target.slice(1) : `word/${target ?? ''}`
            const data = entries[path]
            if (data === undefined) throw new Error('Embedded Word image is missing')
            const extension = path.split('.').at(-1)?.toLowerCase()
            const mediaType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension === 'gif' ? 'image/gif' : 'image/jpeg'
            const extent = child.getElementsByTagNameNS(WP, 'extent').item(0)
            const imageRun = document.createElementNS(W, 'w:r')
            imageRun.appendChild(child.cloneNode(true))
            content.push({ kind: 'image', original: images.length })
            nativeImages.push(imageRun)
            images.push({ mediaType, contentBase64: Buffer.from(data).toString('base64'), width: Number(extent?.getAttribute('cx') ?? '0') / 9525, height: Number(extent?.getAttribute('cy') ?? '0') / 9525 })
          } else if (child.localName !== 'rPr') throw new Error('Unsupported Word run content')
        }
      } else if (node.localName !== 'pPr') {
        if (['oMathPara', 'hyperlink'].includes(node.localName ?? '')) for (const child of children(node)) collect(child)
        else throw new Error('Unsupported Word paragraph content')
      }
    }
    for (const child of children(p)) collect(child)
    paragraphs.push({ alignment: alignment === 'center' || alignment === 'right' || alignment === 'both' ? alignment : 'left',
      lineSpacing: Number(attr(pr, 'spacing', 'line') ?? '300') / 240,
      indent: Number(attr(pr, 'ind', 'left') ?? '0') / 20,
      firstLine: Number(attr(pr, 'ind', 'firstLine') ?? '0') / 20 - Number(attr(pr, 'ind', 'hanging') ?? '0') / 20,
      spaceBefore: Number(attr(pr, 'spacing', 'before') ?? '0') / 20, spaceAfter: Number(attr(pr, 'spacing', 'after') ?? '80') / 20,
      tabs: Array.from(pr?.getElementsByTagNameNS(W, 'tab') ?? []).map(tab => Number(tab.getAttributeNS(W, 'pos')) / 20), content })
  }
  return { entries, document, body, paragraphs, equations, nativeEquations, images, nativeImages }
}

function customMath(entries: Record<string, Uint8Array>) {
  const namespace = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
  const document = parser.parseFromString(strFromU8(entries['docProps/custom.xml'] ?? strToU8(`<Properties xmlns="${namespace}"/>`)), 'application/xml')
  let property = Array.from(document.getElementsByTagNameNS(namespace, 'property')).find(node => node.getAttribute('name') === 'dsh.example.mathml')
  if (property === undefined) {
    const root = document.documentElement
    if (root === null) throw new Error('Word custom properties are missing')
    property = document.createElementNS(namespace, 'property')
    property.setAttribute('fmtid', '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}')
    property.setAttribute('pid', String(Math.max(1, ...Array.from(root.getElementsByTagNameNS(namespace, 'property')).map(item => Number(item.getAttribute('pid')))) + 1))
    property.setAttribute('name', 'dsh.example.mathml')
    const value = document.createElementNS('http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes', 'vt:lpwstr')
    value.textContent = '<equations/>'
    property.appendChild(value)
    root.appendChild(property)
  }
  return { document, property }
}

function children(node: XmlElement): XmlElement[] {
  return Array.from(node.childNodes).filter((child): child is XmlElement => child.nodeType === child.ELEMENT_NODE)
}

function equationBold(math: XmlElement): boolean {
  return /(?:^|;)\s*font-weight\s*:\s*(?:bold|700)\s*(?:;|$)/u.test(math.getAttribute('style') ?? '')
}

function attr(parent: XmlElement | undefined, name: string, key: string): string | undefined {
  return parent?.getElementsByTagNameNS(W, name).item(0)?.getAttributeNS(W, key) ?? undefined
}

function readFormat(pr: XmlElement | undefined): TeacherExampleTextFormat {
  const enabled = (name: string): boolean => pr?.getElementsByTagNameNS(W, name).length !== undefined &&
    (pr.getElementsByTagNameNS(W, name).length > 0 && !['false', '0', 'none'].includes(attr(pr, name, 'val') ?? 'true'))
  return { font: attr(pr, 'rFonts', 'ascii') ?? 'Times New Roman', eastAsiaFont: attr(pr, 'rFonts', 'eastAsia') ?? '宋体',
    size: Number(attr(pr, 'sz', 'val') ?? '24') / 2, bold: enabled('b'), italic: enabled('i'), underline: enabled('u') }
}

function property(parent: XmlElement, name: string, values: Readonly<Record<string, string>>): void {
  const document = parent.ownerDocument
  if (document === null) throw new Error('Word property has no owner document')
  let element = children(parent).find(node => node.namespaceURI === W && node.localName === name)
  if (element === undefined) {
    element = document.createElementNS(W, `w:${name}`)
    parent.appendChild(element)
  }
  for (const [key, value] of Object.entries(values)) element.setAttributeNS(W, `w:${key}`, value)
}
