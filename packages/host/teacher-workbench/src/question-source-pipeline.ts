/** Agent-driven PDF layout extraction, semantic question cutting, and persistence. */

import { createCanvas } from '@napi-rs/canvas'
import type { Context } from '@deepseek-ai/cordis'
import { mapConcurrently } from '@deepseek-ai/dsh-concurrency'
import type { OcrRuntime } from '@deepseek-ai/dsh-ocr'
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import { detectDocumentAnswerSectionPageIndexes } from './question-segmentation-agent.ts'
import { readWorkbenchSource } from './source-documents.ts'
import type { TeacherWorkbenchService } from './index.ts'
import type {
  TeacherQuestionBatchDestination,
  TeacherQuestionBatchId,
  TeacherQuestionCropReviewResult,
  TeacherQuestionImageUpload,
  TeacherQuestionLayoutElementId,
  TeacherQuestionLayoutPage,
  TeacherQuestionPagePreview,
  TeacherQuestionSegmentSuccess,
  TeacherSegmentedQuestion,
  TeacherWorkbenchSourceId,
} from './types.ts'

type MaximumQuestionWidthRatio = TeacherQuestionSegmentSuccess['value']['maxQuestionWidthRatio']
type QuestionSegmentationGroup = TeacherQuestionSegmentSuccess['value']['groups'][number]

interface ReviewedQuestionGroup {
  readonly group: QuestionSegmentationGroup
  readonly questions: readonly TeacherSegmentedQuestion[]
  readonly unverified: boolean
}

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
  /** Saved batch when at least one usable question image was produced. */
  readonly batchId?: TeacherQuestionBatchId
  readonly questionCount: number
  readonly groupCount: number
  /** Number of processing groups saved without a final accepted crop review. */
  readonly unverifiedGroupCount: number
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
  const inspectionIndexes = adjacentSourcePageIndexes(selection.indexes, source.getPageCount())
  const limitsResult = ocr.layoutLimits()
  if (!limitsResult.ok) throw new Error(limitsResult.error.message)
  const pages: TeacherQuestionLayoutPage[] = []
  let batchNumber = 0
  for (let offset = 0; offset < inspectionIndexes.length; offset += limitsResult.value.maxPagesPerRequest) {
    const indexes = inspectionIndexes.slice(offset, offset + limitsResult.value.maxPagesPerRequest)
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
  const answerSectionPageIndexes = detectDocumentAnswerSectionPageIndexes(pages)
  const pagePreviews = await renderPagePreviews(bytes, pages.map(page => page.pageIndex), signal)
  const segmented = await service.segmentQuestions({
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    fileName: request.sourceName,
    pages,
    corePageIndexes: selection.indexes,
    pagePreviews,
    padding: request.padding,
  })
  if (!segmented.ok) throw new Error(segmented.error.message)
  throwIfAborted(signal)
  let questions = [...segmented.value.questions]
  // Crop-local review cannot replace the PDF-wide outlier-filtered width.
  const outputWidthRatio = segmented.value.maxQuestionWidthRatio
  const renderedUploads = new Map<TeacherQuestionLayoutElementId, TeacherQuestionImageUpload>()
  const rememberUploads = (
    renderedQuestions: readonly TeacherSegmentedQuestion[],
    uploads: readonly TeacherQuestionImageUpload[],
  ): void => {
    if (renderedQuestions.length !== uploads.length) throw new Error('rendered question count is inconsistent')
    renderedQuestions.forEach((question, index) => {
      const upload = uploads[index]
      if (upload === undefined) throw new Error('rendered question image is missing')
      renderedUploads.set(question.sourceHeadId, upload)
    })
  }
  const reviewedGroups = await mapConcurrently(
    segmented.value.groups,
    segmented.value.maxConcurrentGroups,
    async (group): Promise<ReviewedQuestionGroup> => {
      let groupQuestions = questions.filter(question => question.groupIndex === group.groupIndex)
      let reviewQuestions = groupQuestions
      let recutAttempt = 0
      let unverified = false
      for (;;) {
        let reviewed: TeacherQuestionCropReviewResult
        try {
          const crops = await renderQuestionUploads(bytes, pages, reviewQuestions, outputWidthRatio, signal)
          rememberUploads(reviewQuestions, crops)
          const localPageIndexes = recutAttempt === 0 || reviewQuestions.length === 0
            ? group.corePageIndexes
            : [...new Set(reviewQuestions.flatMap(question => (
              question.regions.map(region => region.pageIndex)
            )))]
          const previewPages = new Set(adjacentInspectionPages(pages, localPageIndexes))
          const inspectionPages = new Set(group.inspectionPageIndexes)
          reviewed = await service.reviewQuestionCrops({
            ...(parentSessionId === undefined ? {} : { parentSessionId }),
            fileName: request.sourceName,
            groupIndex: group.groupIndex,
            corePageIndexes: group.corePageIndexes,
            answerSectionPageIndexes: answerSectionPageIndexes.filter(pageIndex => (
              group.corePageIndexes.includes(pageIndex)
            )),
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
        } catch (error) {
          if (signal.aborted) throw error
          unverified = true
          break
        }
        if (!reviewed.ok) {
          unverified = true
          break
        }
        if (reviewed.value.decision === 'accepted') {
          break
        }
        if (reviewed.value.decision === 'unresolved') {
          unverified = true
          break
        }
        if (reviewed.value.questions.some(question => question.groupIndex !== group.groupIndex)) {
          unverified = true
          break
        }
        if (recutAttempt >= segmented.value.maxRecutAttempts) {
          unverified = true
          break
        }
        groupQuestions = [...reviewed.value.questions]
        for (const questionId of reviewed.value.affectedQuestionIds) renderedUploads.delete(questionId)
        recutAttempt += 1
        reviewQuestions = affectedQuestions(groupQuestions, reviewed.value.affectedQuestionIds)
        if (reviewQuestions.length === 0) {
          // A validated removal-only repair leaves no changed pixels to review.
          break
        }
      }
      return { group, questions: groupQuestions, unverified }
    },
  )
  for (const reviewed of reviewedGroups) {
    questions = replaceQuestionGroup(
      questions,
      reviewed.group.groupIndex,
      reviewed.questions,
      segmented.value.groupCount,
    )
  }
  const missingRenderedQuestions = questions.filter(question => !renderedUploads.has(question.sourceHeadId))
  rememberUploads(missingRenderedQuestions, await renderQuestionUploads(
    bytes,
    pages,
    missingRenderedQuestions,
    outputWidthRatio,
    signal,
  ))
  const uploads = questions.map((question) => {
    const upload = renderedUploads.get(question.sourceHeadId)
    if (upload === undefined) throw new Error('reviewed question image is missing')
    return {
      ...upload,
      questionNo: question.questionNo,
      fileName: `第${String(question.questionNo)}题.png`,
    }
  })
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
  if (uploads.length > 0 && batchId === undefined) throw new Error('question batch was not created')
  return {
    revision,
    ...(batchId === undefined ? {} : { batchId }),
    questionCount: uploads.length,
    groupCount: segmented.value.groupCount,
    unverifiedGroupCount: reviewedGroups.filter(group => group.unverified).length,
  }
}

function adjacentSourcePageIndexes(
  selectedPageIndexes: readonly number[],
  pageCount: number,
): readonly number[] {
  const indexes = new Set(selectedPageIndexes)
  for (const pageIndex of selectedPageIndexes) {
    if (pageIndex > 0) indexes.add(pageIndex - 1)
    if (pageIndex + 1 < pageCount) indexes.add(pageIndex + 1)
  }
  return [...indexes].sort((left, right) => left - right)
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
  if (!extracted.ok) {
    if (indexes.length > 1) {
      const middle = Math.ceil(indexes.length / 2)
      return [
        ...await extractLayoutBatch(ocr, source, sourceBytes, sourceName, indexes.slice(0, middle), maxBytes, batchNumber * 2, signal),
        ...await extractLayoutBatch(ocr, source, sourceBytes, sourceName, indexes.slice(middle), maxBytes, batchNumber * 2 + 1, signal),
      ]
    }
    throw new Error(extracted.error.message)
  }
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
  if (questions.length === 0) return []
  const pageLayouts = new Map(pages.map(page => [page.pageIndex, page] as const))
  const rendered = new Map<number, { png: Uint8Array; width: number; height: number }>()
  const loading = pdfjs.getDocument({ data: bytes.slice() })
  const pdf = await loading.promise
  try {
    const requiredPageIndexes = new Set(questions.flatMap(question => question.regions.map(region => region.pageIndex)))
    let targetWidth = 1
    for (const pageLayout of pages) {
      throwIfAborted(signal)
      const page = await pdf.getPage(pageLayout.pageIndex + 1)
      const viewport = page.getViewport({ scale: 2 })
      const width = Math.max(1, Math.ceil(viewport.width))
      targetWidth = Math.max(targetWidth, Math.ceil(maxQuestionWidthRatio * width))
      if (!requiredPageIndexes.has(pageLayout.pageIndex)) continue
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
      rendered.set(pageLayout.pageIndex, { png: new Uint8Array(await canvas.encode('png')), width, height })
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
      const width = targetWidth
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
