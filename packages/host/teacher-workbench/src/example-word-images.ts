/** Embedded OCR illustrations and relationship-safe image import for collection DOCX files. */

import { posix } from 'node:path'
import type { OcrExtractedImage } from '@deepseek-ai/dsh-ocr'
import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom'
import { ImageRun, TextRun } from 'docx'
import { strFromU8 } from 'fflate'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { mathFromMarkdown } from 'mdast-util-math'
import { math } from 'micromark-extension-math'
import sharp from 'sharp'
import { visit } from 'unist-util-visit'

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const INLINE_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const EMU_PER_PIXEL = 9525

function illustrationSize(width: number, height: number): { width: number; height: number } {
  // Figures occupy at most 3 × 2.25 inches beneath the question text.
  const scale = Math.min(1, 288 / width, 216 / height)
  return { width: width * scale, height: height * scale }
}

/**
 * Fit saved illustrations within the collection's printed figure area without changing media or paragraph placement.
 * @param document - collection Word XML, including paragraphs with user-edited text formatting.
 */
export function normalizeExampleImageSizes(document: XmlDocument): void {
  for (const drawing of Array.from(document.getElementsByTagNameNS(WORD_NS, 'drawing'))) {
    const extent = drawing.getElementsByTagNameNS(INLINE_NS, 'extent').item(0)
    if (extent === null) throw new Error('Example Word image has no drawing dimensions')
    const width = Number(extent.getAttribute('cx')) / EMU_PER_PIXEL
    const height = Number(extent.getAttribute('cy')) / EMU_PER_PIXEL
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('Example Word image data or dimensions are invalid')
    }
    const size = illustrationSize(width, height)
    if (size.width === width && size.height === height) continue
    const extents = [extent, ...Array.from(drawing.getElementsByTagNameNS(DRAWING_NS, 'xfrm'))
      .flatMap(transform => Array.from(transform.getElementsByTagNameNS(DRAWING_NS, 'ext')))]
    for (const target of extents) {
      target.setAttribute('cx', String(Math.round(size.width * EMU_PER_PIXEL)))
      target.setAttribute('cy', String(Math.round(size.height * EMU_PER_PIXEL)))
    }
  }
}

/** One direct Markdown illustration with offsets into its original text. */
export interface ExampleImageReference {
  readonly kind: 'image'
  readonly start: number
  readonly end: number
  readonly target: string
  readonly alt: string
}

/**
 * Locate Markdown illustrations without interpreting code as image syntax.
 * @param markdown - extracted text or a saved collection text run.
 * @returns image references in reading order.
 */
export function exampleImageReferences(markdown: string): readonly ExampleImageReference[] {
  const references: ExampleImageReference[] = []
  const tree = fromMarkdown(markdown, { extensions: [math()], mdastExtensions: [mathFromMarkdown()] })
  visit(tree, 'image', (node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) throw new Error('Parsed illustration has no source positions')
    references.push({ kind: 'image', start, end, target: node.url, alt: node.alt ?? '' })
  })
  return references
}

/**
 * Embed a referenced OCR illustration as a proportionally sized PNG.
 * @param reference - Markdown image target and accessibility text.
 * @param images - complete provider-returned assets; targets are never fetched or read from the filesystem.
 * @returns an inline Word image; missing or undecodable assets fail conversion.
 */
export async function exampleImageRun(reference: ExampleImageReference, images: readonly OcrExtractedImage[]): Promise<ImageRun> {
  const image = images.find(candidate => candidate.name === reference.target)
  if (image === undefined) throw new Error(`Example illustration is unavailable: ${reference.target}`)
  const normalized = await sharp(Buffer.from(image.contentBase64, 'base64'), { failOn: 'error' })
    .rotate().png().toBuffer({ resolveWithObject: true })
  return new ImageRun({
    data: normalized.data,
    type: 'png',
    transformation: illustrationSize(normalized.info.width, normalized.info.height),
    altText: { name: image.name, title: reference.alt, description: reference.alt },
  })
}

/**
 * Restore illustrations in a saved text run while keeping its neighboring text.
 * @param text - original collection-generated run text.
 * @param images - assets recovered from the same source document.
 * @returns replacement runs, or undefined when the run has no illustration references.
 */
export async function restoreExampleImageText(
  text: string,
  images: readonly OcrExtractedImage[],
): Promise<readonly (ImageRun | TextRun)[] | undefined> {
  const references = exampleImageReferences(text)
  if (references.length === 0) return undefined
  const runs: (ImageRun | TextRun)[] = []
  let cursor = 0
  for (const reference of references) {
    if (reference.start > cursor) runs.push(new TextRun(text.slice(cursor, reference.start)))
    runs.push(await exampleImageRun(reference, images))
    cursor = reference.end
  }
  if (cursor < text.length) runs.push(new TextRun(text.slice(cursor)))
  return runs
}

/**
 * Import one saved collection image through docx so each compiled document owns its media relationships.
 * @param run - collection-generated drawing run.
 * @param entries - decompressed source DOCX package.
 * @returns an image retaining its bytes, dimensions, and alternative text; broken or external relationships fail.
 */
export function importExampleImage(run: XmlElement, entries: Readonly<Record<string, Uint8Array>>): ImageRun {
  const blips = run.getElementsByTagNameNS(DRAWING_NS, 'blip')
  const extent = run.getElementsByTagNameNS(INLINE_NS, 'extent').item(0)
  const properties = run.getElementsByTagNameNS(INLINE_NS, 'docPr').item(0)
  const encoded = entries['word/_rels/document.xml.rels']
  if (blips.length !== 1 || extent === null || encoded === undefined) throw new Error('Example Word image has no embedded drawing')
  const id = blips.item(0)?.getAttributeNS(RELATIONSHIP_NS, 'embed')
  const relationships = new DOMParser().parseFromString(strFromU8(encoded), 'application/xml')
  const relationship = Array.from(relationships.getElementsByTagName('Relationship')).find(node => node.getAttribute('Id') === id)
  const target = relationship?.getAttribute('Target')
  if (!target || relationship?.getAttribute('Type') !== `${RELATIONSHIP_NS}/image` || relationship.getAttribute('TargetMode') === 'External') {
    throw new Error('Example Word image relationship is unavailable')
  }
  const path = posix.normalize(posix.join('word', target))
  const bytes = entries[path]
  const type = posix.extname(path).slice(1)
  const width = Number(extent.getAttribute('cx')) / EMU_PER_PIXEL
  const height = Number(extent.getAttribute('cy')) / EMU_PER_PIXEL
  if (!path.startsWith('word/media/') || bytes === undefined || !['png', 'jpg', 'gif', 'bmp'].includes(type) ||
    !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Example Word image data or dimensions are invalid')
  }
  return new ImageRun({
    data: bytes,
    type: type as 'png' | 'jpg' | 'gif' | 'bmp',
    transformation: { width, height },
    altText: {
      name: properties?.getAttribute('name') ?? '',
      title: properties?.getAttribute('title') ?? '',
      description: properties?.getAttribute('descr') ?? '',
    },
  })
}
