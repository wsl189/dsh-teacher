/** Agent-loop question-boundary detection over provider-neutral OCR geometry. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { ToolModelSelection } from '@deepseek-ai/dsh-agent-default-model'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subagent'
import { defineTool, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { QUESTION_SEGMENTATION_SKILL } from './question-segmentation-skill.ts'
import type {
  TeacherQuestionLayoutElement,
  TeacherQuestionLayoutElementId,
  TeacherQuestionLayoutPage,
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
    readonly additionalElementIds?: readonly string[]
  }[]
  readonly excludedElementIds?: readonly string[]
  readonly endElementId?: string
}

interface AcceptedBoundaryDraft {
  readonly token: string
  readonly questions: readonly TeacherSegmentedQuestion[]
}

interface BoundaryValidation {
  readonly errors: readonly string[]
  readonly referenceErrors: readonly string[]
  readonly questions?: readonly TeacherSegmentedQuestion[]
}

interface SelectedQuestion {
  readonly head: IndexedElement
  readonly additional: readonly IndexedElement[]
}

const structuredOutputSchema = z.object({ validationToken: z.string().min(1).max(128) }).strict()
const answerHeadingPattern = /^\s*(?:.{0,80}(?:试卷|作业|练习)\s*)?(?:参考)?答案(?:与解析|及解析|及评分标准|与评分标准)?\s*[:：]?\s*$/u
const sectionHeadingPattern = new RegExp([
  '^\\s*(?:',
  '[一二三四五六七八九十]+\\s*[、.．]\\s*(?:(?:单项|多项)?选择|填空|解答|计算|证明|判断|作图|应用)',
  '|[0-9０-９]+(?:\\s*[.．]\\s*[0-9０-９]+){2,}\\s*\\S',
  '|(?:part|section)\\s+[A-Z0-9]+',
  ')',
].join(''), 'iu')
const questionNumberPattern = '[0-9０-９一二三四五六七八九十百]+'
const taggedQuestionHeadPattern = new RegExp(
  `^\\s*(?:[\\[【「『(（]\\s*题\\s*${questionNumberPattern}|题\\s*${questionNumberPattern}(?=\\s*(?:[\\]】」』)）]|[（(:：]|$))|第\\s*${questionNumberPattern}\\s*题(?=\\s*(?:[（(:：、.．]|$)))`,
  'u',
)
const numberedQuestionHeadPattern = /^\s*(?:[0-9０-９]\s*)+[.．、](?!\s*[0-9０-９]\s*[.．])\s*\S/u
const leadingArabicQuestionNumberPattern = /^\s*((?:[0-9０-９]\s*)+)[.．、]/u

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

function rejected(code: TeacherQuestionSegmentErrorCode, message: string): TeacherQuestionSegmentationAgentResult {
  return { ok: false, error: { code, message } }
}

function lowLatencyToolSelection(
  selection: ToolModelSelection,
  info: LlmResolvedModelInfo,
): ToolModelSelection {
  const effort = info.reasoning?.efforts.find(candidate => candidate.id === 'off')
    ?? info.reasoning?.efforts.find(candidate => candidate.id === 'low')
  return effort === undefined ? selection : { ...selection, reasoningEffort: effort.id }
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
  return elements > config.maxQuestionLayoutElements
    ? `selected layout exceeds ${String(config.maxQuestionLayoutElements)} OCR elements`
    : undefined
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

function cropRegions(
  elements: readonly IndexedElement[],
  selectedPages: readonly TeacherQuestionLayoutPage[],
  padding: number,
  head: IndexedElement,
  cropStops: readonly IndexedElement[],
  excluded: ReadonlySet<string>,
) {
  const ownedIds = new Set(elements.map(item => item.id))
  const allElements = indexElements(selectedPages)
  return selectedPages.flatMap((page) => {
    const owned = elements.filter(item => item.page === page)
    if (owned.length === 0) return []
    const others = allElements.filter(item => item.page === page && !ownedIds.has(item.id))
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
    const top = Math.max(0, ownedTop - padding, previousBottom)
    const right = Math.min(page.width, ownedRight + padding, nextLeft)
    const questionTop = head.page === page ? head.element.bbox[1] : ownedTop
    const hardNextTop = Math.min(page.height, ...cropStops
      .filter(item => item.page === page
        && item.id !== head.id
        && item.element.bbox[1] > questionTop
        && item.element.bbox[2] > left
        && item.element.bbox[0] < right)
      .map(item => item.element.bbox[1]))
    const bottom = Math.min(page.height, ownedBottom + padding, nextTop, hardNextTop)
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
}

function expandSectionExclusions(
  elements: readonly IndexedElement[],
  questions: readonly SelectedQuestion[],
  declared: ReadonlySet<string>,
): Set<string> {
  const expanded = new Set(declared)
  for (const heading of elements) {
    if (!sectionHeadingPattern.test(heading.element.text)) continue
    expanded.add(heading.id)
    const nextHead = questions.find(question => question.head.ordinal > heading.ordinal)?.head
    if (nextHead === undefined) continue
    for (const element of elements) {
      if (element.ordinal > heading.ordinal && element.ordinal < nextHead.ordinal) {
        expanded.add(element.id)
      }
    }
  }
  for (const page of new Set(elements.map(element => element.page))) {
    const firstPageQuestion = questions.find(question => question.head.page === page)
    if (firstPageQuestion === undefined || leadingArabicQuestionNumber(firstPageQuestion.head.element.text) !== 1) continue
    const previousQuestion = questions.findLast(question => question.head.ordinal < firstPageQuestion.head.ordinal)
    if (previousQuestion === undefined
      || previousQuestion.head.page === page
      || (leadingArabicQuestionNumber(previousQuestion.head.element.text) ?? 0) <= 1) continue
    const hasSectionHeading = elements.some(element => (
      element.page === page
        && element.ordinal < firstPageQuestion.head.ordinal
        && sectionHeadingPattern.test(element.element.text)
    ))
    if (!hasSectionHeading) continue
    for (const element of elements) {
      if (element.page === page && element.ordinal < firstPageQuestion.head.ordinal) expanded.add(element.id)
    }
  }
  return expanded
}

function expandRepeatedPageDecorations(
  elements: readonly IndexedElement[],
  expanded: Set<string>,
): void {
  const candidatesByLabel = new Map<string, IndexedElement[]>()
  for (const element of elements) {
    if (element.element.type !== 'text' && element.element.type !== 'equation') continue
    const center = horizontalCenter(element) / element.page.width
    const label = canonicalLabel(element.element.text)
    if (center < 0.3
      || center > 0.7
      || element.element.bbox[1] / element.page.height < 0.45
      || (element.element.bbox[3] - element.element.bbox[1]) / element.page.height < 0.035
      || label.length < 2) continue
    const candidates = candidatesByLabel.get(label) ?? []
    candidates.push(element)
    candidatesByLabel.set(label, candidates)
  }
  for (const candidates of candidatesByLabel.values()) {
    if (new Set(candidates.map(element => element.page.pageIndex)).size < 3) continue
    for (const element of candidates) {
      const matchingPages = new Set(candidates
        .filter(candidate => normalizedBoxesNear(element, candidate))
        .map(candidate => candidate.page.pageIndex))
      if (matchingPages.size >= 3) expanded.add(element.id)
    }
  }
}

function expandDecorativeExclusions(
  elements: readonly IndexedElement[],
  expanded: Set<string>,
): void {
  for (const [index, element] of elements.entries()) {
    if (element.element.type !== 'image'
      || element.element.bbox[0] >= element.page.width / 2
      || element.element.bbox[2] <= element.page.width / 2) continue
    const next = elements[index + 1]
    if (next === undefined
      || next.page !== element.page
      || !expanded.has(next.id)
      || next.element.bbox[1] < element.element.bbox[3]
      || next.element.bbox[2] <= element.element.bbox[0]
      || next.element.bbox[0] >= element.element.bbox[2]) continue
    expanded.add(element.id)
  }
}

function normalizedBoxesNear(left: IndexedElement, right: IndexedElement): boolean {
  const leftBox = left.element.bbox.map((coordinate, index) => (
    coordinate / (index % 2 === 0 ? left.page.width : left.page.height)
  ))
  const rightBox = right.element.bbox.map((coordinate, index) => (
    coordinate / (index % 2 === 0 ? right.page.width : right.page.height)
  ))
  return leftBox.every((coordinate, index) => Math.abs(coordinate - (rightBox[index] ?? Number.POSITIVE_INFINITY)) <= 0.03)
}

function leadingArabicQuestionNumber(text: string): number | undefined {
  const digits = leadingArabicQuestionNumberPattern.exec(text)?.[1]
  if (digits === undefined) return undefined
  const normalized = digits.normalize('NFKC').replaceAll(/\s/gu, '')
  const value = Number(normalized)
  return Number.isSafeInteger(value) ? value : undefined
}

function assignQuestionOwners(
  elements: readonly IndexedElement[],
  selected: readonly SelectedQuestion[],
  end: IndexedElement | undefined,
  excluded: ReadonlySet<string>,
  claimed: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const owners = new Map<string, number>()
  for (const [questionIndex, question] of selected.entries()) {
    const next = selected[questionIndex + 1]?.head ?? end
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

  const selectedById = new Map(selected.map((question, index) => [question.head.id as string, index] as const))
  for (const page of new Set(elements.map(element => element.page))) {
    const pageQuestions = selected.map((question, index) => ({ question, index })).filter(item => item.question.head.page === page)
    const divider = page.width / 2
    const leftQuestions = pageQuestions.filter(item => horizontalCenter(item.question.head) < divider)
    const rightQuestions = pageQuestions.filter(item => horizontalCenter(item.question.head) >= divider)
    if (leftQuestions.length === 0 || rightQuestions.length === 0) continue
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
      if (element.element.bbox[0] < divider && element.element.bbox[2] > divider) {
        owners.delete(id)
        continue
      }
      const laneQuestions = horizontalCenter(element) < divider ? leftQuestions : rightQuestions
      const owner = laneQuestions
        .filter(item => item.question.head.element.bbox[1] <= element.element.bbox[1])
        .sort((left, right) => right.question.head.element.bbox[1] - left.question.head.element.bbox[1])[0]
      if (owner !== undefined) owners.set(id, owner.index)
      else owners.delete(id)
    }
  }
  return owners
}

function horizontalCenter(element: IndexedElement): number {
  return (element.element.bbox[0] + element.element.bbox[2]) / 2
}

function boxesOverlap(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean {
  return left[2] > right[0] && left[0] < right[2] && verticalBoxesOverlap(left, right)
}

function validateBoundaryDraft(
  draft: BoundaryDraft,
  elements: readonly IndexedElement[],
  pages: readonly TeacherQuestionLayoutPage[],
  padding: number,
  maxQuestions: number,
): BoundaryValidation {
  const errors: string[] = []
  const referenceErrors: string[] = []
  if (draft.headConvention.trim() === '') errors.push('headConvention must describe the inferred question-head convention')
  if (draft.headConvention.length > 1_000) errors.push('headConvention exceeds 1000 characters')
  if (draft.questions.length === 0) errors.push('questions must contain at least one top-level question')
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
    if (seenIds.has(question.headElementId)) {
      const error = `${label}.headElementId duplicates an earlier question`
      errors.push(error)
      referenceErrors.push(error)
    }
    seenIds.add(question.headElementId)
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
      if (localIds.has(id)) {
        const error = `${additionalLabel} duplicates an earlier additional element`
        errors.push(error)
        referenceErrors.push(error)
      }
      localIds.add(id)
    }
    selected.push({ head, additional })
  }
  selected.sort((left, right) => left.head.ordinal - right.head.ordinal)
  const end = draft.endElementId === undefined ? undefined : byId.get(draft.endElementId)
  if (draft.endElementId !== undefined && end === undefined) {
    const error = 'endElementId is not present in the inspected source'
    errors.push(error)
    referenceErrors.push(error)
  }
  const lastHead = selected.at(-1)?.head
  if (end !== undefined && lastHead !== undefined && end.ordinal <= lastHead.ordinal) {
    errors.push('endElementId must follow the final question head')
  }
  const answerHeading = lastHead === undefined ? undefined : elements.find(element => (
    element.ordinal > lastHead.ordinal
      && (element.element.type === 'text' || element.element.type === 'equation')
      && answerHeadingPattern.test(element.element.text)
  ))
  const firstHead = selected[0]?.head
  const labelsBeforeQuestions = new Set(firstHead === undefined ? [] : elements
    .filter(element => element.ordinal < firstHead.ordinal && element.element.text.trim().length >= 4)
    .map(element => canonicalLabel(element.element.text)))
  const repeatedAnswerTitle = answerHeading === undefined ? undefined : elements.find(element => (
    element.ordinal === answerHeading.ordinal - 1
      && element.page === answerHeading.page
      && labelsBeforeQuestions.has(canonicalLabel(element.element.text))
  ))
  const answerBoundary = repeatedAnswerTitle ?? answerHeading
  if (answerBoundary !== undefined && (end === undefined || end.ordinal > answerBoundary.ordinal)) {
    errors.push(`endElementId must be ${String(answerBoundary.id)} or an earlier excluded element before the answer section`)
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
  const excluded = expandSectionExclusions(elements, selected, declaredExcluded)
  const selectedHeadIds = new Set(selected.map(question => question.head.id as string))
  expandRepeatedPageDecorations(elements.filter(element => !selectedHeadIds.has(element.id as string)), excluded)
  expandDecorativeExclusions(elements, excluded)
  const endOrdinal = end?.ordinal ?? elements.length
  const candidateEndOrdinal = Math.min(endOrdinal, answerBoundary?.ordinal ?? elements.length)
  const selectedNumberedHeads = selected.flatMap((question) => {
    const number = leadingArabicQuestionNumber(question.head.element.text)
    return number === undefined ? [] : [{ number, head: question.head }]
  })
  for (const element of elements) {
    if (element.ordinal >= candidateEndOrdinal) continue
    if (taggedQuestionHeadPattern.test(element.element.text) && !selectedHeadIds.has(element.id)) {
      errors.push(`questions must include tagged question-head candidate ${String(element.id)}`)
    }
    if (numberedQuestionHeadPattern.test(element.element.text)
      && !selectedHeadIds.has(element.id)
      && !declaredExcluded.has(element.id)) {
      errors.push(`numbered question-head candidate ${String(element.id)} must be selected or excluded`)
    }
    const number = leadingArabicQuestionNumber(element.element.text)
    if (number === undefined || !declaredExcluded.has(element.id)) continue
    const previous = selectedNumberedHeads.findLast(candidate => candidate.head.ordinal < element.ordinal)
    const next = selectedNumberedHeads.find(candidate => candidate.head.ordinal > element.ordinal)
    const betweenSelectedNumbers = previous !== undefined
      && next !== undefined
      && previous.number < number
      && number < next.number
    const continuesPreviousSequence = previous !== undefined
      && number === previous.number + 1
      && (next === undefined || next.number > number || next.number <= previous.number)
    const continuesIntoNextSequence = next !== undefined
      && number + 1 === next.number
      && (previous === undefined || previous.number < number || previous.number >= next.number)
    if (betweenSelectedNumbers || continuesPreviousSequence || continuesIntoNextSequence) {
      errors.push(`excluded numbered candidate ${String(element.id)} closes a selected numeric sequence gap and must be a question head`)
    }
  }
  for (const question of selected) {
    if (numberedQuestionHeadPattern.test(question.head.element.text)
      || taggedQuestionHeadPattern.test(question.head.element.text)) continue
    const preceding = elements.findLast(element => (
      element.page === question.head.page
        && element.ordinal < question.head.ordinal
        && declaredExcluded.has(element.id as string)
        && numberedQuestionHeadPattern.test(element.element.text)
        && element.element.bbox[2] > question.head.element.bbox[0]
        && element.element.bbox[0] < question.head.element.bbox[2]
        && elements
          .filter(intermediate => intermediate.ordinal > element.ordinal && intermediate.ordinal < question.head.ordinal)
          .every(intermediate => declaredExcluded.has(intermediate.id as string))
    ))
    if (preceding !== undefined) {
      errors.push(`question head ${String(question.head.id)} must use preceding numbered candidate ${String(preceding.id)}`)
    }
  }
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
        const overlappingHead = selected.find((candidate, candidateIndex) => (
          candidateIndex !== questionIndex
            && candidate.head.page === element.page
            && verticalBoxesOverlap(element.element.bbox, candidate.head.element.bbox)
        ))
        if (!claimantOverlaps && overlappingHead !== undefined) {
          errors.push(`questions[${String(questionIndex)}].additionalElementIds assigns ${id} across the vertical band of ${String(overlappingHead.head.id)}`)
        }
      }
      claimed.set(id, questionIndex)
    }
  }
  if (errors.length > 0) return { errors, referenceErrors }
  const owners = assignQuestionOwners(elements, selected, end, excluded, claimed)
  const cropStops = elements.filter(element => (
    selectedHeadIds.has(element.id as string)
      || element === end
  ))
  const questions = selected.map((item, index): TeacherSegmentedQuestion => {
    const owned = elements.filter(element => owners.get(element.id as string) === index)
    for (const element of item.additional) {
      if (!owned.includes(element)) owned.push(element)
    }
    return {
      questionNo: index + 1,
      headPageIndex: item.head.page.pageIndex,
      groupIndex: 0,
      regions: cropRegions(owned, pages, padding, item.head, cropStops, excluded),
    }
  })
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

function canonicalLabel(value: string): string {
  return value.normalize('NFKC').replace(/[\p{P}\p{S}\s]/gu, '').toLocaleLowerCase()
}

function submissionTool(
  name: string,
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
  elements: readonly IndexedElement[],
  accepted: Map<string, AcceptedBoundaryDraft>,
  sourceComplete: () => boolean,
) {
  let submissions = 0
  const seenDrafts = new Set<string>()
  return defineTool({
    name,
    description: 'Submit every top-level head, classify audited numbered candidates, and exclude other internal non-question content. Recognized section headings are Host-excluded. Same-page column interleaving is Host-owned; additionalElementIds is only for exceptional content outside both spatial and source-order ownership. Host validation returns an accepted token or precise corrections.',
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
      endElementId: { type: 'string' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      if (!sourceComplete()) return Promise.resolve('REJECTED\ninspect every source chunk before submitting boundaries')
      const fingerprint = JSON.stringify(args)
      if (seenDrafts.has(fingerprint)) return Promise.resolve('REJECTED\nthis identical rejected draft was already checked; change the reported decisions')
      seenDrafts.add(fingerprint)
      const validated = validateBoundaryDraft(args, elements, request.pages, request.padding, config.maxSegmentedQuestions)
      if (validated.referenceErrors.length === 0) {
        submissions += 1
        if (submissions > config.maxQuestionBoundarySubmissions) {
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
  const candidateAuditEndOrdinal = elements.find(element => (
    (element.element.type === 'text' || element.element.type === 'equation')
      && answerHeadingPattern.test(element.element.text)
  ))?.ordinal ?? elements.length
  const candidateAudit = {
    questionHeadCandidateIds: elements
      .filter(element => element.ordinal < candidateAuditEndOrdinal
        && (numberedQuestionHeadPattern.test(element.element.text)
          || taggedQuestionHeadPattern.test(element.element.text)))
      .map(element => element.id),
    autoExcludedSectionHeadingIds: elements
      .filter(element => element.ordinal < candidateAuditEndOrdinal
        && sectionHeadingPattern.test(element.element.text))
      .map(element => element.id),
  }
  const inspectedChunks = new Set<number>()
  const sourceToolName = `question_layout_${randomUUID().replaceAll('-', '')}`
  const submissionToolName = `submit_question_boundaries_${randomUUID().replaceAll('-', '')}`
  const accepted = new Map<string, AcceptedBoundaryDraft>()
  let run: SubagentRun | undefined
  let disposeSourceTool: (() => Promise<void>) | undefined
  let disposeSubmissionTool: (() => Promise<void>) | undefined
  let outcome: TeacherQuestionSegmentationAgentResult
  try {
    const selected = modelConfig.currentToolSelection()
    const modelInfo = await llm.resolveModelInfo(selected.provider, selected.model, controller.signal)
    disposeSourceTool = ctx.effect(
      () => tools.register(sourceTool(sourceToolName, chunks, inspectedChunks)),
      'teacher-workbench: question layout source',
    )
    disposeSubmissionTool = ctx.effect(
      () => tools.register(submissionTool(
        submissionToolName,
        request,
        config,
        elements,
        accepted,
        () => inspectedChunks.size === chunks.length,
      )),
      'teacher-workbench: question boundary submission',
    )
    const prompt: SubagentStartRequest['prompt'] = [{
      type: 'text',
      text: `Segment the selected PDF pages into complete top-level questions. Call ${sourceToolName} exactly once for each chunk number from 0 through ${String(chunks.length - 1)}. Inspect all chunks, infer this source's question-head convention, then submit one complete draft to ${submissionToolName}. The Host candidate audit below is authoritative: classify every questionHeadCandidateId as a selected head or an explicit exclusion, and do not copy autoExcludedSectionHeadingIds into excludedElementIds. Put the concise inferred convention in headConvention. Do not use additionalElementIds to repair same-page column order; the Host owns that geometry. Put exceptional additionalElementIds inside the owning question object; excludedElementIds and endElementId belong at the draft root. If rejected, change every reported decision before resubmitting. Then call structured_output with only the accepted validationToken.\n${JSON.stringify({ fileName: request.fileName, selectedPages: request.pages.map(page => page.pageIndex), elementCount: elements.length, sourceChunks: chunks.length, candidateAudit })}`,
    }]
    run = await subagents.start('spawn', {
      label: `Question segmentation: ${request.fileName}`,
      prompt,
      parent,
      signal: controller.signal,
      agentOptions: lowLatencyToolSelection(selected, modelInfo),
      outputSchema: questionSegmentationOutputSchema,
      toolFilter: { allow: [sourceToolName, submissionToolName] },
      persona: QUESTION_SEGMENTATION_SKILL.content,
    })
    const result = await run.result
    if (controller.signal.aborted) {
      outcome = rejected('timed-out', 'the tool model did not finish before the deadline')
    } else if (result.stopReason !== 'completed') {
      outcome = rejected('model-failed', `the tool model stopped with ${result.stopReason}`)
    } else {
      const parsed = structuredOutputSchema.safeParse(result.structured)
      const draft = parsed.success ? accepted.get(parsed.data.validationToken) : undefined
      if (!parsed.success || draft === undefined) {
        outcome = rejected('invalid-output', accepted.size === 0
          ? 'the agent did not produce a Host-accepted boundary draft; retry the cut'
          : parsed.success
            ? 'the final token does not reference an accepted boundary draft from this run'
            : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
      } else {
        outcome = { ok: true, value: { questions: draft.questions } }
      }
    }
  } catch (error) {
    outcome = controller.signal.aborted
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
  if (disposeSubmissionTool !== undefined) await disposeSubmissionTool()
  return outcome
}
