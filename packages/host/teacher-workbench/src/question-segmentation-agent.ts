/** Agent-loop question-boundary detection over provider-neutral OCR geometry. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subagent'
import { defineTool, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { QUESTION_CROP_REVIEW_SKILL, QUESTION_SEGMENTATION_SKILL } from './question-segmentation-skill.ts'
import type {
  TeacherQuestionLayoutElement,
  TeacherQuestionLayoutElementId,
  TeacherQuestionLayoutPage,
  TeacherQuestionCropReviewRequest,
  TeacherQuestionCropReviewResult,
  TeacherQuestionImageUpload,
  TeacherQuestionPageRegion,
  TeacherQuestionPagePreview,
  TeacherQuestionSegmentErrorCode,
  TeacherQuestionSegmentRejected,
  TeacherQuestionSegmentRequest,
  TeacherSegmentedQuestion,
} from './types.ts'

/** Deployment tunables for one semantic question-segmentation run. */
export interface TeacherQuestionSegmentationAgentConfig {
  /** Maximum selected pages admitted to one run. */
  maxQuestionLayoutPages: number
  /** Maximum OCR elements admitted to one run. */
  maxQuestionLayoutElements: number
  /** Maximum serialized OCR characters returned by one source-tool call. */
  maxQuestionSourceChunkCharacters: number
  /** Maximum questions accepted from one run. */
  maxSegmentedQuestions: number
  /** Maximum complete boundary drafts admitted to one run. */
  maxQuestionBoundarySubmissions: number
  /** Maximum fresh child runs used to obtain one accepted result in each boundary or crop-review stage. */
  maxQuestionBoundaryAgentRuns: number
  /** Maximum page-height gap between automatically owned elements before explicit attachment is required. */
  maxQuestionAutoOwnedGapRatio: number
  /** Maximum page or crop images returned by one image-tool call. */
  maxQuestionVisionImagesPerToolCall: number
  /** Wall-clock deadline for one segmentation child. */
  questionSegmentationAgentTimeoutMs: number
}

/** Result of one bounded semantic child before page-group metadata is attached. */
export type TeacherQuestionSegmentationAgentResult = TeacherQuestionSegmentRejected | {
  /** Success discriminant. */
  readonly ok: true
  /** Questions validated within this bounded source window. */
  readonly value: { readonly questions: readonly TeacherSegmentedQuestion[] }
}

interface IndexedElement {
  readonly id: TeacherQuestionLayoutElementId
  readonly ordinal: number
  readonly page: TeacherQuestionLayoutPage
  readonly element: TeacherQuestionLayoutElement
}

interface BoundaryDraft {
  readonly headConvention: string
  readonly questions: readonly {
    readonly headElementId: string
    readonly stopBeforeElementId?: string
    readonly additionalElementIds?: readonly string[]
    readonly verticalRegionEdits?: readonly VerticalRegionEdit[]
  }[]
  readonly nonQuestionHeadElementIds?: readonly string[]
  readonly retainedImageElementIds?: readonly string[]
  readonly excludedElementIds?: readonly string[]
  readonly stopBeforeElementId?: string
}

interface VerticalRegionEdit {
  readonly pageIndex: number
  readonly top?: number
  readonly bottom?: number
}

interface AcceptedBoundaryDraft {
  readonly token: string
  readonly questions: readonly TeacherSegmentedQuestion[]
}

interface AcceptedCropReview {
  readonly token: string
  readonly decision: 'accepted' | 'revised' | 'unresolved'
  readonly affectedQuestionIds: readonly TeacherQuestionLayoutElementId[]
  readonly questions: readonly TeacherSegmentedQuestion[]
}

interface CropReviewFinding {
  readonly cropId?: string
  readonly pageId?: string
  readonly issue: string
  readonly evidence: string
}

interface CropReviewVerification {
  readonly answerDemand: string
  readonly evidence: string
}

interface CropReviewState {
  findings?: readonly CropReviewFinding[]
  findingSubmissions: number
  revisionSubmissions: number
  readonly draftFindings: Map<string, CropReviewFinding>
  readonly draftVerifications: Map<string, CropReviewVerification>
  readonly seenRevisionDrafts: Set<string>
}

function recordedCropReviewFindings(state: CropReviewState): readonly CropReviewFinding[] {
  return state.findings ?? []
}

interface BoundarySubmissionState {
  submissions: number
  readonly seenDrafts: Set<string>
}

interface BoundaryValidation {
  readonly errors: readonly string[]
  readonly referenceErrors: readonly string[]
  readonly questions?: readonly TeacherSegmentedQuestion[]
}

interface SelectedQuestion {
  readonly head: IndexedElement
  readonly end?: IndexedElement
  readonly additional: readonly IndexedElement[]
  readonly verticalRegionEdits: readonly VerticalRegionEdit[]
}

interface VisionImageSource {
  readonly id: string
  readonly label: string
  readonly mediaType: ImageMediaType
  readonly contentBase64: string
}

interface VisionImageValue {
  readonly images: readonly {
    readonly id: string
    readonly label: string
    readonly attachmentId: string
    readonly mediaType: ImageMediaType
    readonly bytes: number
    readonly width: number
    readonly height: number
    readonly name?: string
    readonly originalDimensions?: { readonly width: number; readonly height: number }
  }[]
}

class QuestionSegmentationVisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuestionSegmentationVisionError'
  }
}

const structuredOutputSchema = z.object({ validationToken: z.string().min(1).max(128) }).strict()
const answerHeadingPattern = /^\s*(?:.{0,80}(?:试卷|作业|练习)\s*)?(?:参考)?答案(?:与解析|及解析|及评分标准|与评分标准)?\s*[:：]?\s*$/u
const answerOrExplanationBlockPattern = new RegExp([
  '^\\s*(?:',
  '[\\[【(（]\\s*(?:参考)?(?:答案|解析|解答|点评)(?:与解析|及解析)?\\s*[\\]】)）]',
  '|(?:参考)?(?:答案|解析|点评)\\s*[:：])\\s*(?:\\S|$)',
].join(''), 'u')
const sectionHeadingPattern = new RegExp([
  '^\\s*(?:',
  '[一二三四五六七八九十]+\\s*[、.．]\\s*(?:(?:单项|多项)?选择|填空|解答|计算|证明|判断|作图|应用)',
  '|[0-9０-９]+(?:\\s*[.．]\\s*[0-9０-９]+){2,}\\s*\\S',
  '|(?:part|section)\\s+[A-Z0-9]+',
  ')',
].join(''), 'iu')
const questionNumberPattern = '[0-9０-９一二三四五六七八九十百]+'
const taggedQuestionHeadPattern = new RegExp(
  `^\\s*(?:[\\[【「『(（]\\s*题\\s*${questionNumberPattern}|题\\s*${questionNumberPattern}(?=\\s*(?:[\\]】」』)）]|[（(:：]|$))|第\\s*${questionNumberPattern}\\s*题(?=\\s*(?:[（(:：、.．]|$))|(?:例题?|示例)\\s*${questionNumberPattern})`,
  'u',
)
const numberedQuestionHeadPattern = /^\s*(?:[0-9０-９]\s*)+[.．、](?!\s*[0-9０-９]\s*[.．])\s*\S/u
const bracketedReferenceLabelPattern = /^\s*[\[【「『]\s*(?:题|例题|引例|变式)[^\]】」』]{0,40}[\]】」』]\s*(.*)$/u
const parenthesizedReferencePattern = /^(?:[（(][^()（）]*[）)]\s*)+$/u
const bibliographicReferencePattern = /(?:[12][0-9]{3}|[１２][０-９]{3}|人教|课标|高考|联考|模拟|教材|教辅|版本|版|页|习题|练习|例题|题变式|P\s*[0-9０-９]+)/iu

function isSemanticBoundaryElement(element: IndexedElement): boolean {
  return (element.element.type === 'text' || element.element.type === 'equation')
    && (sectionHeadingPattern.test(element.element.text)
      || answerHeadingPattern.test(element.element.text)
      || answerOrExplanationBlockPattern.test(element.element.text))
}

function isCitationOnlyQuestionHead(element: IndexedElement): boolean {
  if (element.element.type !== 'text' && element.element.type !== 'equation') return false
  const match = bracketedReferenceLabelPattern.exec(element.element.text)
  if (match === null) return false
  const suffix = match[1]?.trim() ?? ''
  return suffix === ''
    || (parenthesizedReferencePattern.test(suffix) && bibliographicReferencePattern.test(suffix))
}

function possibleQuestionHeadIds(elements: readonly IndexedElement[]): readonly TeacherQuestionLayoutElementId[] {
  const firstAnswerHint = elements.find(element => (
    (element.element.type === 'text' || element.element.type === 'equation')
      && answerHeadingPattern.test(element.element.text)
  ))
  return elements
    .filter(element => element.ordinal < (firstAnswerHint?.ordinal ?? elements.length)
      && (numberedQuestionHeadPattern.test(element.element.text)
        || taggedQuestionHeadPattern.test(element.element.text)))
    .map(element => element.id)
}

/**
 * Count fallible question-head candidates for semantic page-group sizing.
 * @param page - One OCR page whose candidate density contributes to a batch limit.
 * @returns candidate count before any semantic classification by the child agent.
 */
export function countQuestionHeadCandidates(page: TeacherQuestionLayoutPage): number {
  return page.elements.filter(element => (
    (element.type === 'text' || element.type === 'equation')
      && (numberedQuestionHeadPattern.test(element.text) || taggedQuestionHeadPattern.test(element.text))
  )).length
}

function imageElementIds(elements: readonly IndexedElement[]): readonly string[] {
  return elements.flatMap(element => element.element.type === 'image' ? [element.id as string] : [])
}

/** Structured-output schema requiring a server-issued accepted-draft token. */
export const questionSegmentationOutputSchema: ObjectJsonSchema = {
  type: 'object',
  properties: {
    validationToken: {
      type: 'string',
      description: 'Opaque token returned by the boundary tool after Host validation.',
    },
  },
  required: ['validationToken'],
  additionalProperties: false,
}

function rejected(code: TeacherQuestionSegmentErrorCode, message: string): TeacherQuestionSegmentRejected {
  return { ok: false, error: { code, message } }
}

function validBox(
  bbox: readonly number[],
  page: Pick<TeacherQuestionLayoutPage, 'width' | 'height'>,
): bbox is readonly [number, number, number, number] {
  if (bbox.length !== 4 || !bbox.every(Number.isFinite)) return false
  const [left, top, right, bottom] = bbox as readonly [number, number, number, number]
  return left >= 0
    && top >= 0
    && right > left
    && bottom > top
    && right <= page.width
    && bottom <= page.height
}

function validateRequest(
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
): string | undefined {
  if (request.fileName.trim() === '') return 'fileName must not be empty'
  if (!Number.isFinite(request.padding) || request.padding < 0) return 'padding must be a non-negative finite number'
  if (!Number.isFinite(config.maxQuestionAutoOwnedGapRatio)
    || config.maxQuestionAutoOwnedGapRatio <= 0
    || config.maxQuestionAutoOwnedGapRatio > 1) {
    return 'maxQuestionAutoOwnedGapRatio must be greater than zero and at most one'
  }
  if (request.pages.length === 0) return 'at least one selected page is required'
  if (request.pages.length > config.maxQuestionLayoutPages) {
    return `selected layout exceeds ${String(config.maxQuestionLayoutPages)} pages`
  }
  let previousPage = -1
  let elements = 0
  for (const page of request.pages) {
    if (!Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0 || page.pageIndex <= previousPage) {
      return 'page indexes must be unique non-negative integers in source order'
    }
    if (!Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0) {
      return `page ${String(page.pageIndex + 1)} has invalid dimensions`
    }
    for (const element of page.elements) {
      if (!['text', 'equation', 'image', 'table', 'other'].includes(element.type)) {
        return `page ${String(page.pageIndex + 1)} contains an unsupported element type`
      }
      if (!validBox(element.bbox, page)) {
        return `page ${String(page.pageIndex + 1)} contains an invalid element box`
      }
    }
    elements += page.elements.length
    previousPage = page.pageIndex
  }
  if (elements === 0) return 'selected pages contain no OCR elements'
  if (elements > config.maxQuestionLayoutElements) {
    return `selected layout exceeds ${String(config.maxQuestionLayoutElements)} OCR elements`
  }
  const previews = request.pagePreviews
  if (previews === undefined) return undefined
  const expectedPages = new Set(request.pages.map(page => page.pageIndex))
  const previewPages = new Set<number>()
  for (const preview of previews) {
    if (!expectedPages.has(preview.pageIndex) || previewPages.has(preview.pageIndex)) {
      return 'page previews contain an unknown or duplicate page index'
    }
    if (!Number.isSafeInteger(preview.width) || preview.width < 1
      || !Number.isSafeInteger(preview.height) || preview.height < 1) {
      return `page ${String(preview.pageIndex + 1)} preview has invalid dimensions`
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(preview.mediaType)) {
      return `page ${String(preview.pageIndex + 1)} preview has an unsupported media type`
    }
    if (decodeCanonicalBase64(preview.contentBase64) === undefined) {
      return `page ${String(preview.pageIndex + 1)} preview is not canonical base64`
    }
    previewPages.add(preview.pageIndex)
  }
  return previewPages.size === expectedPages.size
    ? undefined
    : 'page previews must include every selected layout page exactly once'
}

function indexElements(pages: readonly TeacherQuestionLayoutPage[]): IndexedElement[] {
  let ordinal = 0
  return pages.flatMap((page, pageOffset) => page.elements.map((element, elementOffset) => ({
    id: `p${String(pageOffset)}e${String(elementOffset)}` as TeacherQuestionLayoutElementId,
    ordinal: ordinal++,
    page,
    element,
  })))
}

function sourceRecord(item: IndexedElement) {
  return {
    elementId: item.id,
    pageIndex: item.page.pageIndex,
    pageWidth: item.page.width,
    pageHeight: item.page.height,
    type: item.element.type,
    bbox: item.element.bbox,
    text: item.element.text,
  }
}

function sourceChunks(elements: readonly IndexedElement[], maxCharacters: number): readonly (readonly IndexedElement[])[] {
  const chunks: IndexedElement[][] = []
  let current: IndexedElement[] = []
  let characters = 2
  for (const element of elements) {
    const length = JSON.stringify(sourceRecord(element)).length + (current.length === 0 ? 0 : 1)
    if (current.length > 0 && characters + length > maxCharacters) {
      chunks.push(current)
      current = []
      characters = 2
    }
    current.push(element)
    characters += length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function sourceTool(
  name: string,
  chunks: readonly (readonly IndexedElement[])[],
  inspected: Set<number>,
  unavailable?: () => string | undefined,
) {
  return defineTool({
    name,
    description: 'Inspect one bounded chunk of the selected OCR elements. Call every numbered chunk exactly once and copy opaque element IDs exactly.',
    parameters: { chunk: { type: 'integer', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      const unavailableReason = unavailable?.()
      if (unavailableReason !== undefined) return Promise.resolve(`REJECTED\n${unavailableReason}`)
      const elements = chunks[args.chunk]
      if (elements === undefined) return Promise.resolve(`REJECTED\nchunk must be from 0 through ${String(chunks.length - 1)}`)
      if (inspected.has(args.chunk)) return Promise.resolve('REJECTED\nthis source chunk was already inspected')
      inspected.add(args.chunk)
      return Promise.resolve(JSON.stringify({
        chunk: args.chunk,
        totalChunks: chunks.length,
        elements: elements.map(sourceRecord),
      }))
    },
  })
}

function decodeCanonicalBase64(value: string): Uint8Array | undefined {
  if (value.length === 0 || value.length % 4 !== 0) return undefined
  const bytes = Buffer.from(value, 'base64')
  return bytes.byteLength > 0 && bytes.toString('base64') === value ? bytes : undefined
}

function pagePreviewSources(previews: readonly TeacherQuestionPagePreview[]): readonly VisionImageSource[] {
  return previews.map(preview => ({
    id: `page-${String(preview.pageIndex + 1)}`,
    label: `source PDF page ${String(preview.pageIndex + 1)}`,
    mediaType: preview.mediaType,
    contentBase64: preview.contentBase64,
  }))
}

function cropPreviewSources(
  crops: readonly TeacherQuestionImageUpload[],
  questions: readonly TeacherSegmentedQuestion[],
  elements: readonly IndexedElement[],
): readonly VisionImageSource[] {
  const questionByNumber = new Map(questions.map(question => [question.questionNo, question] as const))
  const headById = new Map(elements.map(element => [element.id as string, element] as const))
  return crops.map((crop) => {
    const question = questionByNumber.get(crop.questionNo)
    if (question === undefined) throw new Error(`crop ${String(crop.questionNo)} has no question boundary`)
    const headText = headById.get(question.sourceHeadId)?.element.text.trim().slice(0, 160) ?? ''
    return {
      id: `crop-${String(question.sourceHeadId)}`,
      label: `crop for head ${String(question.sourceHeadId)} (${String(crop.width)}x${String(crop.height)} pixels); OCR head text: ${JSON.stringify(headText)}`,
      mediaType: crop.mediaType,
      contentBase64: crop.contentBase64,
    }
  })
}

function visionImageContent(value: VisionImageValue): Array<
  { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
> {
  return value.images.flatMap(image => [
    { type: 'text' as const, text: `${image.id}: ${image.label}` },
    {
      type: 'image' as const,
      attachment: {
        attachmentId: AttachmentId(image.attachmentId),
        mediaType: image.mediaType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        ...(image.name === undefined ? {} : { name: image.name }),
        ...(image.originalDimensions === undefined ? {} : {
          originalDimensions: { ...image.originalDimensions },
        }),
      },
    },
  ])
}

function visionImageTool(
  name: string,
  sources: readonly VisionImageSource[],
  inspected: Set<string>,
  maxImages: number,
  saveImage: (source: { data: Uint8Array; mediaType: ImageMediaType; name: string }) => Promise<ImageAttachmentRef>,
) {
  const byId = new Map(sources.map(source => [source.id, source] as const))
  return defineTool({
    name,
    description: `Read one through ${String(maxImages)} source previews by opaque id. Every returned image is authoritative visual evidence and must be inspected before the final submission.`,
    parameters: {
      ids: {
        type: 'array',
        required: true,
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          images: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => visionImageContent(value as unknown as VisionImageValue),
    },
    async execute(args) {
      const ids = args.ids
      if (ids.length < 1 || ids.length > maxImages) {
        throw new Error(`preview request must contain one through ${String(maxImages)} ids`)
      }
      if (new Set(ids).size !== ids.length) throw new Error('preview request contains duplicate ids')
      const requested: VisionImageSource[] = []
      for (const id of ids) {
        const source = byId.get(id)
        if (source === undefined) throw new Error(`unknown preview id: ${id}`)
        if (inspected.has(id)) throw new Error(`preview was already inspected: ${id}`)
        requested.push(source)
      }
      const images = await Promise.all(requested.map(async (source) => {
        const data = decodeCanonicalBase64(source.contentBase64)
        if (data === undefined) throw new Error(`preview is not canonical base64: ${source.id}`)
        const attachment = await saveImage({ data, mediaType: source.mediaType, name: `${source.id}.png` })
        return {
          id: source.id,
          label: source.label,
          attachmentId: attachment.attachmentId,
          mediaType: attachment.mediaType,
          bytes: attachment.bytes,
          width: attachment.width,
          height: attachment.height,
          ...(attachment.name === undefined ? {} : { name: attachment.name }),
          ...(attachment.originalDimensions === undefined ? {} : {
            originalDimensions: { ...attachment.originalDimensions },
          }),
        }
      }))
      for (const source of requested) inspected.add(source.id)
      return { images }
    },
  })
}

function cropRegions(
  elements: readonly IndexedElement[],
  selectedPages: readonly TeacherQuestionLayoutPage[],
  padding: number,
  head: IndexedElement,
  cropStops: readonly IndexedElement[],
  excluded: ReadonlySet<string>,
  explicitAdditionalIds: ReadonlySet<string>,
  maxAutoOwnedGapRatio: number,
) {
  const effectiveGroups = selectedPages.flatMap((page) => {
    const ordered = elements
      .filter(item => item.page === page)
      .toSorted((left, right) => (
        left.element.bbox[1] - right.element.bbox[1]
          || left.element.bbox[0] - right.element.bbox[0]
          || left.ordinal - right.ordinal
      ))
    let effectiveCount = ordered.length
    let occupiedBottom = ordered[0]?.element.bbox[3] ?? 0
    for (let index = 1; index < ordered.length; index += 1) {
      const current = ordered[index]
      if (current === undefined) continue
      const trailing = ordered.slice(index)
      const disconnectedGap = current.element.bbox[1] - occupiedBottom
      const minimumGap = page.height * maxAutoOwnedGapRatio
      if (disconnectedGap >= minimumGap
        && !trailing.some(item => explicitAdditionalIds.has(item.id) || item.id === head.id)) {
        effectiveCount = index
        break
      }
      occupiedBottom = Math.max(occupiedBottom, current.element.bbox[3])
    }
    const effective = ordered.slice(0, effectiveCount)
    if (effective.length === 0) return []
    const minimumGap = page.height * maxAutoOwnedGapRatio
    const verticalClusters: IndexedElement[][] = []
    let clusterBottom = 0
    for (const item of effective) {
      const previous = verticalClusters.at(-1)
      if (previous === undefined || item.element.bbox[1] - clusterBottom >= minimumGap) {
        verticalClusters.push([item])
        clusterBottom = item.element.bbox[3]
      } else {
        previous.push(item)
        clusterBottom = Math.max(clusterBottom, item.element.bbox[3])
      }
    }
    const slices: Array<{
      elements: IndexedElement[]
      left: number
      right: number
    }> = []
    for (const cluster of verticalClusters) {
      const clusterLeft = Math.min(...cluster.map(item => item.element.bbox[0]))
      const clusterRight = Math.max(...cluster.map(item => item.element.bbox[2]))
      const matching = slices.find(slice => (
        clusterRight + padding >= slice.left && slice.right + padding >= clusterLeft
      ))
      if (matching === undefined) {
        slices.push({ elements: [...cluster], left: clusterLeft, right: clusterRight })
      } else {
        matching.elements.push(...cluster)
        matching.left = Math.min(matching.left, clusterLeft)
        matching.right = Math.max(matching.right, clusterRight)
      }
    }
    return slices
      .toSorted((left, right) => (
        Math.min(...left.elements.map(item => item.ordinal))
          - Math.min(...right.elements.map(item => item.ordinal))
      ))
      .map(slice => ({ page, elements: slice.elements }))
  })
  const effectiveElements = effectiveGroups.flatMap(group => group.elements)
  const ownedIds = new Set(effectiveElements.map(item => item.id))
  const allElements = indexElements(selectedPages)
  return selectedPages.flatMap((page) => {
    const others = allElements.filter(item => item.page === page && !ownedIds.has(item.id))
    return effectiveGroups.filter(group => group.page === page).flatMap(({ elements: owned }) => {
      const ownedLeft = Math.min(...owned.map(item => item.element.bbox[0]))
      const ownedTop = Math.min(...owned.map(item => item.element.bbox[1]))
      const ownedRight = Math.max(...owned.map(item => item.element.bbox[2]))
      const ownedBottom = Math.max(...owned.map(item => item.element.bbox[3]))
      const horizontalBlockers = others.filter(item => (
        item.element.bbox[2] > ownedLeft && item.element.bbox[0] < ownedRight
      ))
      const verticalBlockers = others.filter(item => (
        item.element.bbox[3] > ownedTop && item.element.bbox[1] < ownedBottom
      ))
      const previousBottom = Math.max(0, ...horizontalBlockers
        .filter(item => item.element.bbox[3] <= ownedTop)
        .map(item => item.element.bbox[3]))
      const nextTop = Math.min(page.height, ...horizontalBlockers
        .filter(item => item.element.bbox[1] >= ownedBottom)
        .map(item => item.element.bbox[1]))
      const previousRight = Math.max(0, ...verticalBlockers
        .filter(item => item.element.bbox[2] <= ownedLeft)
        .map(item => item.element.bbox[2]))
      const nextLeft = Math.min(page.width, ...verticalBlockers
        .filter(item => item.element.bbox[0] >= ownedRight)
        .map(item => item.element.bbox[0]))
      const left = Math.max(0, ownedLeft - padding, previousRight)
      const bufferedPreviousBottom = previousBottom === 0
        ? 0
        : Math.ceil((previousBottom + ownedTop) / 2)
      const right = Math.min(page.width, ownedRight + padding, nextLeft)
      const questionTop = owned.some(item => item.id === head.id) ? head.element.bbox[1] : ownedTop
      const hardPreviousBottom = Math.max(0, ...cropStops
        .filter(item => item.page === page
          && item.id !== head.id
          && item.element.bbox[1] < questionTop
          && item.element.bbox[2] > left
          && item.element.bbox[0] < right)
        .map(item => item.element.bbox[3]))
      const bufferedHardPreviousBottom = hardPreviousBottom === 0
        ? 0
        : hardPreviousBottom <= ownedTop
          ? Math.ceil((hardPreviousBottom + ownedTop) / 2)
          : hardPreviousBottom - ownedTop <= padding
            ? ownedTop
            : 0
      const top = Math.max(0, ownedTop - padding, bufferedPreviousBottom, bufferedHardPreviousBottom)
      const hardNextTop = Math.min(page.height, ...cropStops
        .filter(item => item.page === page
          && item.id !== head.id
          && item.element.bbox[1] > questionTop
          && item.element.bbox[2] > left
          && item.element.bbox[0] < right)
        .map(item => item.element.bbox[1]))
      // A blocker in another horizontal lane may overlap vertically; outside content never truncates owned pixels.
      const bufferedNextTop = nextTop === page.height
        ? page.height
        : nextTop <= ownedBottom
          ? page.height
          : Math.floor((ownedBottom + nextTop) / 2)
      const bufferedHardNextTop = hardNextTop === page.height
        ? page.height
        : hardNextTop <= ownedBottom
          ? ownedBottom - hardNextTop <= padding
            ? hardNextTop
            : page.height
          : Math.floor((ownedBottom + hardNextTop) / 2)
      const bottom = Math.min(page.height, ownedBottom + padding, bufferedNextTop, bufferedHardNextTop)
      const excludedAreas = allElements
        .filter(item => item.page === page
          && excluded.has(item.id as string)
          && item.element.bbox[2] > left
          && item.element.bbox[0] < right
          && item.element.bbox[3] > top
          && item.element.bbox[1] < bottom
          && !owned.some(owner => boxesOverlap(owner.element.bbox, item.element.bbox)))
        .map(item => item.element.bbox)
      return right > left && bottom > top
        ? [{
          pageIndex: page.pageIndex,
          left,
          top,
          right,
          rightLimit: nextLeft,
          bottom,
          excludedAreas,
          pageWidth: page.width,
          pageHeight: page.height,
        }]
        : []
    })
  })
}

function applyVerticalRegionEdits(
  regions: readonly TeacherQuestionPageRegion[],
  edits: readonly VerticalRegionEdit[],
  question: SelectedQuestion,
  selected: readonly SelectedQuestion[],
  pages: readonly TeacherQuestionLayoutPage[],
): { readonly regions: readonly TeacherQuestionPageRegion[]; readonly errors: readonly string[] } {
  if (edits.length === 0) return { regions, errors: [] }
  const errors: string[] = []
  const edited = regions.map(region => ({ ...region }))
  for (const [index, edit] of edits.entries()) {
    const label = `verticalRegionEdits[${String(index)}]`
    const regionIndex = edited.findIndex(region => region.pageIndex === edit.pageIndex)
    const region = edited[regionIndex]
    const page = pages.find(candidate => candidate.pageIndex === edit.pageIndex)
    if (region === undefined || page === undefined) {
      errors.push(`${label}.pageIndex has no existing source slice for this question`)
      continue
    }
    const top = edit.top ?? region.top
    const bottom = edit.bottom ?? region.bottom
    if (top < 0 || bottom > page.height || bottom <= top) {
      errors.push(`${label} must satisfy 0 <= top < bottom <= page height`)
      continue
    }
    if (question.head.page === page
      && (top > question.head.element.bbox[1] || bottom < question.head.element.bbox[3])) {
      errors.push(`${label} must retain the complete question head`)
      continue
    }
    const editedBox = [region.left, top, region.right, bottom] as const
    const crossedHead = selected.find(candidate => (
      candidate !== question
        && candidate.head.page === page
        && boxesOverlap(editedBox, candidate.head.element.bbox)
    ))
    if (crossedHead !== undefined) {
      errors.push(`${label} crosses question head ${String(crossedHead.head.id)}`)
      continue
    }
    edited[regionIndex] = { ...region, top, bottom }
  }
  return { regions: edited, errors }
}

function assignQuestionOwners(
  elements: readonly IndexedElement[],
  selected: readonly SelectedQuestion[],
  end: IndexedElement | undefined,
  semanticStops: readonly IndexedElement[],
  excluded: ReadonlySet<string>,
  claimed: ReadonlyMap<string, number>,
  retainedImages: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const owners = new Map<string, number>()
  const nearestStop = (
    question: SelectedQuestion,
    candidates: readonly (IndexedElement | undefined)[],
  ): IndexedElement | undefined => candidates
    .filter((candidate): candidate is IndexedElement => (
      candidate !== undefined && candidate.ordinal > question.head.ordinal
    ))
    .toSorted((left, right) => left.ordinal - right.ordinal)[0]
  const applicableSemanticStops = (question: SelectedQuestion): readonly IndexedElement[] => semanticStops.filter(stop => (
    stop.ordinal > question.head.ordinal
      && (stop.page !== question.head.page
        || horizontalBoxDistance(stop.element.bbox, question.head.element.bbox) === 0)
  ))
  const ordinalStops = selected.map((question, questionIndex) => nearestStop(question, [
    question.end,
    selected[questionIndex + 1]?.head,
    end,
    ...applicableSemanticStops(question),
  ]))
  const hardStops = selected.map(question => nearestStop(question, [
    question.end,
    end,
    ...applicableSemanticStops(question),
  ]))
  for (const [questionIndex, question] of selected.entries()) {
    const next = ordinalStops[questionIndex]
    for (const element of elements) {
      const id = element.id as string
      if (element.ordinal < question.head.ordinal
        || (next !== undefined && element.ordinal >= next.ordinal)
        || excluded.has(id)) continue
      const claimedOwner = claimed.get(id)
      if (claimedOwner === undefined || claimedOwner === questionIndex) owners.set(id, questionIndex)
    }
  }
  for (const [id, questionIndex] of claimed) owners.set(id, questionIndex)
  const ordinalOwners = new Map(owners)

  const selectedById = new Map(selected.map((question, index) => [question.head.id as string, index] as const))
  for (const page of new Set(elements.map(element => element.page))) {
    const pageQuestions = selected.map((question, index) => ({ question, index })).filter(item => item.question.head.page === page)
    if (pageQuestions.length < 2) continue
    const lanes: Array<{
      left: number
      maxHeadHeight: number
      questions: typeof pageQuestions
    }> = []
    for (const item of [...pageQuestions].sort((left, right) => (
      left.question.head.element.bbox[0] - right.question.head.element.bbox[0]
    ))) {
      const [left, top, , bottom] = item.question.head.element.bbox
      const height = bottom - top
      const lane = lanes.at(-1)
      if (lane !== undefined && left - lane.left <= Math.max(height, lane.maxHeadHeight)) {
        lane.maxHeadHeight = Math.max(lane.maxHeadHeight, height)
        lane.questions.push(item)
      } else {
        lanes.push({ left, maxHeadHeight: height, questions: [item] })
      }
    }
    if (lanes.length < 2) continue
    const laneIndexFor = (element: IndexedElement): number => Math.max(
      0,
      lanes.findLastIndex(lane => lane.left <= element.element.bbox[0]),
    )
    const claimedLaneSeeds = [...claimed].flatMap(([id, index]) => {
      const element = elements.find(candidate => candidate.id === id && candidate.page === page)
      return element === undefined ? [] : [{ element, index, laneIndex: laneIndexFor(element) }]
    })
    const retainedLaneSeeds: Array<{
      element: IndexedElement
      index: number
      laneIndex: number
    }> = []
    for (const element of elements.filter(item => item.page === page)) {
      const id = element.id as string
      if (excluded.has(id)) {
        owners.delete(id)
        continue
      }
      const explicitOwner = claimed.get(id) ?? selectedById.get(id)
      if (explicitOwner !== undefined) {
        owners.set(id, explicitOwner)
        continue
      }
      const laneIndex = laneIndexFor(element)
      const lane = lanes[laneIndex]
      const nextLane = lanes[laneIndex + 1]
      if (lane === undefined) continue
      if (nextLane !== undefined && element.element.bbox[2] > nextLane.left) continue
      const claimedContinuation = claimedLaneSeeds
        .filter((seed) => {
          const stop = ordinalStops[seed.index]
          return seed.laneIndex === laneIndex
            && seed.element.ordinal < element.ordinal
            && (stop === undefined || element.ordinal < stop.ordinal)
        })
        .toSorted((left, right) => right.element.ordinal - left.element.ordinal)[0]
      if (claimedContinuation !== undefined) {
        owners.set(id, claimedContinuation.index)
        continue
      }
      const owner = lane.questions.filter((item) => {
        const hardStop = hardStops[item.index]
        return item.question.head.element.bbox[1] <= element.element.bbox[1]
          && (hardStop === undefined || element.ordinal < hardStop.ordinal)
      }).sort((left, right) => right.question.head.element.bbox[1] - left.question.head.element.bbox[1])[0]
      const retainedContinuation = retainedLaneSeeds
        .filter((seed) => {
          const stop = ordinalStops[seed.index]
          return seed.laneIndex === laneIndex
            && seed.element.ordinal < element.ordinal
            && (stop === undefined || element.ordinal < stop.ordinal)
        })
        .toSorted((left, right) => right.element.ordinal - left.element.ordinal)[0]
      const retainedOwner = retainedImages.has(id) ? ordinalOwners.get(id) : undefined
      const resolvedOwner = owner?.index ?? retainedContinuation?.index ?? retainedOwner
      if (resolvedOwner === undefined) owners.delete(id)
      else owners.set(id, resolvedOwner)
      if (retainedImages.has(id) && resolvedOwner !== undefined) {
        retainedLaneSeeds.push({ element, index: resolvedOwner, laneIndex })
      }
    }
  }
  return owners
}

function boxesOverlap(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean {
  return left[2] > right[0] && left[0] < right[2] && verticalBoxesOverlap(left, right)
}

function horizontalBoxDistance(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): number {
  if (left[2] >= right[0] && right[2] >= left[0]) return 0
  return left[2] < right[0] ? right[0] - left[2] : left[0] - right[2]
}

function validateBoundaryDraft(
  draft: BoundaryDraft,
  elements: readonly IndexedElement[],
  pages: readonly TeacherQuestionLayoutPage[],
  padding: number,
  maxQuestions: number,
  requiredHeadCandidateIds: ReadonlySet<string>,
  requiredImageElementIds: ReadonlySet<string>,
  maxAutoOwnedGapRatio: number,
): BoundaryValidation {
  const errors: string[] = []
  const referenceErrors: string[] = []
  if (draft.headConvention.trim() === '') errors.push('headConvention must describe the inferred question-head convention')
  if (draft.headConvention.length > 1_000) errors.push('headConvention exceeds 1000 characters')
  if (draft.questions.length > maxQuestions) errors.push(`questions exceeds the ${String(maxQuestions)} item limit`)
  const byId = new Map(elements.map(element => [element.id as string, element] as const))
  const selected: SelectedQuestion[] = []
  const seenIds = new Set<string>()
  for (const [index, question] of draft.questions.entries()) {
    const label = `questions[${String(index)}]`
    const head = byId.get(question.headElementId)
    if (head === undefined) {
      const error = `${label}.headElementId is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
      continue
    }
    if (isSemanticBoundaryElement(head)) {
      errors.push(`${label}.headElementId references a section or answer heading, not an independent question`)
    }
    if (seenIds.has(question.headElementId)) {
      const error = `${label}.headElementId duplicates an earlier question`
      errors.push(error)
      referenceErrors.push(error)
    }
    seenIds.add(question.headElementId)
    const questionStop = question.stopBeforeElementId === undefined ? undefined : byId.get(question.stopBeforeElementId)
    if (question.stopBeforeElementId !== undefined && questionStop === undefined) {
      const error = `${label}.stopBeforeElementId is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
    }
    const additional: IndexedElement[] = []
    const localIds = new Set<string>()
    for (const [additionalIndex, id] of (question.additionalElementIds ?? []).entries()) {
      const additionalLabel = `${label}.additionalElementIds[${String(additionalIndex)}]`
      const element = byId.get(id)
      if (element === undefined) {
        const error = `${additionalLabel} is not present in the inspected source`
        errors.push(error)
        referenceErrors.push(error)
      }
      else additional.push(element)
      if (id === question.headElementId) {
        const error = `${additionalLabel} repeats its question head`
        errors.push(error)
        referenceErrors.push(error)
      }
      if (id === question.stopBeforeElementId) {
        errors.push(`${additionalLabel} cannot claim stopBeforeElementId; that element is the first item outside the question`)
      }
      if (localIds.has(id)) {
        const error = `${additionalLabel} duplicates an earlier additional element`
        errors.push(error)
        referenceErrors.push(error)
      }
      localIds.add(id)
    }
    const verticalRegionEdits: VerticalRegionEdit[] = []
    const editedPages = new Set<number>()
    for (const [editIndex, edit] of (question.verticalRegionEdits ?? []).entries()) {
      const editLabel = `${label}.verticalRegionEdits[${String(editIndex)}]`
      if (!Number.isSafeInteger(edit.pageIndex) || !pages.some(page => page.pageIndex === edit.pageIndex)) {
        errors.push(`${editLabel}.pageIndex is not an inspected source page`)
      }
      if (editedPages.has(edit.pageIndex)) errors.push(`${editLabel}.pageIndex duplicates an earlier vertical edit`)
      if (edit.top === undefined && edit.bottom === undefined) {
        errors.push(`${editLabel} must set top or bottom`)
      }
      if (edit.top !== undefined && !Number.isFinite(edit.top)) errors.push(`${editLabel}.top must be finite`)
      if (edit.bottom !== undefined && !Number.isFinite(edit.bottom)) errors.push(`${editLabel}.bottom must be finite`)
      editedPages.add(edit.pageIndex)
      verticalRegionEdits.push(edit)
    }
    selected.push({
      head,
      ...(questionStop === undefined ? {} : { end: questionStop }),
      additional,
      verticalRegionEdits,
    })
  }
  selected.sort((left, right) => left.head.ordinal - right.head.ordinal)
  for (const [index, question] of selected.entries()) {
    const nextHead = selected[index + 1]?.head
    if (question.end !== undefined && question.end.ordinal <= question.head.ordinal) {
      errors.push(`questions[${String(index)}].stopBeforeElementId must follow its question head`)
    }
    if (question.end !== undefined && nextHead !== undefined && question.end.ordinal > nextHead.ordinal) {
      errors.push(`questions[${String(index)}].stopBeforeElementId must not follow the next question head`)
    }
  }
  const end = draft.stopBeforeElementId === undefined ? undefined : byId.get(draft.stopBeforeElementId)
  if (draft.stopBeforeElementId !== undefined && end === undefined) {
    const error = 'stopBeforeElementId is not present in the inspected source'
    errors.push(error)
    referenceErrors.push(error)
  }
  const lastHead = selected.at(-1)?.head
  if (end !== undefined && lastHead !== undefined && end.ordinal <= lastHead.ordinal) {
    errors.push('stopBeforeElementId must follow the final question head')
  }
  const declaredExcluded = new Set<string>()
  for (const [index, id] of (draft.excludedElementIds ?? []).entries()) {
    const label = `excludedElementIds[${String(index)}]`
    if (!byId.has(id)) {
      const error = `${label} is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (seenIds.has(id)) {
      const error = `${label} must not exclude a question head`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (declaredExcluded.has(id)) {
      const error = `${label} duplicates an earlier excluded element`
      errors.push(error)
      referenceErrors.push(error)
    }
    declaredExcluded.add(id)
  }
  const declaredNonQuestionHeads = new Set<string>()
  for (const [index, id] of (draft.nonQuestionHeadElementIds ?? []).entries()) {
    const label = `nonQuestionHeadElementIds[${String(index)}]`
    if (!byId.has(id)) {
      const error = `${label} is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (seenIds.has(id)) {
      const error = `${label} must not also be a question head`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (declaredNonQuestionHeads.has(id)) {
      const error = `${label} duplicates an earlier non-question decision`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (declaredExcluded.has(id)) errors.push(`${label} must not also exclude the same element`)
    declaredNonQuestionHeads.add(id)
  }
  const explicitlyClaimedIds = new Set(selected.flatMap(question => (
    question.additional.map(element => element.id as string)
  )))
  const declaredRetainedImages = new Set<string>()
  for (const [index, id] of (draft.retainedImageElementIds ?? []).entries()) {
    const label = `retainedImageElementIds[${String(index)}]`
    const element = byId.get(id)
    if (element === undefined) {
      const error = `${label} is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
    } else if (element.element.type !== 'image') {
      errors.push(`${label} must reference an image element`)
    }
    if (seenIds.has(id)) errors.push(`${label} must not also be a question head`)
    if (declaredRetainedImages.has(id)) {
      const error = `${label} duplicates an earlier retained image decision`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (declaredExcluded.has(id)) errors.push(`${label} must not also exclude the same image`)
    if (explicitlyClaimedIds.has(id)) errors.push(`${label} must not also assign the same image through additionalElementIds`)
    declaredRetainedImages.add(id)
  }
  const unclassifiedCandidates = [...requiredHeadCandidateIds].filter(id => (
    !seenIds.has(id) && !declaredNonQuestionHeads.has(id) && !declaredExcluded.has(id)
  ))
  if (unclassifiedCandidates.length > 0) {
    errors.push(`possible question-head candidates require an explicit decision: ${unclassifiedCandidates.join(', ')}`)
  }
  const unclassifiedImages = [...requiredImageElementIds].filter(id => (
    !seenIds.has(id)
      && !declaredRetainedImages.has(id)
      && !declaredExcluded.has(id)
      && !explicitlyClaimedIds.has(id)
  ))
  if (unclassifiedImages.length > 0) {
    errors.push(`image elements require an explicit retained, excluded, or additional ownership decision: ${unclassifiedImages.join(', ')}`)
  }
  const semanticStops = elements.filter(isSemanticBoundaryElement)
  const excluded = new Set([
    ...declaredExcluded,
    ...semanticStops.map(element => element.id as string),
  ])
  const selectedHeadIds = new Set(selected.map(question => question.head.id as string))
  const claimed = new Map<string, number>()
  for (const [questionIndex, question] of selected.entries()) {
    for (const element of question.additional) {
      const id = element.id as string
      const owner = claimed.get(id)
      if (owner !== undefined && owner !== questionIndex) {
        errors.push(`questions[${String(questionIndex)}].additionalElementIds claims an element already claimed by questions[${String(owner)}]`)
      }
      if (excluded.has(id)) {
        errors.push(`questions[${String(questionIndex)}].additionalElementIds claims excluded element ${id}`)
      }
      if (question.head.page === element.page) {
        const claimantOverlaps = verticalBoxesOverlap(element.element.bbox, question.head.element.bbox)
        const claimantDistance = horizontalBoxDistance(element.element.bbox, question.head.element.bbox)
        const overlappingHead = selected.find((candidate, candidateIndex) => (
          candidateIndex !== questionIndex
            && candidate.head.page === element.page
            && verticalBoxesOverlap(element.element.bbox, candidate.head.element.bbox)
            && horizontalBoxDistance(element.element.bbox, candidate.head.element.bbox) < claimantDistance
        ))
        if (!claimantOverlaps && overlappingHead !== undefined) {
          errors.push(`questions[${String(questionIndex)}].additionalElementIds assigns ${id} across the vertical band of ${String(overlappingHead.head.id)}`)
        }
      }
      claimed.set(id, questionIndex)
    }
  }
  if (errors.length > 0) return { errors, referenceErrors }
  const owners = assignQuestionOwners(
    elements,
    selected,
    end,
    semanticStops,
    excluded,
    claimed,
    declaredRetainedImages,
  )
  for (const [questionIndex, question] of selected.entries()) {
    if (!isCitationOnlyQuestionHead(question.head)) continue
    const ownedContent = elements.some(element => (
      element.id !== question.head.id && owners.get(element.id) === questionIndex
    ))
    if (!ownedContent) {
      errors.push(`questions[${String(questionIndex)}].headElementId is only a citation label without question content; classify it in nonQuestionHeadElementIds`)
    }
  }
  if (errors.length > 0) return { errors, referenceErrors }
  const cropStops = elements.filter(element => (
    selectedHeadIds.has(element.id as string)
      || element === end
      || selected.some(question => question.end === element)
      || semanticStops.includes(element)
  ))
  const questions = selected.map((item, index): TeacherSegmentedQuestion => {
    const owned = elements.filter(element => owners.get(element.id as string) === index)
    for (const element of item.additional) {
      if (!owned.includes(element)) owned.push(element)
    }
    const edited = applyVerticalRegionEdits(
      cropRegions(
        owned,
        pages,
        padding,
        item.head,
        cropStops,
        excluded,
        new Set(item.additional.map(element => element.id as string)),
        maxAutoOwnedGapRatio,
      ),
      item.verticalRegionEdits,
      item,
      selected,
      pages,
    )
    errors.push(...edited.errors.map(error => `questions[${String(index)}].${error}`))
    return {
      sourceHeadId: item.head.id,
      questionNo: index + 1,
      headPageIndex: item.head.page.pageIndex,
      groupIndex: 0,
      regions: edited.regions,
    }
  })
  if (errors.length > 0) return { errors, referenceErrors }
  if (questions.some(question => question.regions.length === 0)) {
    return { errors: ['one or more accepted boundaries produce an empty crop'], referenceErrors }
  }
  return { errors: [], referenceErrors, questions }
}

function verticalBoxesOverlap(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean {
  return left[3] > right[1] && left[1] < right[3]
}

function submissionTool(
  name: string,
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
  elements: readonly IndexedElement[],
  accepted: Map<string, AcceptedBoundaryDraft>,
  state: BoundarySubmissionState,
  sourceComplete: () => boolean,
) {
  return defineTool({
    name,
    description: 'Submit one complete semantic boundary draft. The Host validates element references, ordering, ownership, and crop geometry without imposing one numbering or document format.',
    parameters: {
      headConvention: { type: 'string', required: true },
      questions: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            headElementId: { type: 'string', required: true },
            stopBeforeElementId: {
              type: 'string',
              description: 'First OCR element outside this question. The crop stops before it; omit it to use the next question head.',
            },
            additionalElementIds: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
      excludedElementIds: {
        type: 'array',
        items: { type: 'string' },
      },
      nonQuestionHeadElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Possible question-head candidates explicitly classified as content that does not begin an independent question. These elements remain eligible question content.',
      },
      retainedImageElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Image elements inspected in the page preview and retained for automatic geometric ownership. Do not list images assigned through additionalElementIds.',
      },
      stopBeforeElementId: {
        type: 'string',
        description: 'First OCR element outside the final question. The inspected range stops before it.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      if (!sourceComplete()) return Promise.resolve('REJECTED\ninspect every source chunk before submitting boundaries')
      const fingerprint = JSON.stringify(args)
      if (state.seenDrafts.has(fingerprint)) return Promise.resolve('REJECTED\nthis identical rejected draft was already checked; change the reported decisions')
      state.seenDrafts.add(fingerprint)
      const validated = validateBoundaryDraft(
        args,
        elements,
        request.pages,
        request.padding,
        config.maxSegmentedQuestions,
        new Set(possibleQuestionHeadIds(elements)),
        new Set(imageElementIds(elements)),
        config.maxQuestionAutoOwnedGapRatio,
      )
      if (validated.referenceErrors.length === 0) {
        state.submissions += 1
        if (state.submissions > config.maxQuestionBoundarySubmissions) {
          return Promise.resolve('REJECTED\nboundary submission limit reached')
        }
      }
      if (validated.questions === undefined) {
        return Promise.resolve([
          'REJECTED',
          ...(validated.referenceErrors.length === 0
            ? []
            : ['invalid or duplicate element references do not consume the complete-draft submission limit']),
          ...validated.errors,
        ].join('\n'))
      }
      const token = randomUUID()
      accepted.set(token, { token, questions: validated.questions })
      return Promise.resolve(`ACCEPTED\nvalidationToken=${token}`)
    },
  })
}

function validateCropReviewRequest(
  request: TeacherQuestionCropReviewRequest,
  config: TeacherQuestionSegmentationAgentConfig,
): string | undefined {
  const requestError = validateRequest({
    parentSessionId: request.parentSessionId,
    fileName: request.fileName,
    pages: request.pages,
    padding: request.padding,
  }, config)
  if (requestError !== undefined) return requestError
  if (!Number.isSafeInteger(request.groupIndex) || request.groupIndex < 0) return 'groupIndex must be a non-negative integer'
  if (!Number.isSafeInteger(request.recutAttempt) || request.recutAttempt < 0) {
    return 'recutAttempt must be a non-negative integer'
  }
  if (request.corePageIndexes.length === 0) return 'corePageIndexes must not be empty'
  const pageIndexes = new Set(request.pages.map(page => page.pageIndex))
  if (new Set(request.corePageIndexes).size !== request.corePageIndexes.length
    || request.corePageIndexes.some(pageIndex => !pageIndexes.has(pageIndex))) {
    return 'corePageIndexes must be unique inspection-page indexes'
  }
  if (request.questions.some(question => question.groupIndex !== request.groupIndex)) {
    return 'every preliminary question must belong to groupIndex'
  }
  const sourceHeadIds = new Set(request.questions.map(question => question.sourceHeadId))
  if (sourceHeadIds.size !== request.questions.length) return 'preliminary sourceHeadId values must be unique'
  const questionNumbers = new Set(request.questions.map(question => question.questionNo))
  if (questionNumbers.size !== request.questions.length) return 'preliminary question numbers must be unique'
  const reviewQuestionIds = new Set(request.reviewQuestionIds)
  if (request.questions.length > 0 && reviewQuestionIds.size === 0) {
    return 'reviewQuestionIds must not be empty when preliminary crops exist'
  }
  if (reviewQuestionIds.size !== request.reviewQuestionIds.length
    || request.reviewQuestionIds.some(id => !sourceHeadIds.has(id))) {
    return 'reviewQuestionIds must be unique preliminary sourceHeadId values'
  }
  const reviewedQuestions = request.questions.filter(question => reviewQuestionIds.has(question.sourceHeadId))
  const reviewedNumbers = new Set(reviewedQuestions.map(question => question.questionNo))
  const cropNumbers = new Set<number>()
  for (const crop of request.crops) {
    if (!reviewedNumbers.has(crop.questionNo) || cropNumbers.has(crop.questionNo)) {
      return 'crop images contain an unknown or duplicate question number'
    }
    if (!Number.isSafeInteger(crop.width) || crop.width < 1
      || !Number.isSafeInteger(crop.height) || crop.height < 1) {
      return `question ${String(crop.questionNo)} crop has invalid dimensions`
    }
    if (decodeCanonicalBase64(crop.contentBase64) === undefined) {
      return `question ${String(crop.questionNo)} crop is not canonical base64`
    }
    cropNumbers.add(crop.questionNo)
  }
  if (cropNumbers.size !== reviewedNumbers.size) {
    return 'crop images must include every reviewed question exactly once'
  }
  const previewPages = new Set<number>()
  for (const preview of request.pagePreviews) {
    if (!pageIndexes.has(preview.pageIndex) || previewPages.has(preview.pageIndex)) {
      return 'page previews contain an unknown or duplicate page index'
    }
    if (!Number.isSafeInteger(preview.width) || preview.width < 1
      || !Number.isSafeInteger(preview.height) || preview.height < 1) {
      return `page ${String(preview.pageIndex + 1)} preview has invalid dimensions`
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(preview.mediaType)) {
      return `page ${String(preview.pageIndex + 1)} preview has an unsupported media type`
    }
    if (decodeCanonicalBase64(preview.contentBase64) === undefined) {
      return `page ${String(preview.pageIndex + 1)} preview is not canonical base64`
    }
    previewPages.add(preview.pageIndex)
  }
  const reviewsCompleteGroup = reviewQuestionIds.size === sourceHeadIds.size
  const requiredPreviewPages = new Set(reviewedQuestions.length === 0 || reviewsCompleteGroup
    ? request.corePageIndexes
    : reviewedQuestions.flatMap(question => question.regions.map(region => region.pageIndex)))
  return [...requiredPreviewPages].every(pageIndex => previewPages.has(pageIndex))
    ? undefined
    : reviewsCompleteGroup
      ? 'a complete-group review must preview every core page'
      : 'page previews must cover every reviewed question region'
}

function cropReviewFindingsTool(
  name: string,
  request: TeacherQuestionCropReviewRequest,
  inspectedImageIds: ReadonlySet<string>,
  expectedImageIds: ReadonlySet<string>,
  validCropIds: ReadonlySet<string>,
  validPageIds: ReadonlySet<string>,
  state: CropReviewState,
  accepted: Map<string, AcceptedCropReview>,
  maxSubmissions: number,
) {
  const findingKey = (finding: CropReviewFinding): string => finding.cropId === undefined
    ? `page:${finding.pageId ?? ''}`
    : `crop:${finding.cropId}`
  const remainingCropIds = (): readonly string[] => [...validCropIds].filter(id => (
    !state.draftVerifications.has(id) && !state.draftFindings.has(`crop:${id}`)
  ))
  const recordSummary = (): string => {
    const remaining = remainingCropIds()
    return remaining.length === 0
      ? 'RECORDED\nall requested crops are classified; record any missing source-page question now, or call again with finalize=true'
      : `RECORDED\n${String(remaining.length)} requested crop(s) remain unclassified: ${remaining.join(', ')}`
  }
  const finalize = (): string => {
    state.findingSubmissions += 1
    if (state.findingSubmissions > maxSubmissions) return 'REJECTED\nvisual finding submission limit reached'
    const unclassifiedCropIds = remainingCropIds()
    if (unclassifiedCropIds.length > 0) {
      return `REJECTED\nevery requested crop requires a verified or defective classification: ${unclassifiedCropIds.join(', ')}`
    }
    const findings = [...state.draftFindings.values()]
    const replacesEarlierFindings = state.findings !== undefined
    state.findings = findings
    state.seenRevisionDrafts.clear()
    if (findings.length > 0) {
      return `${replacesEarlierFindings ? 'DEFECTS_UPDATED' : 'DEFECTS_RECORDED'}\ninspect the listed OCR source chunks, then submit local corrections for cited crops; put each confirmed spurious crop in removedCropIds after recording one finding with both cropId and pageId; use a complete-group draft only for a page-only defect describing a question with no crop`
    }
    const token = randomUUID()
    accepted.set(token, {
      token,
      decision: 'accepted',
      affectedQuestionIds: [],
      questions: request.questions,
    })
    return `ACCEPTED\nvalidationToken=${token}`
  }
  return defineTool({
    name,
    description: 'Record one inspected crop or source-page defect at a time, then finalize the complete classification. A verified crop uses cropId, answerDemand, and evidence. An incomplete crop uses cropId and may also cite pageId. A pageId-only defect is reserved for an independent source question with no listed crop. A spurious crop uses one finding containing both cropId and pageId. Call with finalize=true after every crop is classified. Complete verifiedCrops and findings arrays remain available for one-call submission.',
    parameters: {
      verifiedCrops: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cropId: { type: 'string', required: true },
            answerDemand: {
              type: 'string',
              required: true,
              description: 'Visible task, choice, blank, proof, calculation, or other response the learner must produce. Numbering or a topic title is not an answer demand.',
            },
            evidence: { type: 'string', required: true },
          },
        },
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cropId: { type: 'string' },
            pageId: { type: 'string' },
            issue: { type: 'string', required: true },
            evidence: { type: 'string', required: true },
          },
        },
      },
      cropId: { type: 'string' },
      pageId: { type: 'string' },
      answerDemand: {
        type: 'string',
        description: 'For one verified crop, the visible response the learner must produce.',
      },
      issue: { type: 'string', description: 'For one defective crop or source page, the visible defect.' },
      evidence: { type: 'string', description: 'Visible first/last owned content or defect evidence.' },
      finalize: {
        type: 'boolean',
        description: 'Validate the accumulated classifications and return the accepted token or defect workflow.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      if (accepted.size > 0) return Promise.resolve('REJECTED\nthis review already has an accepted result')
      if (![...expectedImageIds].every(id => inspectedImageIds.has(id))) {
        return Promise.resolve('REJECTED\ninspect every requested source-page preview and question crop before submitting findings')
      }
      const hasBatch = args.verifiedCrops !== undefined || args.findings !== undefined
      if (hasBatch && (args.verifiedCrops === undefined || args.findings === undefined)) {
        return Promise.resolve('REJECTED\ncomplete-array submission requires both verifiedCrops and findings')
      }
      if (hasBatch && (args.cropId !== undefined || args.pageId !== undefined || args.answerDemand !== undefined
        || args.issue !== undefined || args.evidence !== undefined || args.finalize !== undefined)) {
        return Promise.resolve('REJECTED\ndo not mix complete arrays with one-record or finalize fields')
      }
      if (!hasBatch && args.finalize === true) {
        const hasRecord = args.cropId !== undefined || args.pageId !== undefined || args.answerDemand !== undefined
          || args.issue !== undefined || args.evidence !== undefined
        if (!hasRecord) return Promise.resolve(finalize())
      }
      if (!hasBatch) {
        if (args.evidence === undefined || args.evidence.trim() === '') {
          return Promise.resolve('REJECTED\none-record submission requires visible evidence')
        }
        if (args.issue !== undefined) {
          if (args.issue.trim() === '') return Promise.resolve('REJECTED\ndefect issue must not be empty')
          if (args.answerDemand !== undefined) {
            return Promise.resolve('REJECTED\na record cannot be both verified and defective')
          }
          if (args.cropId === undefined && args.pageId === undefined) {
            return Promise.resolve('REJECTED\ndefect record must cite cropId or pageId')
          }
          if (args.cropId !== undefined && !validCropIds.has(args.cropId)) {
            return Promise.resolve('REJECTED\ncropId is not a requested crop')
          }
          if (args.pageId !== undefined && !validPageIds.has(args.pageId)) {
            return Promise.resolve('REJECTED\npageId is not a supplied source page')
          }
          const citedCropInEvidence = args.cropId === undefined
            ? [...validCropIds].find(id => `${args.issue}\n${args.evidence}`.includes(id))
            : undefined
          if (citedCropInEvidence !== undefined) {
            return Promise.resolve(`REJECTED\npageId-only findings are only for questions with no crop; resubmit this defect with cropId=${citedCropInEvidence} and optional pageId`)
          }
          const finding: CropReviewFinding = {
            ...(args.cropId === undefined ? {} : { cropId: args.cropId }),
            ...(args.pageId === undefined ? {} : { pageId: args.pageId }),
            issue: args.issue,
            evidence: args.evidence,
          }
          state.draftFindings.set(findingKey(finding), finding)
          if (args.cropId !== undefined) state.draftVerifications.delete(args.cropId)
          return Promise.resolve(args.finalize === true ? finalize() : recordSummary())
        }
        if (args.cropId === undefined || !validCropIds.has(args.cropId)) {
          return Promise.resolve('REJECTED\nverified record requires a requested cropId')
        }
        if (args.pageId !== undefined) {
          return Promise.resolve('REJECTED\nverified record must cite its cropId, not a source page')
        }
        if (args.answerDemand === undefined || args.answerDemand.trim() === '') {
          return Promise.resolve('REJECTED\nverified record requires the visible answer demand')
        }
        state.draftFindings.delete(`crop:${args.cropId}`)
        state.draftVerifications.set(args.cropId, {
          answerDemand: args.answerDemand,
          evidence: args.evidence,
        })
        return Promise.resolve(args.finalize === true ? finalize() : recordSummary())
      }
      const batchFindings = args.findings
      const batchVerifications = args.verifiedCrops
      if (batchFindings === undefined || batchVerifications === undefined) {
        return Promise.resolve('REJECTED\ncomplete-array submission requires both verifiedCrops and findings')
      }
      const findings: CropReviewFinding[] = []
      const defectiveCropIds = new Set<string>()
      for (const [index, finding] of batchFindings.entries()) {
        const label = `findings[${String(index)}]`
        if (finding.cropId === undefined && finding.pageId === undefined) {
          return Promise.resolve(`REJECTED\n${label} must cite cropId or pageId`)
        }
        if (finding.cropId !== undefined && !validCropIds.has(finding.cropId)) {
          return Promise.resolve(`REJECTED\n${label}.cropId is not a requested crop`)
        }
        if (finding.pageId !== undefined && !validPageIds.has(finding.pageId)) {
          return Promise.resolve(`REJECTED\n${label}.pageId is not a supplied source page`)
        }
        const citedCropInEvidence = finding.cropId === undefined
          ? [...validCropIds].find(id => `${finding.issue}\n${finding.evidence}`.includes(id))
          : undefined
        if (citedCropInEvidence !== undefined) {
          return Promise.resolve(`REJECTED\n${label} is page-only but describes ${citedCropInEvidence}; add that cropId so the correction stays local`)
        }
        if (finding.issue.trim() === '' || finding.evidence.trim() === '') {
          return Promise.resolve(`REJECTED\n${label} must contain a concise issue and visible evidence`)
        }
        findings.push({
          ...(finding.cropId === undefined ? {} : { cropId: finding.cropId }),
          ...(finding.pageId === undefined ? {} : { pageId: finding.pageId }),
          issue: finding.issue,
          evidence: finding.evidence,
        })
        if (finding.cropId !== undefined) defectiveCropIds.add(finding.cropId)
      }
      const verifiedCropIds = new Set<string>()
      for (const [index, verification] of batchVerifications.entries()) {
        const label = `verifiedCrops[${String(index)}]`
        if (!validCropIds.has(verification.cropId)) {
          return Promise.resolve(`REJECTED\n${label}.cropId is not a requested crop`)
        }
        if (verifiedCropIds.has(verification.cropId)) {
          return Promise.resolve(`REJECTED\n${label}.cropId duplicates an earlier verified crop`)
        }
        if (defectiveCropIds.has(verification.cropId)) {
          return Promise.resolve(`REJECTED\n${label}.cropId is also classified as defective`)
        }
        if (verification.answerDemand.trim() === '') {
          return Promise.resolve(`REJECTED\n${label}.answerDemand must identify the visible response required from the learner`)
        }
        if (verification.evidence.trim() === '') {
          return Promise.resolve(`REJECTED\n${label}.evidence must summarize visible first and last owned content`)
        }
        verifiedCropIds.add(verification.cropId)
      }
      state.draftFindings.clear()
      state.draftVerifications.clear()
      for (const finding of findings) state.draftFindings.set(findingKey(finding), finding)
      for (const verification of batchVerifications) {
        state.draftVerifications.set(verification.cropId, {
          answerDemand: verification.answerDemand,
          evidence: verification.evidence,
        })
      }
      return Promise.resolve(finalize())
    },
  })
}

function questionGeometryFingerprint(question: TeacherSegmentedQuestion): string {
  return JSON.stringify({
    sourceHeadId: question.sourceHeadId,
    headPageIndex: question.headPageIndex,
    regions: question.regions,
  })
}

function extendQuestionWithAdditionalElements(
  question: TeacherSegmentedQuestion,
  additionalIds: readonly string[],
  elements: readonly IndexedElement[],
  padding: number,
): TeacherSegmentedQuestion {
  const byId = new Map(elements.map(element => [element.id as string, element] as const))
  const regions = question.regions.map(region => ({ ...region }))
  for (const id of additionalIds) {
    const additional = byId.get(id)
    if (additional === undefined) continue
    const [boxLeft, boxTop, boxRight, boxBottom] = additional.element.bbox
    const left = Math.max(0, boxLeft - padding)
    const top = Math.max(0, boxTop - padding)
    const right = Math.min(additional.page.width, boxRight + padding)
    const bottom = Math.min(additional.page.height, boxBottom + padding)
    const index = regions.findIndex(region => region.pageIndex === additional.page.pageIndex)
    const current = regions[index]
    if (current === undefined) {
      regions.push({
        pageIndex: additional.page.pageIndex,
        left,
        top,
        right,
        rightLimit: additional.page.width,
        bottom,
        excludedAreas: [],
        pageWidth: additional.page.width,
        pageHeight: additional.page.height,
      })
      continue
    }
    regions[index] = {
      ...current,
      top: Math.min(current.top, top),
      right: Math.min(current.rightLimit, Math.max(current.right, right)),
      bottom: Math.max(current.bottom, bottom),
      excludedAreas: current.excludedAreas.filter(area => !boxesOverlap(area, additional.element.bbox)),
    }
  }
  regions.sort((left, right) => left.pageIndex - right.pageIndex)
  return { ...question, regions }
}

function cropReviewRevisionTool(
  name: string,
  request: TeacherQuestionCropReviewRequest,
  config: TeacherQuestionSegmentationAgentConfig,
  elements: readonly IndexedElement[],
  cropQuestionIdByPreviewId: ReadonlyMap<string, TeacherQuestionLayoutElementId>,
  state: CropReviewState,
  accepted: Map<string, AcceptedCropReview>,
  evidenceComplete: () => boolean,
) {
  return defineTool({
    name,
    description: 'Correct visually defective boundaries after every OCR chunk is inspected. Crop-cited findings are merged by stable question head and cannot modify uncited questions. removedCropIds locally deletes confirmed spurious crops whose finding cites both cropId and pageId. A page-only finding is reserved for a wholly missing question and may replace the complete group.',
    parameters: {
      headConvention: { type: 'string', required: true },
      questions: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            headElementId: { type: 'string', required: true },
            stopBeforeElementId: {
              type: 'string',
              description: 'First OCR element outside this question. The crop stops before it; never use the question\'s final owned element.',
            },
            additionalElementIds: { type: 'array', items: { type: 'string' } },
            verticalRegionEdits: {
              type: 'array',
              description: 'Optional visual correction of top or bottom only, in OCR page units. Horizontal crop coordinates remain Host-owned.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  pageIndex: { type: 'integer', required: true },
                  top: { type: 'number' },
                  bottom: { type: 'number' },
                },
              },
            },
          },
        },
      },
      removedCropIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Spurious crop ids to remove locally. Every id requires one finding that cites both the crop and one of its source pages.',
      },
      excludedElementIds: { type: 'array', items: { type: 'string' } },
      nonQuestionHeadElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Possible question-head candidates classified as non-head content during a complete-group replacement.',
      },
      retainedImageElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Image elements retained after preview inspection during a complete-group replacement.',
      },
      stopBeforeElementId: {
        type: 'string',
        description: 'First OCR element outside the final question. The inspected range stops before it.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      if ((state.findings?.length ?? 0) === 0) {
        return Promise.resolve('REJECTED\nrecord at least one visual defect before revising boundaries')
      }
      if (!evidenceComplete()) {
        return Promise.resolve('REJECTED\ninspect every listed OCR source chunk before replacing boundaries')
      }
      const fingerprint = JSON.stringify(args)
      if (state.seenRevisionDrafts.has(fingerprint)) {
        return Promise.resolve('REJECTED\nthis identical rejected draft was already checked; change the reported decisions')
      }
      state.seenRevisionDrafts.add(fingerprint)
      const citedIds = new Set<TeacherQuestionLayoutElementId>()
      const currentById = new Map(request.questions.map(question => [question.sourceHeadId, question] as const))
      const pageOnlyFindings = (state.findings ?? []).filter(finding => (
        finding.pageId !== undefined && finding.cropId === undefined
      ))
      for (const finding of state.findings ?? []) {
        if (finding.cropId === undefined) continue
        const id = cropQuestionIdByPreviewId.get(finding.cropId)
        if (id !== undefined) citedIds.add(id)
      }
      const requestedRemovalCropIds = args.removedCropIds ?? []
      if (new Set(requestedRemovalCropIds).size !== requestedRemovalCropIds.length) {
        return Promise.resolve('REJECTED\nremovedCropIds must not contain duplicates')
      }
      const removedQuestionIds = new Set<TeacherQuestionLayoutElementId>()
      for (const cropId of requestedRemovalCropIds) {
        const questionId = cropQuestionIdByPreviewId.get(cropId)
        if (questionId === undefined || !currentById.has(questionId)) {
          return Promise.resolve(`REJECTED\nremovedCropIds contains an unknown requested crop: ${cropId}`)
        }
        const question = currentById.get(questionId)
        const sourcePageIds = new Set(question?.regions.map(region => `page-${String(region.pageIndex + 1)}`) ?? [])
        const cropPageFinding = (state.findings ?? []).find(finding => (
          finding.cropId === cropId
            && finding.pageId !== undefined
            && sourcePageIds.has(finding.pageId)
        ))
        if (cropPageFinding === undefined) {
          return Promise.resolve(`REJECTED\nremoved crop ${cropId} requires one finding with both its cropId and a source pageId`)
        }
        removedQuestionIds.add(questionId)
        citedIds.add(questionId)
      }
      const hasGroupFinding = pageOnlyFindings.length > 0
      const submittedHeadIds = new Set(args.questions.map(question => question.headElementId))
      const removedAndSubmittedIds = [...removedQuestionIds].filter(id => submittedHeadIds.has(id as string))
      if (removedAndSubmittedIds.length > 0) {
        return Promise.resolve(`REJECTED\nremoved crops must not also be submitted as questions: ${removedAndSubmittedIds.join(', ')}`)
      }
      const boundaryDraftArgs: BoundaryDraft = {
        headConvention: args.headConvention,
        questions: args.questions,
        ...(args.excludedElementIds === undefined ? {} : { excludedElementIds: args.excludedElementIds }),
        ...(args.nonQuestionHeadElementIds === undefined
          ? {}
          : { nonQuestionHeadElementIds: args.nonQuestionHeadElementIds }),
        ...(args.retainedImageElementIds === undefined
          ? {}
          : { retainedImageElementIds: args.retainedImageElementIds }),
        ...(args.stopBeforeElementId === undefined ? {} : { stopBeforeElementId: args.stopBeforeElementId }),
      }
      const validationDraft: BoundaryDraft = hasGroupFinding
        ? boundaryDraftArgs
        : {
          ...boundaryDraftArgs,
          questions: [
            ...args.questions,
            ...request.questions
              .filter(question => !submittedHeadIds.has(question.sourceHeadId as string)
                && !removedQuestionIds.has(question.sourceHeadId))
              .map(question => ({ headElementId: question.sourceHeadId as string })),
          ],
        }
      const validated = validateBoundaryDraft(
        validationDraft,
        elements,
        request.pages,
        request.padding,
        config.maxSegmentedQuestions,
        hasGroupFinding ? new Set(possibleQuestionHeadIds(elements)) : new Set(),
        hasGroupFinding ? new Set(imageElementIds(elements)) : new Set(),
        config.maxQuestionAutoOwnedGapRatio,
      )
      if (validated.referenceErrors.length === 0) {
        state.revisionSubmissions += 1
        if (state.revisionSubmissions > config.maxQuestionBoundarySubmissions) {
          return Promise.resolve('REJECTED\nboundary submission limit reached')
        }
      }
      if (validated.questions === undefined) {
        return Promise.resolve([
          'REJECTED',
          ...(validated.referenceErrors.length === 0
            ? []
            : ['invalid or duplicate element references do not consume the complete-draft submission limit']),
          ...validated.errors,
        ].join('\n'))
      }
      const corePages = new Set(request.corePageIndexes)
      const submittedQuestions = validated.questions
        .filter(question => corePages.has(question.headPageIndex))
        .map((question, index) => ({ ...question, questionNo: index + 1, groupIndex: request.groupIndex }))
      if (submittedQuestions.length === 0 && !hasGroupFinding && removedQuestionIds.size === 0) {
        return Promise.resolve('REJECTED\ncrop-only corrections contain no question head on a core page')
      }
      const validatedById = new Map(submittedQuestions.map(question => [question.sourceHeadId, question] as const))
      const patchById = new Map(args.questions.map(question => [question.headElementId, question] as const))
      const elementById = new Map(elements.map(element => [element.id as string, element] as const))
      const currentSelected = request.questions.flatMap((question): SelectedQuestion[] => {
        const head = elementById.get(question.sourceHeadId)
        return head === undefined ? [] : [{ head, additional: [], verticalRegionEdits: [] }]
      })
      const submittedById = new Map<TeacherQuestionLayoutElementId, TeacherSegmentedQuestion>()
      for (const [id, patch] of patchById) {
        const current = currentById.get(id as TeacherQuestionLayoutElementId)
        const validatedQuestion = validatedById.get(id as TeacherQuestionLayoutElementId)
        if (validatedQuestion === undefined) continue
        let correction = validatedQuestion
        const preservesExistingBoundary = current !== undefined
          && patch.stopBeforeElementId === undefined
          && validationDraft.stopBeforeElementId === undefined
          && (validationDraft.excludedElementIds?.length ?? 0) === 0
          && (validationDraft.nonQuestionHeadElementIds?.length ?? 0) === 0
          && (validationDraft.retainedImageElementIds?.length ?? 0) === 0
          && ((patch.additionalElementIds?.length ?? 0) > 0 || (patch.verticalRegionEdits?.length ?? 0) > 0)
        if (preservesExistingBoundary) {
          correction = (patch.additionalElementIds?.length ?? 0) > 0
            ? extendQuestionWithAdditionalElements(current, patch.additionalElementIds ?? [], elements, request.padding)
            : current
          if ((patch.verticalRegionEdits?.length ?? 0) > 0) {
            const selectedQuestion = currentSelected.find(item => item.head.id === current.sourceHeadId)
            if (selectedQuestion === undefined) {
              return Promise.resolve(`REJECTED\ncrop-only correction references missing current head ${String(current.sourceHeadId)}`)
            }
            const edited = applyVerticalRegionEdits(
              correction.regions,
              patch.verticalRegionEdits ?? [],
              selectedQuestion,
              currentSelected,
              request.pages,
            )
            if (edited.errors.length > 0) {
              return Promise.resolve(['REJECTED', ...edited.errors].join('\n'))
            }
            correction = { ...correction, regions: edited.regions }
          }
        }
        submittedById.set(correction.sourceHeadId, correction)
      }
      let questions: readonly TeacherSegmentedQuestion[]
      if (hasGroupFinding) {
        const retainedRemovedIds = [...removedQuestionIds].filter(id => validatedById.has(id))
        if (retainedRemovedIds.length > 0) {
          return Promise.resolve(`REJECTED\ncomplete-group draft retains removed crop heads: ${retainedRemovedIds.join(', ')}`)
        }
        questions = submittedQuestions
      } else {
        const unknownIds = [...submittedById.keys()].filter(id => !currentById.has(id))
        if (unknownIds.length > 0) {
          return Promise.resolve(`REJECTED\ncrop-only corrections contain unknown question heads: ${unknownIds.join(', ')}`)
        }
        const missingCitedIds = [...citedIds].filter(id => (
          !removedQuestionIds.has(id) && !submittedById.has(id)
        ))
        if (missingCitedIds.length > 0) {
          return Promise.resolve(`REJECTED\ncrop-only corrections omit cited question heads: ${missingCitedIds.join(', ')}`)
        }
        questions = request.questions.filter(question => !removedQuestionIds.has(question.sourceHeadId)).map((question, index) => {
          const correction = submittedById.get(question.sourceHeadId)
          return correction === undefined
            ? { ...question, questionNo: index + 1 }
            : { ...correction, questionNo: index + 1, groupIndex: request.groupIndex }
        })
      }
      const correctedById = new Map(questions.map(question => [question.sourceHeadId, question] as const))
      const changedIds = new Set<TeacherQuestionLayoutElementId>()
      for (const id of new Set([...currentById.keys(), ...correctedById.keys()])) {
        const current = currentById.get(id)
        const corrected = correctedById.get(id)
        if (current === undefined || corrected === undefined
          || questionGeometryFingerprint(current) !== questionGeometryFingerprint(corrected)) {
          changedIds.add(id)
        }
      }
      if (!hasGroupFinding) {
        const uncitedChangedIds = [...changedIds].filter(id => !citedIds.has(id))
        if (uncitedChangedIds.length > 0) {
          return Promise.resolve(`REJECTED\ncrop-only corrections modify uncited question heads: ${uncitedChangedIds.join(', ')}`)
        }
      }
      const unchangedCitedIds = [...citedIds].filter(id => !changedIds.has(id))
      if (changedIds.size === 0) {
        return Promise.resolve('REJECTED\nthe corrected draft changes no rendered crop geometry; move each stop-before boundary past the missing content')
      }
      if (unchangedCitedIds.length > 0) {
        return Promise.resolve(`REJECTED\nthe corrected draft leaves cited defective crop geometry unchanged: ${unchangedCitedIds.join(', ')}`)
      }
      const token = randomUUID()
      accepted.set(token, {
        token,
        decision: 'revised',
        affectedQuestionIds: [...new Set([...changedIds, ...citedIds])],
        questions,
      })
      return Promise.resolve(`ACCEPTED\nvalidationToken=${token}`)
    },
  })
}

/**
 * Run semantic question-boundary detection in one short-lived agent loop.
 * @param ctx - Host context carrying agent, tool, subagent, and model services.
 * @param request - Selected OCR pages from the browser-held PDF.
 * @param config - Input, output, retry, and wall-clock limits.
 * @returns validated page crop regions or a stable failure.
 */
export async function segmentQuestionsWithAgent(
  ctx: Context,
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
): Promise<TeacherQuestionSegmentationAgentResult> {
  const requestError = validateRequest(request, config)
  if (requestError !== undefined) return rejected('invalid-request', requestError)
  const agents = ctx.get('agents')
  const subagents = ctx.get('subagents')
  const modelConfig = ctx.get('agentDefaultModel')
  const tools = ctx.get('tools')
  const llm = ctx.get('llm')
  if (agents === undefined || subagents === undefined || modelConfig === undefined || tools === undefined || llm === undefined) {
    return rejected('tool-model-unavailable', 'tool-model agent services are unavailable')
  }
  const parent = agents.get(request.parentSessionId)
  if (parent === undefined) return rejected('session-unavailable', 'the current session is not live')

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error('question segmentation timed out'))
  }, config.questionSegmentationAgentTimeoutMs)
  const elements = indexElements(request.pages)
  const chunks = sourceChunks(elements, config.maxQuestionSourceChunkCharacters)
  const headCandidateIds = possibleQuestionHeadIds(elements)
  const firstAnswerHint = elements.find(element => (
    (element.element.type === 'text' || element.element.type === 'equation')
      && answerHeadingPattern.test(element.element.text)
  ))
  const semanticHints = {
    possibleQuestionHeadIds: headCandidateIds,
    imageElementIds: imageElementIds(elements),
    possibleSectionHeadingIds: elements
      .filter(element => element.ordinal < (firstAnswerHint?.ordinal ?? elements.length)
        && sectionHeadingPattern.test(element.element.text))
      .map(element => element.id),
    possibleAnswerHeadingIds: firstAnswerHint === undefined ? [] : [firstAnswerHint.id],
  }
  const inspectedChunks = new Set<number>()
  const inspectedPreviews = new Set<string>()
  const sourceToolName = `question_layout_${randomUUID().replaceAll('-', '')}`
  const previewToolName = `question_page_preview_${randomUUID().replaceAll('-', '')}`
  const submissionToolName = `submit_question_boundaries_${randomUUID().replaceAll('-', '')}`
  const accepted = new Map<string, AcceptedBoundaryDraft>()
  const submissionState: BoundarySubmissionState = { submissions: 0, seenDrafts: new Set() }
  let run: SubagentRun | undefined
  let disposeSourceTool: (() => Promise<void>) | undefined
  let disposePreviewTool: (() => Promise<void>) | undefined
  let disposeSubmissionTool: (() => Promise<void>) | undefined
  let outcome: TeacherQuestionSegmentationAgentResult
  try {
    const selected = modelConfig.currentToolSelection()
    const modelInfo = await llm.resolveModelInfo(selected.provider, selected.model, controller.signal)
    const previewSources = pagePreviewSources(request.pagePreviews ?? [])
    const attachments = ctx.get('attachments')
    if (previewSources.length > 0 && modelInfo.inputModalities?.includes('image') !== true) {
      throw new QuestionSegmentationVisionError('the configured tool model does not declare image input')
    }
    if (previewSources.length > 0 && attachments === undefined) {
      throw new QuestionSegmentationVisionError('image attachment services are unavailable')
    }
    disposeSourceTool = ctx.effect(
      () => tools.register(sourceTool(sourceToolName, chunks, inspectedChunks)),
      'teacher-workbench: question layout source',
    )
    if (previewSources.length > 0 && attachments !== undefined) {
      const maxImages = Math.min(
        config.maxQuestionVisionImagesPerToolCall,
        attachments.imageLimits.maxImagesPerMessage,
      )
      if (maxImages < 1) throw new QuestionSegmentationVisionError('the attachment provider admits no images per message')
      disposePreviewTool = ctx.effect(
        () => tools.register(visionImageTool(
          previewToolName,
          previewSources,
          inspectedPreviews,
          maxImages,
          source => attachments.saveImage(source),
        )),
        'teacher-workbench: question page previews',
      )
    }
    disposeSubmissionTool = ctx.effect(
      () => tools.register(submissionTool(
        submissionToolName,
        request,
        config,
        elements,
        accepted,
        submissionState,
        () => inspectedChunks.size === chunks.length && inspectedPreviews.size === previewSources.length,
      )),
      'teacher-workbench: question boundary submission',
    )
    outcome = rejected('invalid-output', 'the agent did not produce a Host-accepted boundary draft; retry the cut')
    for (let agentRun = 0; agentRun < config.maxQuestionBoundaryAgentRuns; agentRun += 1) {
      inspectedChunks.clear()
      inspectedPreviews.clear()
      accepted.clear()
      submissionState.submissions = 0
      submissionState.seenDrafts.clear()
      const recoveryInstruction = agentRun === 0
        ? ''
        : ' A previous child ended without returning a token accepted in that run. Do not call structured_output until the boundary tool returns ACCEPTED and its exact validationToken.'
      const prompt: SubagentStartRequest['prompt'] = [{
        type: 'text',
        text: `Segment the selected PDF pages into complete top-level questions.${recoveryInstruction} Inspect every exact sourceChunkIndex through ${sourceToolName}. ${previewSources.length === 0 ? '' : `Inspect every previewId through ${previewToolName}, requesting no more than ${String(config.maxQuestionVisionImagesPerToolCall)} ids per call. `}Infer this source's own question convention from all OCR and visual evidence, then submit one complete draft to ${submissionToolName}. First apply the answer-obligation test to every proposed head: identify what the learner is visibly asked to choose, fill, calculate, explain, prove, draw, judge, or otherwise produce. A number, topic label, definition, property, formula, method step, theory summary, worked solution, or answer explanation does not create a question by itself. A worked example that opens with a problem stem and asks for a value, choice, proof, or other response still contains an independent question: select that stem and stop before its printed answer or analysis. Only explanatory or worked-solution prose without a learner response demand is non-question content. A processing group may validly contain zero questions; submit an empty questions array and classify every candidate instead of inventing a task. semanticHints are fallible recall aids. Every possibleQuestionHeadId requires one explicit decision: use it as headElementId, put it in nonQuestionHeadElementIds when it is not an independent head but should remain eligible content, or put it in excludedElementIds only when its pixels must be removed. A bracketed source label or citation without its own stem, options, subparts, table, or figure is not an independent question and belongs in nonQuestionHeadElementIds. Every imageElementId also requires an individual preview-backed decision: retain a question diagram in retainedImageElementIds, assign it through exactly one question's additionalElementIds when automatic ownership would be wrong, or exclude only visually confirmed furniture. Do not classify an id range as one role merely because its ids are adjacent. Never silently ignore a candidate or force it into a question role. A section title, answer heading, explanation, footer, or other transition after a complete question is outside that question. When such material starts before the next top-level question, stop the preceding crop at its first OCR element; merely keeping the next question head as the boundary would include the intervening material. A detached block after a large blank gap is not automatically part of the final question: explicitly assign a semantically related distant figure through additionalElementIds, and stop or exclude unrelated answers, anti-piracy copy, watermarks, and later-paper material. stopBeforeElementId is exclusive: it names that first OCR element outside a question, never the final element inside it. Usually omit it and let the next question head stop the crop; set it when unrelated material begins earlier. The root stopBeforeElementId follows the same exclusive rule after the final question. Use additionalElementIds only for unmistakable content left outside its owner by OCR order, and never also name one as stopBeforeElementId. After Host acceptance, call structured_output with only the validationToken.\n${JSON.stringify({ fileName: request.fileName, selectedPages: request.pages.map(page => page.pageIndex), elementCount: elements.length, sourceChunkIndexes: chunks.map((_chunk, index) => index), previewIds: previewSources.map(source => source.id), semanticHints })}`,
      }]
      run = await subagents.start('spawn', {
        label: `Question segmentation: ${request.fileName}${agentRun === 0 ? '' : ` (recovery ${String(agentRun + 1)})`}`,
        prompt,
        parent,
        signal: controller.signal,
        agentOptions: selected,
        outputSchema: questionSegmentationOutputSchema,
        toolFilter: { allow: [sourceToolName, ...(previewSources.length === 0 ? [] : [previewToolName]), submissionToolName] },
        persona: QUESTION_SEGMENTATION_SKILL.content,
      })
      const result = await run.result
      const completedRun = run
      run = undefined
      await completedRun.dispose()
      if (controller.signal.aborted) {
        outcome = rejected('timed-out', 'the tool model did not finish before the deadline')
        break
      }
      if (result.stopReason !== 'completed') {
        outcome = rejected('model-failed', `the tool model stopped with ${result.stopReason}`)
        continue
      }
      const parsed = structuredOutputSchema.safeParse(result.structured)
      const draft = parsed.success ? accepted.get(parsed.data.validationToken) : undefined
      if (!parsed.success || draft === undefined) {
        outcome = rejected('invalid-output', accepted.size === 0
          ? 'the agent did not produce a Host-accepted boundary draft; retry the cut'
          : parsed.success
            ? 'the final token does not reference an accepted boundary draft from this run'
            : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
        continue
      }
      outcome = { ok: true, value: { questions: draft.questions } }
      break
    }
  } catch (error) {
    outcome = error instanceof QuestionSegmentationVisionError
      ? rejected('vision-unavailable', error.message)
      : controller.signal.aborted
        ? rejected('timed-out', 'the tool model did not finish before the deadline')
        : rejected('model-failed', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timeout)
  }
  if (run !== undefined) {
    try {
      await run.dispose()
    } catch (error) {
      if (outcome.ok) outcome = rejected('model-failed', error instanceof Error ? error.message : String(error))
    }
  }
  if (disposeSourceTool !== undefined) await disposeSourceTool()
  if (disposePreviewTool !== undefined) await disposePreviewTool()
  if (disposeSubmissionTool !== undefined) await disposeSubmissionTool()
  return outcome
}

/**
 * Visually inspect every preliminary question crop and optionally replace its processing-group boundaries.
 * @param ctx - Host context carrying agent, attachment, tool, subagent, and model services.
 * @param request - Preliminary crops plus their OCR and rendered source-page evidence.
 * @param config - Input, retry, image-batch, and wall-clock limits.
 * @returns accepted preliminary regions or one Host-validated replacement group.
 */
export async function reviewQuestionCropsWithAgent(
  ctx: Context,
  request: TeacherQuestionCropReviewRequest,
  config: TeacherQuestionSegmentationAgentConfig,
): Promise<TeacherQuestionCropReviewResult> {
  const requestError = validateCropReviewRequest(request, config)
  if (requestError !== undefined) return rejected('invalid-request', requestError)
  const agents = ctx.get('agents')
  const subagents = ctx.get('subagents')
  const modelConfig = ctx.get('agentDefaultModel')
  const tools = ctx.get('tools')
  const llm = ctx.get('llm')
  const attachments = ctx.get('attachments')
  if (agents === undefined || subagents === undefined || modelConfig === undefined || tools === undefined
    || llm === undefined || attachments === undefined) {
    return rejected('tool-model-unavailable', 'visual question-review agent services are unavailable')
  }
  const parent = agents.get(request.parentSessionId)
  if (parent === undefined) return rejected('session-unavailable', 'the current session is not live')

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error('question crop review timed out'))
  }, config.questionSegmentationAgentTimeoutMs)
  const elements = indexElements(request.pages)
  const chunks = sourceChunks(elements, config.maxQuestionSourceChunkCharacters)
  const pageSources = pagePreviewSources(request.pagePreviews)
  const cropSources = cropPreviewSources(request.crops, request.questions, elements)
  const expectedCropIds = new Set(cropSources.map(source => source.id))
  const expectedPageIds = new Set(pageSources.map(source => source.id))
  const expectedImageIds = new Set([...expectedPageIds, ...expectedCropIds])
  const inspectedImageIds = new Set<string>()
  const inspectedChunks = new Set<number>()
  const reviewState: CropReviewState = {
    findingSubmissions: 0,
    revisionSubmissions: 0,
    draftFindings: new Map(),
    draftVerifications: new Map(),
    seenRevisionDrafts: new Set(),
  }
  const cropQuestionIdByPreviewId: ReadonlyMap<string, TeacherQuestionLayoutElementId> = new Map(request.questions.map(question => (
    [`crop-${String(question.sourceHeadId)}`, question.sourceHeadId] as const
  )))
  const sourceToolName = `question_review_layout_${randomUUID().replaceAll('-', '')}`
  const pageToolName = `question_review_page_${randomUUID().replaceAll('-', '')}`
  const cropToolName = `question_review_crop_${randomUUID().replaceAll('-', '')}`
  const findingsToolName = `submit_question_crop_findings_${randomUUID().replaceAll('-', '')}`
  const reviseToolName = `revise_question_boundaries_${randomUUID().replaceAll('-', '')}`
  const accepted = new Map<string, AcceptedCropReview>()
  let run: SubagentRun | undefined
  let disposeSourceTool: (() => Promise<void>) | undefined
  let disposePageTool: (() => Promise<void>) | undefined
  let disposeCropTool: (() => Promise<void>) | undefined
  let disposeFindingsTool: (() => Promise<void>) | undefined
  let disposeReviseTool: (() => Promise<void>) | undefined
  let outcome: TeacherQuestionCropReviewResult
  try {
    const selected = modelConfig.currentToolSelection()
    const modelInfo = await llm.resolveModelInfo(selected.provider, selected.model, controller.signal)
    if (modelInfo.inputModalities?.includes('image') !== true) {
      throw new QuestionSegmentationVisionError('the configured tool model does not declare image input')
    }
    const maxImages = Math.min(
      config.maxQuestionVisionImagesPerToolCall,
      attachments.imageLimits.maxImagesPerMessage,
    )
    if (maxImages < 1) throw new QuestionSegmentationVisionError('the attachment provider admits no images per message')
    disposeSourceTool = ctx.effect(
      () => tools.register(sourceTool(
        sourceToolName,
        chunks,
        inspectedChunks,
        () => (reviewState.findings?.length ?? 0) > 0
          ? undefined
          : 'submit visible crop defects before inspecting OCR geometry',
      )),
      'teacher-workbench: question review layout source',
    )
    disposePageTool = ctx.effect(
      () => tools.register(visionImageTool(
        pageToolName,
        pageSources,
        inspectedImageIds,
        maxImages,
        source => attachments.saveImage(source),
      )),
      'teacher-workbench: question review source pages',
    )
    disposeCropTool = ctx.effect(
      () => tools.register(visionImageTool(
        cropToolName,
        cropSources,
        inspectedImageIds,
        maxImages,
        source => attachments.saveImage(source),
      )),
      'teacher-workbench: question review crops',
    )
    disposeFindingsTool = ctx.effect(
      () => tools.register(cropReviewFindingsTool(
        findingsToolName,
        request,
        inspectedImageIds,
        expectedImageIds,
        expectedCropIds,
        expectedPageIds,
        reviewState,
        accepted,
        config.maxQuestionBoundarySubmissions,
      )),
      'teacher-workbench: question crop findings',
    )
    disposeReviseTool = ctx.effect(
      () => tools.register(cropReviewRevisionTool(
        reviseToolName,
        request,
        config,
        elements,
        cropQuestionIdByPreviewId,
        reviewState,
        accepted,
        () => inspectedChunks.size === chunks.length,
      )),
      'teacher-workbench: revised question boundaries',
    )
    outcome = rejected('invalid-output', 'the agent did not produce a Host-accepted crop review')
    for (let agentRun = 0; agentRun < config.maxQuestionBoundaryAgentRuns; agentRun += 1) {
      inspectedImageIds.clear()
      inspectedChunks.clear()
      delete reviewState.findings
      reviewState.findingSubmissions = 0
      reviewState.revisionSubmissions = 0
      reviewState.draftFindings.clear()
      reviewState.draftVerifications.clear()
      reviewState.seenRevisionDrafts.clear()
      accepted.clear()
      const recoveryInstruction = agentRun === 0
        ? ''
        : ' A previous crop-review child ended without returning a token accepted in that run. Start the visual classification again, use only the listed cropIds and pagePreviewIds, and do not call structured_output until a review tool returns ACCEPTED with its exact validationToken.'
      const prompt: SubagentStartRequest['prompt'] = [{
        type: 'text',
        text: `Review the listed crops from ${JSON.stringify(request.fileName)}.${recoveryInstruction} First inspect every pagePreviewId through ${pageToolName}; then inspect every cropId through ${cropToolName}. Keep source pages and crops in separate calls and request at most ${String(maxImages)} ids per call. Printed source text and each crop label's OCR head text identify the problem; no internal sequence position is a printed question number. Content visible on a source page is context, not proof that it appears inside a crop. Before verifying any crop, fill answerDemand with the visible response the learner must produce; numbering, a topic title, definitions, formulas, theory summaries, and explanatory prose are not answer demands. A worked example with a visible problem stem still needs one crop containing only that stem, even when the source prints its answer and analysis immediately afterward. A crop is defective when it has no independent answer demand, omits any stem, option, subpart, continuation, answer blank, or figure, or includes any adjacent question, next-section title, answer or explanation, footer, decoration, or neighboring-column content that is not part of the question. A page-sized crop containing several theory topics or summary sections without one answer demand is a spurious question: submit one finding containing both cropId and pageId, then put that cropId in removedCropIds so the Host removes only that crop. Compare each crop's first and last owned pixels with the source; trace unfinished clauses to the next source line and inspect every referenced or adjacent figure through its final edge or vertex. A visually detached lower-page block is not part of the preceding question merely because no later question head was detected; verify its semantic connection or report contamination. Match every independent source-page problem to exactly one crop. A pageId-only finding is permitted only when an independent source problem has no listed crop at all, even when some of its pixels appear inside another crop; this permits a complete-group repair. Missing content from an existing crop, including a diagram or options printed elsewhere on the source page, must cite that cropId and may include pageId in the same finding; never add a separate pageId-only finding for it. If content missing from one crop appears in another, cite both cropIds as separate findings so both local boundaries can change. Record one classification at a time through ${findingsToolName}: use cropId, answerDemand, and evidence for a complete crop; use issue, evidence, and cropId or pageId for a defect. After every cropId has exactly one classification and any missing source-page problem is recorded, call ${findingsToolName} with finalize=true; the final classification record may include finalize=true in the same call. The tool also accepts complete verifiedCrops and findings arrays when you deliberately submit the entire classification in one call. When cropIds is empty, inspect all source pages, then finalize immediately only if they contain no independent problem; otherwise record a pageId-only finding and add the missing questions through complete-group correction. A later one-record call replaces an earlier classification for the same crop before finalization. If OCR inspection later proves a finalized observation was not a defect, replace the complete classifications before submitting a correction. If defects are recorded, inspect each exact sourceChunkIndex through ${sourceToolName}, then submit corrections to ${reviseToolName}. For any finding that cites a cropId, submit only the cited question heads and the Host will merge them into the unchanged group even when pageId is also present as evidence; the Host rejects changes to uncited questions. Put every spurious crop in removedCropIds; its combined cropId and pageId finding authorizes local deletion without a complete-group draft. Use a complete processing-group draft only for a pageId-only finding that describes a wholly missing question, and explicitly classify every possible question-head candidate and image element in that replacement. stopBeforeElementId is exclusive: it names the first OCR element outside a question, including an intervening section title or answer heading, never its last option, subpart, continuation line, or figure. When visible pixels have no usable OCR element, use verticalRegionEdits with exact pageIndex and top or bottom in the OCR page units reported by the layout tool; do not invent an element id for whitespace or a drawn line. Increasing top removes pixels from the crop top; decreasing top adds them; increasing bottom adds bottom pixels. Coordinate-only edits apply to the existing question region and cannot change left, right, rightLimit, or unrelated boundaries. The Host rejects a correction that crosses another question head or leaves any cited crop geometry unchanged. After acceptance call structured_output immediately without reopening images.\n${JSON.stringify({
          groupIndex: request.groupIndex,
          recutAttempt: request.recutAttempt,
          fullGroupCoverage: request.reviewQuestionIds.length === request.questions.length,
          corePageIndexes: request.corePageIndexes,
          cropIds: cropSources.map(source => source.id),
          pagePreviewIds: pageSources.map(source => source.id),
          sourceChunkIndexes: chunks.map((_chunk, index) => index),
          semanticHints: { possibleQuestionHeadIds: possibleQuestionHeadIds(elements) },
          preliminaryQuestions: request.questions.map(question => ({
            sourceHeadId: question.sourceHeadId,
            headText: elements.find(element => element.id === question.sourceHeadId)?.element.text.slice(0, 160) ?? '',
            headPageIndex: question.headPageIndex,
            regions: question.regions,
          })),
        })}`,
      }]
      run = await subagents.start('spawn', {
        label: `Question crop review: ${request.fileName} group ${String(request.groupIndex + 1)}${agentRun === 0 ? '' : ` (recovery ${String(agentRun + 1)})`}`,
        prompt,
        parent,
        signal: controller.signal,
        agentOptions: selected,
        outputSchema: questionSegmentationOutputSchema,
        toolFilter: { allow: [sourceToolName, pageToolName, cropToolName, findingsToolName, reviseToolName] },
        persona: QUESTION_CROP_REVIEW_SKILL.content,
      })
      const result = await run.result
      const completedRun = run
      run = undefined
      await completedRun.dispose()
      if (controller.signal.aborted) {
        outcome = rejected('timed-out', 'the tool model did not finish crop review before the deadline')
      } else if (result.stopReason !== 'completed') {
        outcome = rejected('model-failed', `the crop-review model stopped with ${result.stopReason}`)
      } else {
        const parsed = structuredOutputSchema.safeParse(result.structured)
        const review = parsed.success ? accepted.get(parsed.data.validationToken) : undefined
        if (!parsed.success || review === undefined) {
          const findings = recordedCropReviewFindings(reviewState)
          const citedIds = new Set(findings.flatMap((finding) => {
            if (finding.cropId === undefined) return []
            const id = cropQuestionIdByPreviewId.get(finding.cropId)
            return id === undefined ? [] : [id]
          }))
          outcome = findings.length > 0
            ? {
              ok: true,
              value: {
                decision: 'unresolved',
                affectedQuestionIds: citedIds.size > 0 ? [...citedIds] : request.reviewQuestionIds,
                questions: request.questions,
              },
            }
            : rejected('invalid-output', accepted.size === 0
              ? 'the agent did not produce a Host-accepted crop review'
              : 'the final token does not reference an accepted crop review from this run')
        } else {
          outcome = {
            ok: true,
            value: {
              decision: review.decision,
              affectedQuestionIds: review.affectedQuestionIds,
              questions: review.questions,
            },
          }
        }
      }
      if (controller.signal.aborted || (outcome.ok && outcome.value.decision !== 'unresolved')) break
    }
  } catch (error) {
    outcome = error instanceof QuestionSegmentationVisionError
      ? rejected('vision-unavailable', error.message)
      : controller.signal.aborted
        ? rejected('timed-out', 'the tool model did not finish crop review before the deadline')
        : rejected('model-failed', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timeout)
  }
  if (run !== undefined) {
    try {
      await run.dispose()
    } catch (error) {
      if (outcome.ok) outcome = rejected('model-failed', error instanceof Error ? error.message : String(error))
    }
  }
  if (disposeSourceTool !== undefined) await disposeSourceTool()
  if (disposePageTool !== undefined) await disposePageTool()
  if (disposeCropTool !== undefined) await disposeCropTool()
  if (disposeFindingsTool !== undefined) await disposeFindingsTool()
  if (disposeReviseTool !== undefined) await disposeReviseTool()
  return outcome
}
