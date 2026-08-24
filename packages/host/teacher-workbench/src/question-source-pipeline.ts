/** Agent-driven PDF layout extraction, semantic question cutting, and persistence. */

import { createCanvas } from '@napi-rs/canvas'
import type { Context } from '@deepseek-ai/cordis'
import type { OcrRuntime } from '@deepseek-ai/dsh-ocr'
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import { readWorkbenchSource } from './source-documents.ts'
import type { TeacherWorkbenchService } from './index.ts'
import type {
  TeacherQuestionBatchDestination,
  TeacherQuestionBatchId,
  TeacherQuestionImageUpload,
  TeacherQuestionLayoutElementId,
  TeacherQuestionLayoutPage,
  TeacherQuestionPagePreview,
  TeacherQuestionSegmentSuccess,
  TeacherSegmentedQuestion,
  TeacherWorkbenchSourceId,
} from './types.ts'

type MaximumQuestionWidthRatio = TeacherQuestionSegmentSuccess['value']['maxQuestionWidthRatio']

/** One complete agent-driven question-cutting request. */
export interface StagedQuestionSegmentationRequest {
  /** Durable source identity injected with the uploaded PDF. */
  readonly sourceId: TeacherWorkbenchSourceId
  /** Original PDF display name. */
  readonly sourceName: string
  /** Optional comma-separated one-based page and range selection. */
  readonly pageRange: string
  /** Teacher-facing saved batch name. */
  readonly batchName: string
  /** User-selected existing library destination. */
  readonly destination: Exclude<TeacherQuestionBatchDestination, { readonly kind: 'source-folder' }>
  /** Extra OCR page units retained around semantic boundaries. */
  readonly padding: number
}

/** Persisted result of one agent-driven PDF segmentation run. */
export interface StagedQuestionSegmentationResult {
  readonly revision: number
  readonly batchId: TeacherQuestionBatchId
  readonly questionCount: number
  readonly groupCount: number
}

/**
 * Cut one staged PDF through MinerU geometry plus the restricted boundary agent and save its images.
 * @param ctx - Host context providing OCR.
 * @param service - authoritative teacher-workbench service.
 * @param request - staged source, page selection, and output metadata.
 * @param parentSessionId - ordinary conversation that owns child segmentation runs.
 * @param signal - cancellation for the complete segmentation operation.
 * @returns saved batch identity, revision, and segmentation counts.
 */
export async function segmentStagedQuestionPdf(
  ctx: Context,
  service: TeacherWorkbenchService,
  request: StagedQuestionSegmentationRequest,
  parentSessionId: Parameters<TeacherWorkbenchService['segmentQuestions']>[0]['parentSessionId'],
  signal: AbortSignal,
): Promise<StagedQuestionSegmentationResult> {
  const ocr = ctx.get('ocr')
  if (ocr === undefined) throw new Error('MinerU OCR service is unavailable')
  throwIfAborted(signal)
  const bytes = await readWorkbenchSource(service.sourceConfig(), request.sourceId)
  const source = await PDFDocument.load(bytes)
  const selection = parsePageSelection(request.pageRange, source.getPageCount())
  const limitsResult = ocr.layoutLimits()
  if (!limitsResult.ok) throw new Error(limitsResult.error.message)
  const pages: TeacherQuestionLayoutPage[] = []
  let batchNumber = 0
  for (let offset = 0; offset < selection.indexes.length; offset += limitsResult.value.maxPagesPerRequest) {
    const indexes = selection.indexes.slice(offset, offset + limitsResult.value.maxPagesPerRequest)
    pages.push(...await extractLayoutBatch(
      ocr,
      source,
      bytes,
      request.sourceName,
      indexes,
      limitsResult.value.maxFileBytes,
      batchNumber,
      signal,
    ))
    batchNumber += 1
  }
  pages.sort((left, right) => left.pageIndex - right.pageIndex)
  const pagePreviews = await renderPagePreviews(bytes, pages.map(page => page.pageIndex), signal)
  const segmented = await service.segmentQuestions({
    parentSessionId,
    fileName: request.sourceName,
    pages,
    pagePreviews,
    padding: request.padding,
  })
  if (!segmented.ok) throw new Error(segmented.error.message)
  throwIfAborted(signal)
  let questions = [...segmented.value.questions]
  let outputWidthRatio = segmented.value.maxQuestionWidthRatio
  for (const group of segmented.value.groups) {
    let groupQuestions = questions.filter(question => question.groupIndex === group.groupIndex)
    let reviewQuestions = groupQuestions
    let recutAttempt = 0
    for (;;) {
      const crops = await renderQuestionUploads(bytes, pages, reviewQuestions, outputWidthRatio, signal)
      const localPageIndexes = recutAttempt === 0 || reviewQuestions.length === 0
        ? group.corePageIndexes
        : [...new Set(reviewQuestions.flatMap(question => (
          question.regions.map(region => region.pageIndex)
        )))]
      const previewPages = new Set(adjacentInspectionPages(pages, localPageIndexes))
      const inspectionPages = new Set(group.inspectionPageIndexes)
      const reviewed = await service.reviewQuestionCrops({
        parentSessionId,
        fileName: request.sourceName,
        groupIndex: group.groupIndex,
        corePageIndexes: group.corePageIndexes,
        recutAttempt,
        reviewQuestionIds: reviewQuestions.map(question => question.sourceHeadId),
        pages: pages.filter(page => inspectionPages.has(page.pageIndex)),
        pagePreviews: pagePreviews.filter(preview => (
          previewPages.has(preview.pageIndex) && inspectionPages.has(preview.pageIndex)
        )),
        questions: groupQuestions,
        crops,
        padding: request.padding,
      })
      if (!reviewed.ok) throw new Error(reviewed.error.message)
      if (reviewed.value.decision === 'accepted') break
      if (reviewed.value.decision === 'revised') {
        questions = replaceQuestionGroup(
          questions,
          group.groupIndex,
          reviewed.value.questions,
          segmented.value.groupCount,
        )
        groupQuestions = questions.filter(question => question.groupIndex === group.groupIndex)
        outputWidthRatio = maximumQuestionWidthRatio(questions)
      }
      recutAttempt += 1
      if (recutAttempt >= segmented.value.maxRecutAttempts) break
      reviewQuestions = affectedQuestions(groupQuestions, reviewed.value.affectedQuestionIds)
      if (reviewQuestions.length === 0) break
    }
  }
  const uploads = await renderQuestionUploads(
    bytes,
    pages,
    questions,
    outputWidthRatio,
    signal,
  )
  if (uploads.length === 0) throw new Error('question segmentation returned no images')
  const parts = partitionUploads(uploads, segmented.value.maxSaveBatchBytes)
  let batchId: TeacherQuestionBatchId | undefined
  let revision = (await service.read({})).value.revision
  for (const images of parts) {
    const saved = await service.saveQuestionBatch({
      ...(batchId === undefined ? {} : { appendToBatchId: batchId }),
      destination: request.destination,
      name: request.batchName,
      sourceName: request.sourceName,
      pageRange: selection.label,
      images,
    })
    if (!saved.ok) throw new Error(saved.error.message)
    batchId = saved.value.batchId ?? batchId
    revision = saved.value.document.revision
  }
  if (batchId === undefined) throw new Error('question batch was not created')
  return {
    revision,
    batchId,
    questionCount: uploads.length,
    groupCount: segmented.value.groupCount,
  }
}

type OcrService = OcrRuntime

async function extractLayoutBatch(
  ocr: OcrService,
  source: PDFDocument,
  sourceBytes: Uint8Array,
  sourceName: string,
  indexes: readonly number[],
  maxBytes: number,
  batchNumber: number,
  signal: AbortSignal,
): Promise<TeacherQuestionLayoutPage[]> {
  throwIfAborted(signal)
  const batch = await PDFDocument.create()
  const copied = await batch.copyPages(source, [...indexes])
  for (const page of copied) batch.addPage(page)
  const bytes = await batch.save({ useObjectStreams: true })
  if (bytes.byteLength > maxBytes && indexes.length > 1) {
    const middle = Math.ceil(indexes.length / 2)
    return [
      ...await extractLayoutBatch(ocr, source, sourceBytes, sourceName, indexes.slice(0, middle), maxBytes, batchNumber * 2, signal),
      ...await extractLayoutBatch(ocr, source, sourceBytes, sourceName, indexes.slice(middle), maxBytes, batchNumber * 2 + 1, signal),
    ]
  }
  let uploadBytes = bytes
  let mediaType = 'application/pdf'
  if (bytes.byteLength > maxBytes) {
    const [pageIndex] = indexes
    if (pageIndex === undefined) throw new Error('PDF batch is empty')
    uploadBytes = await renderSinglePage(sourceBytes, pageIndex, 2)
    mediaType = 'image/png'
    if (uploadBytes.byteLength > maxBytes) throw new Error(`PDF page ${String(pageIndex + 1)} exceeds the MinerU upload limit`)
  }
  const extracted = await ocr.layout({
    name: `${sourceName.replace(/\.pdf$/iu, '')}-part-${String(batchNumber + 1)}.${mediaType === 'application/pdf' ? 'pdf' : 'png'}`,
    mediaType,
    contentBase64: Buffer.from(uploadBytes).toString('base64'),
  })
  throwIfAborted(signal)
  if (!extracted.ok) throw new Error(extracted.error.message)
  if (extracted.value.pages.length !== indexes.length) throw new Error('MinerU omitted one or more selected PDF pages')
  return extracted.value.pages.map((page, index) => {
    const pageIndex = indexes[index]
    if (pageIndex === undefined) throw new Error('MinerU returned an unknown PDF page')
    return { ...page, pageIndex }
  })
}

async function renderPagePreviews(
  bytes: Uint8Array,
  pageIndexes: readonly number[],
  signal: AbortSignal,
): Promise<TeacherQuestionPagePreview[]> {
  const previews: TeacherQuestionPagePreview[] = []
  for (const pageIndex of pageIndexes) {
    throwIfAborted(signal)
    const content = await renderSinglePage(bytes, pageIndex, 2)
    const metadata = await sharp(content).metadata()
    previews.push({
      pageIndex,
      mediaType: 'image/png',
      width: metadata.width,
      height: metadata.height,
      contentBase64: Buffer.from(content).toString('base64'),
    })
  }
  return previews
}

function maximumQuestionWidthRatio(questions: readonly TeacherSegmentedQuestion[]): number {
  const regions = questions.flatMap(question => question.regions)
  return regions.length === 0
    ? 1
    : Math.max(...regions.map(region => (region.right - region.left) / region.pageWidth))
}

function adjacentInspectionPages(
  pages: readonly TeacherQuestionLayoutPage[],
  corePageIndexes: readonly number[],
): readonly number[] {
  const core = new Set(corePageIndexes)
  const positions = pages.flatMap((page, index) => core.has(page.pageIndex) ? [index] : [])
  const first = Math.min(...positions)
  const last = Math.max(...positions)
  if (!Number.isFinite(first) || !Number.isFinite(last)) throw new Error('question group has no source layout page')
  return pages
    .slice(Math.max(0, first - 1), Math.min(pages.length, last + 2))
    .map(page => page.pageIndex)
}

function replaceQuestionGroup(
  current: readonly TeacherSegmentedQuestion[],
  groupIndex: number,
  replacement: readonly TeacherSegmentedQuestion[],
  groupCount: number,
): TeacherSegmentedQuestion[] {
  if (replacement.some(question => question.groupIndex !== groupIndex)) {
    throw new Error('reviewed question group identity is inconsistent')
  }
  const merged: TeacherSegmentedQuestion[] = []
  for (let index = 0; index < groupCount; index += 1) {
    merged.push(...(index === groupIndex
      ? replacement
      : current.filter(question => question.groupIndex === index)))
  }
  return merged.map((question, index) => ({ ...question, questionNo: index + 1 }))
}

function affectedQuestions(
  after: readonly TeacherSegmentedQuestion[],
  affected: readonly TeacherQuestionLayoutElementId[],
): TeacherSegmentedQuestion[] {
  const ids = new Set<TeacherQuestionLayoutElementId>(affected)
  return after.filter(question => ids.has(question.sourceHeadId))
}

async function renderQuestionUploads(
  bytes: Uint8Array,
  pages: readonly TeacherQuestionLayoutPage[],
  questions: readonly TeacherSegmentedQuestion[],
  maxQuestionWidthRatio: MaximumQuestionWidthRatio,
  signal: AbortSignal,
): Promise<TeacherQuestionImageUpload[]> {
  const pageLayouts = new Map(pages.map(page => [page.pageIndex, page] as const))
  const rendered = new Map<number, { png: Uint8Array; width: number; height: number }>()
  const loading = pdfjs.getDocument({ data: bytes.slice() })
  const pdf = await loading.promise
  try {
    for (const pageIndex of new Set(questions.flatMap(question => question.regions.map(region => region.pageIndex)))) {
      throwIfAborted(signal)
      const page = await pdf.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale: 2 })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise
      rendered.set(pageIndex, { png: new Uint8Array(await canvas.encode('png')), width, height })
    }
    const uploads: TeacherQuestionImageUpload[] = []
    for (const question of questions) {
      throwIfAborted(signal)
      const slices: Array<{
        bytes: Uint8Array
        width: number
        targetWidth: number
        height: number
      }> = []
      for (const region of question.regions) {
        const page = rendered.get(region.pageIndex)
        const layout = pageLayouts.get(region.pageIndex)
        if (page === undefined || layout === undefined) throw new Error('rendered PDF page is missing')
        const top = Math.max(0, Math.floor(region.top * page.height / layout.height))
        const bottom = Math.min(page.height, Math.ceil(region.bottom * page.height / layout.height))
        const left = Math.max(0, Math.min(page.width - 1, Math.floor(region.left / region.pageWidth * page.width)))
        const targetWidth = Math.max(1, Math.ceil(maxQuestionWidthRatio * page.width))
        const rightLimit = Math.max(
          left + 1,
          Math.min(page.width, Math.ceil(region.rightLimit / region.pageWidth * page.width)),
        )
        const right = Math.min(rightLimit, left + targetWidth)
        const width = Math.max(1, right - left)
        const height = Math.max(1, bottom - top)
        const excludedAreas = region.excludedAreas.flatMap((area) => {
          const areaLeft = Math.max(0, Math.floor(area[0] / region.pageWidth * page.width) - left)
          const areaTop = Math.max(0, Math.floor(area[1] / region.pageHeight * page.height) - top)
          const areaRight = Math.min(width, Math.ceil(area[2] / region.pageWidth * page.width) - left)
          const areaBottom = Math.min(height, Math.ceil(area[3] / region.pageHeight * page.height) - top)
          return areaRight > areaLeft && areaBottom > areaTop
            ? [{ left: areaLeft, top: areaTop, width: areaRight - areaLeft, height: areaBottom - areaTop }]
            : []
        })
        const sourceCrop = await sharp(page.png)
          .extract({ left, top, width, height })
          .png()
          .toBuffer()
        const cropped = await sharp(sourceCrop)
          .composite(excludedAreas.map(area => ({
            input: { create: { width: area.width, height: area.height, channels: 4, background: '#ffffff' } },
            left: area.left,
            top: area.top,
          })))
          .png()
          .toBuffer()
        slices.push({
          bytes: new Uint8Array(cropped),
          width,
          targetWidth,
          height,
        })
      }
      const gap = slices.length > 1 ? 12 : 0
      const width = Math.max(...slices.map(slice => slice.targetWidth))
      const height = slices.reduce((sum, slice) => sum + slice.height, 0) + gap * Math.max(0, slices.length - 1)
      let top = 0
      const composite = slices.map((slice) => {
        const input = {
          input: Buffer.from(slice.bytes),
          left: 0,
          top,
        }
        top += slice.height + gap
        return input
      })
      const output = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
        .composite(composite)
        .png()
        .toBuffer()
      uploads.push({
        questionNo: question.questionNo,
        fileName: `第${String(question.questionNo)}题.png`,
        mediaType: 'image/png',
        width,
        height,
        contentBase64: output.toString('base64'),
      })
    }
    return uploads
  } finally {
    await loading.destroy()
  }
}

async function renderSinglePage(bytes: Uint8Array, pageIndex: number, scale: number): Promise<Uint8Array> {
  const loading = pdfjs.getDocument({ data: bytes.slice() })
  const pdf = await loading.promise
  try {
    const page = await pdf.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise
    return new Uint8Array(await canvas.encode('png'))
  } finally {
    await loading.destroy()
  }
}

function partitionUploads(images: readonly TeacherQuestionImageUpload[], maxBytes: number): TeacherQuestionImageUpload[][] {
  const parts: TeacherQuestionImageUpload[][] = []
  let current: TeacherQuestionImageUpload[] = []
  let bytes = 0
  for (const image of images) {
    const size = Buffer.byteLength(image.contentBase64, 'base64')
    if (size > maxBytes) throw new Error(`question ${String(image.questionNo)} exceeds the saved-image limit`)
    if (current.length > 0 && bytes + size > maxBytes) {
      parts.push(current)
      current = []
      bytes = 0
    }
    current.push(image)
    bytes += size
  }
  if (current.length > 0) parts.push(current)
  return parts
}

function parsePageSelection(input: string, pageCount: number): { indexes: number[]; label: string } {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('PDF has no pages')
  const label = input.trim().replaceAll('，', ',')
  if (label === '') return { indexes: Array.from({ length: pageCount }, (_value, index) => index), label: '' }
  const selected = new Set<number>()
  for (const raw of label.split(',')) {
    const part = raw.trim()
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/u.exec(part)
    if (match?.[1] === undefined) throw new Error(`invalid page range: ${part}`)
    const start = Number(match[1])
    const end = Number(match[2] ?? match[1])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > pageCount) {
      throw new Error(`page range must be between 1 and ${String(pageCount)}`)
    }
    for (let page = start; page <= end; page += 1) selected.add(page - 1)
  }
  return { indexes: [...selected].sort((left, right) => left - right), label }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('question segmentation was cancelled')
}
