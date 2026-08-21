/** Browser upload adapter for the shared OCR Remote. */

import type {
  OcrExtractResult,
  OcrLayoutLimitsResult,
  OcrLayoutPage,
  OcrLayoutRequest,
  OcrLayoutResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { PDFDocument } from 'pdf-lib'
import { renderPdfPageForOcr } from './question-segmentation.ts'

/** OCR Remote subset consumed by teacher-workbench uploads. */
export interface TeacherWorkbenchOcrRemote {
  /** Extract one browser file encoded for the JSON RPC transport. */
  extract: (request: {
    name: string
    mediaType: string
    contentBase64: string
  }) => Promise<RemoteResult<OcrExtractResult>>
  /** Extract provider-neutral page geometry. */
  layout: (request: OcrLayoutRequest) => Promise<RemoteResult<OcrLayoutResult>>
  /** Read the selected provider's current structured-layout request limits. */
  layoutLimits: () => Promise<RemoteResult<OcrLayoutLimitsResult>>
}

/** Optional extraction features selected by one workbench workflow. */
export interface TeacherWorkbenchExtractOptions {
  /** Retain peripheral text that may contain a table title or grade label. */
  readonly includeDiscardedText?: boolean
  /** Ask the OCR provider to cross-check raster images at multiple scales and regions. */
  readonly enhanceImageDetail?: boolean
}

/**
 * Extract page geometry for deterministic browser-side question cutting.
 * @param file - source PDF.
 * @param remote - generated OCR Remote namespace.
 * @param pageIndexes - exact zero-based source pages to parse; omitted parses every page.
 * @param rasterScale - PDF.js scale used only when one copied page still exceeds the provider limit.
 * @returns normalized layout or a transport failure.
 */
export async function extractWorkbenchLayout(
  file: File,
  remote: TeacherWorkbenchOcrRemote,
  pageIndexes?: readonly number[],
  rasterScale = 2,
): Promise<OcrLayoutResult> {
  try {
    const carriedLimits = await remote.layoutLimits()
    if (!carriedLimits.ok) return transportFailure(carriedLimits.error.message)
    if (!carriedLimits.value.ok) return carriedLimits.value
    const limits = carriedLimits.value.value
    const sourceBytes = new Uint8Array(await file.arrayBuffer())
    const source = await PDFDocument.load(sourceBytes)
    const indexes = pageIndexes === undefined
      ? Array.from({ length: source.getPageCount() }, (_, index) => index)
      : [...pageIndexes]
    validatePageIndexes(indexes, source.getPageCount())
    // MinerU deployments may key active work by upload name; one id prevents
    // concurrent papers with the same selected range from colliding.
    const batchId = uploadBatchId()
    const pages: OcrLayoutPage[] = []
    let provider: string | undefined
    for (let offset = 0; offset < indexes.length; offset += limits.maxPagesPerRequest) {
      const batch = indexes.slice(offset, offset + limits.maxPagesPerRequest)
      const result = await extractPdfLayoutBatch(file, source, batch, batchId, limits.maxFileBytes, rasterScale, remote)
      if (!result.ok) return result
      provider ??= result.value.provider
      pages.push(...result.value.pages)
    }
    pages.sort((left, right) => left.pageIndex - right.pageIndex)
    return pages.length === 0
      ? { ok: false, error: { code: 'empty-result', message: 'document layout contains no pages' } }
      : { ok: true, value: { name: file.name, provider: provider ?? 'unknown', pages } }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'provider-failure',
        message: error instanceof Error ? error.message : 'document layout extraction failed',
      },
    }
  }
}

async function extractPdfLayoutBatch(
  sourceFile: File,
  source: PDFDocument,
  pageIndexes: readonly number[],
  batchId: string,
  maxFileBytes: number,
  rasterScale: number,
  remote: TeacherWorkbenchOcrRemote,
): Promise<OcrLayoutResult> {
  const batch = await PDFDocument.create()
  const copied = await batch.copyPages(source, [...pageIndexes])
  for (const page of copied) batch.addPage(page)
  const bytes = await batch.save({ useObjectStreams: true })
  if (bytes.byteLength > maxFileBytes) {
    if (pageIndexes.length > 1) {
      const split = Math.ceil(pageIndexes.length / 2)
      return mergeLayoutResults(
        sourceFile.name,
        await extractPdfLayoutBatch(sourceFile, source, pageIndexes.slice(0, split), batchId, maxFileBytes, rasterScale, remote),
        await extractPdfLayoutBatch(sourceFile, source, pageIndexes.slice(split), batchId, maxFileBytes, rasterScale, remote),
      )
    }
    const [pageIndex] = pageIndexes
    if (pageIndex === undefined) return { ok: false, error: { code: 'empty-result', message: 'PDF batch contains no pages' } }
    const raster = await renderPdfPageForOcr(sourceFile, pageIndex, rasterScale, maxFileBytes)
    return extractLayoutBytes(remote, sourceFile.name, new Uint8Array(await raster.arrayBuffer()), 'image/png', batchId, [pageIndex])
  }
  return extractLayoutBytes(remote, sourceFile.name, bytes, 'application/pdf', batchId, pageIndexes)
}

async function extractLayoutBytes(
  remote: TeacherWorkbenchOcrRemote,
  sourceName: string,
  bytes: Uint8Array,
  mediaType: string,
  batchId: string,
  sourcePageIndexes: readonly number[],
): Promise<OcrLayoutResult> {
  const firstPage = sourcePageIndexes[0]
  const lastPage = sourcePageIndexes.at(-1)
  if (firstPage === undefined || lastPage === undefined) {
    return { ok: false, error: { code: 'empty-result', message: 'PDF batch contains no pages' } }
  }
  const carried = await remote.layout({
    name: `paper-${batchId}-pages-${String(firstPage + 1)}-${String(lastPage + 1)}.${mediaType === 'application/pdf' ? 'pdf' : 'png'}`,
    mediaType,
    contentBase64: bytesToBase64(bytes),
  })
  if (!carried.ok) return transportFailure(carried.error.message)
  if (!carried.value.ok) return carried.value
  const mapped: OcrLayoutPage[] = []
  const returnedIndexes = new Set<number>()
  for (const page of carried.value.value.pages) {
    const pageIndex = sourcePageIndexes[page.pageIndex]
    if (pageIndex === undefined || returnedIndexes.has(page.pageIndex)) {
      return { ok: false, error: { code: 'invalid-response', message: 'OCR batch returned an unknown or duplicate page index' } }
    }
    returnedIndexes.add(page.pageIndex)
    mapped.push({ ...page, pageIndex })
  }
  if (returnedIndexes.size !== sourcePageIndexes.length) {
    return { ok: false, error: { code: 'invalid-response', message: 'OCR batch omitted a selected PDF page' } }
  }
  return {
    ok: true,
    value: { name: sourceName, provider: carried.value.value.provider, pages: mapped },
  }
}

function mergeLayoutResults(
  name: string,
  left: OcrLayoutResult,
  right: OcrLayoutResult,
): OcrLayoutResult {
  if (!left.ok) return left
  if (!right.ok) return right
  return {
    ok: true,
    value: {
      name,
      provider: left.value.provider,
      pages: [...left.value.pages, ...right.value.pages],
    },
  }
}

function validatePageIndexes(pageIndexes: readonly number[], pageCount: number): void {
  if (pageIndexes.length === 0) throw new TypeError('PDF page selection is empty')
  const seen = new Set<number>()
  for (const pageIndex of pageIndexes) {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount || seen.has(pageIndex)) {
      throw new TypeError('PDF page selection contains an invalid or duplicate page')
    }
    seen.add(pageIndex)
  }
}

function uploadBatchId(): string {
  const words = crypto.getRandomValues(new Uint32Array(4))
  return [...words].map(word => word.toString(16).padStart(8, '0')).join('')
}

function transportFailure(message: string): OcrLayoutResult {
  return { ok: false, error: { code: 'provider-failure', message } }
}

/**
 * Extract one browser document through the Host OCR runtime.
 * @param file - source browser file.
 * @param remote - generated OCR Remote namespace.
 * @param options - optional text-retention behavior for the active workflow.
 * @returns normalized extraction or a transport failure.
 */
export async function extractWorkbenchDocument(
  file: File,
  remote: TeacherWorkbenchOcrRemote,
  options: TeacherWorkbenchExtractOptions = {},
): Promise<OcrExtractResult> {
  try {
    const carried = await remote.extract({
      name: file.name,
      mediaType: file.type,
      contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(options.includeDiscardedText === true ? { includeDiscardedText: true } : {}),
      ...(options.enhanceImageDetail === true ? { enhanceImageDetail: true } : {}),
    })
    return carried.ok
      ? carried.value
      : { ok: false, error: { code: 'provider-failure', message: carried.error.message } }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'provider-failure',
        message: error instanceof Error ? error.message : 'document extraction failed',
      },
    }
  }
}

/**
 * Encode browser bytes for JSON RPC media transport.
 * @param data - Browser-held bytes to encode.
 * @returns Canonical Base64 content.
 */
export function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}
