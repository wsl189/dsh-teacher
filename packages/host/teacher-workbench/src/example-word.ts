/** OCR text and LaTeX math as editable Word paragraphs and native Office equations. */

import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom'
import type { OcrExtractedImage } from '@deepseek-ai/dsh-ocr'
import { Document, ImageRun, ImportedXmlComponent, Packer, Paragraph, TextRun, type ParagraphChild } from 'docx'
import { strFromU8, unzipSync } from 'fflate'
import katex from 'katex'
import { mml2omml } from 'mathml2omml'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { mathFromMarkdown } from 'mdast-util-math'
import { math } from 'micromark-extension-math'
import { visit } from 'unist-util-visit'
import { normalizeExampleWordTypography } from './example-word-typography.ts'
import { exampleWordNeedsHeading, removeExampleHeading } from './example-word-heading.ts'
import { exampleImageReferences, exampleImageRun, importExampleImage, restoreExampleImageText, type ExampleImageReference } from './example-word-images.ts'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

interface Equation {
  readonly kind: 'equation'
  readonly start: number
  readonly end: number
  readonly value: string
  readonly display: boolean
}

interface WordContent {
  readonly paragraphs: readonly Paragraph[]
  readonly mathml: readonly string[]
}

/** One question or explanation from the collection's generated DOCX files. */
export interface ExampleWordBlock {
  readonly bytes: Uint8Array
  /** Recovered assets for unresolved Markdown illustrations in a saved document. */
  readonly images?: readonly OcrExtractedImage[]
  /** Separate this question or appendix explanation from the preceding item by two blank lines. */
  readonly blankLinesBefore?: boolean
  /** Start an explanation appendix on a new page. */
  readonly pageBreakBefore?: boolean
}

/**
 * Build a downloadable Word file from complete OCR text.
 * @param markdown - OCR Markdown; dollar-delimited math becomes native Office equations.
 * @param images - complete OCR illustration assets addressed by Markdown image targets.
 * @returns a DOCX whose equations remain editable in Word; unsupported TeX remains visible as text.
 */
export async function createExampleWord(markdown: string, images: readonly OcrExtractedImage[] = []): Promise<Buffer> {
  return packWord(await wordContent(markdown, images))
}

/**
 * Detect illustrations still stored as Markdown text rather than embedded Word images.
 * @param bytes - saved collection-generated DOCX.
 * @returns true when image bytes must be recovered from the original source before use.
 */
export function exampleWordNeedsImages(bytes: Uint8Array): boolean {
  const xml = unzipSync(bytes)['word/document.xml']
  if (xml === undefined) throw new Error('Example Word file has no document XML')
  const document = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
  return Array.from(document.getElementsByTagNameNS(WORD_NS, 'r')).some(run => exampleImageReferences(run.textContent ?? '').length > 0)
}

/**
 * Compile saved collection Word paragraphs without rerunning OCR or flattening native equations.
 * @param blocks - question/explanation documents in the requested order; no headings or metadata are added.
 * @returns one DOCX with uniform typography, native equations, and matching preview MathML.
 */
export async function compileExampleWord(blocks: readonly ExampleWordBlock[]): Promise<Buffer> {
  const paragraphs: Paragraph[] = []
  const mathml: string[] = []
  let sectionBreak: number | undefined
  for (const block of blocks) {
    if (block.pageBreakBefore) sectionBreak = paragraphs.length
    else if (block.blankLinesBefore) {
      for (let line = 0; line < 2; line++) {
        paragraphs.push(new Paragraph({ spacing: { before: 0, after: 0, line: 240 }, run: { size: 24 } }))
      }
    }
    const bytes = await normalizeExampleWord(block.bytes) ?? block.bytes
    const entries = unzipSync(bytes)
    const xml = entries['word/document.xml']
    if (xml === undefined) throw new Error('Example Word file has no document XML')
    const parser = new DOMParser()
    const document = parser.parseFromString(strFromU8(xml), 'application/xml')
    const body = document.getElementsByTagNameNS(WORD_NS, 'body').item(0)
    if (body === null) throw new Error('Example Word file has no document body')
    const elements = Array.from(body.childNodes).filter((element): element is XmlElement =>
      element.nodeType === element.ELEMENT_NODE && element.localName !== 'sectPr',
    )
    const empty = (element: XmlElement | undefined): boolean => element?.localName === 'p' && !element.textContent?.trim() &&
      element.getElementsByTagNameNS(WORD_NS, 'drawing').length === 0
    while (empty(elements[0])) elements.shift()
    while (empty(elements.at(-1))) elements.pop()
    const figures: Paragraph[] = []
    for (const element of elements) {
      if (element.namespaceURI !== WORD_NS || element.localName !== 'p') {
        throw new Error('Collection Word content must contain only generated paragraphs')
      }
      const paragraph = new Paragraph({})
      let movedImage = false
      let bodyContent = false
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType !== child.ELEMENT_NODE) continue
        const node = child as XmlElement
        if (node.namespaceURI === WORD_NS && node.localName === 'r') {
          if (node.getElementsByTagNameNS(WORD_NS, 'drawing').length > 0) {
            figures.push(new Paragraph({ style: 'DshExampleFigure', children: [importExampleImage(node, entries)] }))
            movedImage = true
            continue
          }
          const restored = await restoreExampleImageText(node.textContent ?? '', block.images ?? [])
          if (restored !== undefined) {
            for (const run of restored) {
              if (run instanceof ImageRun) {
                figures.push(new Paragraph({ style: 'DshExampleFigure', children: [run] }))
                movedImage = true
              } else {
                paragraph.addChildElement(run)
                bodyContent = true
              }
            }
            continue
          }
        }
        paragraph.addChildElement(importWordElement(node))
        if (node.localName !== 'pPr') bodyContent = true
      }
      if (bodyContent || !movedImage) paragraphs.push(paragraph)
    }
    paragraphs.push(...figures)
    const custom = entries['docProps/custom.xml']
    if (custom !== undefined) {
      const properties = parser.parseFromString(strFromU8(custom), 'application/xml')
      const property = Array.from(properties.getElementsByTagName('property'))
        .find(element => element.getAttribute('name') === 'dsh.example.mathml')
      if (property !== undefined) {
        const equations = parser.parseFromString(property.textContent ?? '', 'application/xml')
        const serializer = new XMLSerializer()
        for (const equation of Array.from(equations.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math'))) {
          mathml.push(serializer.serializeToString(equation))
        }
      }
    }
  }
  const bytes = await packWord({ paragraphs, mathml }, sectionBreak)
  return blocks.every(block => !exampleWordNeedsHeading(block.bytes)) ? removeExampleHeading(bytes, '') : bytes
}

/**
 * Normalize saved collection typography and convert supported text-only LaTeX without rerunning OCR.
 * @param bytes - saved collection DOCX; original text and mathematical emphasis are retained.
 * @returns updated bytes, or undefined when typography and equations need no changes.
 */
export async function normalizeExampleWord(bytes: Uint8Array): Promise<Buffer | undefined> {
  const xml = unzipSync(bytes)['word/document.xml']
  if (xml === undefined) throw new Error('Example Word file has no document XML')
  const document = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
  if (document.getElementsByTagNameNS(MATH_NS, 'oMath').length > 0 ||
    document.getElementsByTagNameNS(WORD_NS, 'drawing').length > 0 || exampleWordNeedsImages(bytes)) {
    return normalizeExampleWordTypography(bytes)
  }
  const markdown = Array.from(document.getElementsByTagNameNS(WORD_NS, 'p'))
    .map((paragraph) => {
      const text = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 't'))
        .map(node => node.textContent)
        .join('')
      return text
    })
    .join('\n')
  const content = await wordContent(markdown, [])
  if (content.mathml.length === 0) return normalizeExampleWordTypography(bytes)
  const rebuilt = await packWord(content)
  return exampleWordNeedsHeading(bytes) ? rebuilt : removeExampleHeading(rebuilt, '')
}

async function packWord(content: WordContent, sectionBreak?: number): Promise<Buffer> {
  const bytes = await Packer.toBuffer(
    new Document({
      sections: sectionBreak === undefined
        ? [{ children: content.paragraphs }]
        : [{ children: content.paragraphs.slice(0, sectionBreak) }, { children: content.paragraphs.slice(sectionBreak) }],
      customProperties:
        content.mathml.length === 0
          ? []
          : [
            {
              name: 'dsh.example.mathml',
              value: `<equations>${content.mathml.join('')}</equations>`,
            },
          ],
    }),
  )
  return normalizeExampleWordTypography(bytes) ?? bytes
}

async function wordContent(markdown: string, images: readonly OcrExtractedImage[]): Promise<WordContent> {
  const tree = fromMarkdown(markdown, { extensions: [math()], mdastExtensions: [mathFromMarkdown()] })
  const parts: (Equation | ExampleImageReference)[] = [...exampleImageReferences(markdown)]
  visit(tree, ['inlineMath', 'math'], (node) => {
    if (node.type !== 'inlineMath' && node.type !== 'math') return
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) throw new Error('Parsed equation has no source positions')
    parts.push({ kind: 'equation', start, end, value: node.value, display: node.type === 'math' })
  })
  parts.sort((left, right) => left.start - right.start)
  const paragraphs: Paragraph[] = []
  let children: ParagraphChild[] = []
  const mathml: string[] = []
  const finish = (): void => {
    if (children.length > 0) paragraphs.push(new Paragraph({ spacing: { after: 80 }, children }))
    children = []
  }
  const addText = (text: string): void => {
    const lines = text.split(/\r?\n/u)
    for (const [index, line] of lines.entries()) {
      if (index > 0) finish()
      const title = children.length === 0 ? /^(#{1,6})\s+(.+)$/u.exec(line) : null
      if (line !== '') children.push(new TextRun(title?.[2] ?? line))
    }
  }
  let cursor = 0
  for (const part of parts) {
    addText(markdown.slice(cursor, part.start))
    if (part.kind === 'image') {
      children.push(await exampleImageRun(part, images))
      cursor = part.end
      continue
    }
    const native = nativeEquation(part)
    if (native === undefined) addText(markdown.slice(part.start, part.end))
    else {
      children.push(native.word)
      mathml.push(native.mathml)
    }
    cursor = part.end
  }
  addText(markdown.slice(cursor))
  finish()
  return { paragraphs, mathml }
}

function nativeEquation(equation: Equation): { word: ImportedXmlComponent; mathml: string } | undefined {
  let mathml: string
  try {
    mathml = katex.renderToString(equation.value, {
      output: 'mathml',
      displayMode: equation.display,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
    })
  } catch (error) {
    // Unsupported or malformed OCR TeX stays visible for correction in the exported document.
    if (error instanceof katex.ParseError) return undefined
    throw error
  }
  const parser = new DOMParser()
  const math = parser.parseFromString(mathml, 'application/xml')
    .getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math').item(0)
  if (math === null) throw new Error('TeX conversion returned no MathML')
  for (const annotation of Array.from(math.getElementsByTagName('annotation'))) annotation.parentNode?.removeChild(annotation)
  mathml = new XMLSerializer().serializeToString(math)
  const office = parser.parseFromString(mml2omml(mathml), 'application/xml').documentElement
  if (office === null) throw new Error('MathML conversion returned no Office equation')
  return { word: importWordElement(office), mathml }
}

// docx's XML-string factory retains a document wrapper; Word needs the equation directly inside its paragraph.
function importWordElement(element: XmlElement): ImportedXmlComponent {
  const attributes = Object.fromEntries(Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]))
  const component = new ImportedXmlComponent(element.tagName, attributes)
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === child.ELEMENT_NODE) component.push(importWordElement(child as XmlElement))
    else if (child.nodeType === child.TEXT_NODE) component.push(child.textContent ?? '')
  }
  return component
}
