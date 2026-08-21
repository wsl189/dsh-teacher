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

const structuredOutputSchema = z.object({ validationToken: z.string().min(1).max(128) }).strict()
const answerHeadingPattern = /^\s*(?:.{0,80}(?:试卷|作业|练习)\s*)?(?:参考)?答案(?:与解析|及解析|及评分标准|与评分标准)?\s*[:：]?\s*$/u
const sectionHeadingPattern = /^\s*(?:[一二三四五六七八九十]+\s*[、.．]\s*(?:(?:单项|多项)?选择|填空|解答|计算|证明|判断|作图|应用)|(?:part|section)\s+[A-Z0-9]+)/iu

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
    const bottom = Math.min(page.height, ownedBottom + padding, nextTop)
    return right > left && bottom > top
      ? [{ pageIndex: page.pageIndex, left, top, right, bottom, pageWidth: page.width, pageHeight: page.height }]
      : []
  })
}

function expandSectionExclusions(
  elements: readonly IndexedElement[],
  questions: readonly { readonly head: IndexedElement }[],
  declared: ReadonlySet<string>,
): Set<string> {
  const expanded = new Set(declared)
  for (const heading of elements) {
    if (!declared.has(heading.id) || !sectionHeadingPattern.test(heading.element.text)) continue
    const nextHead = questions.find(question => question.head.ordinal > heading.ordinal)?.head
    if (nextHead === undefined || nextHead.page !== heading.page) continue
    for (const element of elements) {
      if (element.page === heading.page && element.ordinal > heading.ordinal && element.ordinal < nextHead.ordinal) {
        expanded.add(element.id)
      }
    }
  }
  return expanded
}

function validateBoundaryDraft(
  draft: BoundaryDraft,
  elements: readonly IndexedElement[],
  pages: readonly TeacherQuestionLayoutPage[],
  padding: number,
  maxQuestions: number,
): { errors: readonly string[]; questions?: readonly TeacherSegmentedQuestion[] } {
  const errors: string[] = []
  if (draft.headConvention.trim() === '') errors.push('headConvention must describe the inferred question-head convention')
  if (draft.headConvention.length > 1_000) errors.push('headConvention exceeds 1000 characters')
  if (draft.questions.length === 0) errors.push('questions must contain at least one top-level question')
  if (draft.questions.length > maxQuestions) errors.push(`questions exceeds the ${String(maxQuestions)} item limit`)
  const byId = new Map(elements.map(element => [element.id as string, element] as const))
  const selected: Array<{
    head: IndexedElement
    additional: readonly IndexedElement[]
  }> = []
  const seenIds = new Set<string>()
  for (const [index, question] of draft.questions.entries()) {
    const label = `questions[${String(index)}]`
    const head = byId.get(question.headElementId)
    if (head === undefined) {
      errors.push(`${label}.headElementId is not present in the inspected source`)
      continue
    }
    if (seenIds.has(question.headElementId)) errors.push(`${label}.headElementId duplicates an earlier question`)
    seenIds.add(question.headElementId)
    const additional: IndexedElement[] = []
    const localIds = new Set<string>()
    for (const [additionalIndex, id] of (question.additionalElementIds ?? []).entries()) {
      const additionalLabel = `${label}.additionalElementIds[${String(additionalIndex)}]`
      const element = byId.get(id)
      if (element === undefined) errors.push(`${additionalLabel} is not present in the inspected source`)
      else additional.push(element)
      if (id === question.headElementId) errors.push(`${additionalLabel} repeats its question head`)
      if (localIds.has(id)) errors.push(`${additionalLabel} duplicates an earlier additional element`)
      localIds.add(id)
    }
    selected.push({ head, additional })
  }
  selected.sort((left, right) => left.head.ordinal - right.head.ordinal)
  const end = draft.endElementId === undefined ? undefined : byId.get(draft.endElementId)
  if (draft.endElementId !== undefined && end === undefined) errors.push('endElementId is not present in the inspected source')
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
    if (!byId.has(id)) errors.push(`${label} is not present in the inspected source`)
    if (seenIds.has(id)) errors.push(`${label} must not exclude a question head`)
    if (declaredExcluded.has(id)) errors.push(`${label} duplicates an earlier excluded element`)
    declaredExcluded.add(id)
  }
  const excluded = expandSectionExclusions(elements, selected, declaredExcluded)
  const selectedHeadIds = new Set(selected.map(question => question.head.id as string))
  const firstHeadOrdinal = selected[0]?.head.ordinal ?? 0
  const endOrdinal = end?.ordinal ?? elements.length
  for (const element of elements) {
    const id = element.id as string
    if (element.ordinal < firstHeadOrdinal || element.ordinal >= endOrdinal
      || selectedHeadIds.has(id) || excluded.has(id)) continue
    if (sectionHeadingPattern.test(element.element.text)) {
      errors.push(`excludedElementIds must include non-question section heading ${id}`)
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
      claimed.set(id, questionIndex)
    }
  }
  if (errors.length > 0) return { errors }
  const questions = selected.map((item, index): TeacherSegmentedQuestion => {
    const next = selected[index + 1]?.head ?? end
    const owned = elements.filter(element => (
      element.ordinal >= item.head.ordinal
        && (next === undefined || element.ordinal < next.ordinal)
        && !excluded.has(element.id as string)
        && (claimed.get(element.id as string) === undefined || claimed.get(element.id as string) === index)
    ))
    for (const element of item.additional) {
      if (!owned.includes(element)) owned.push(element)
    }
    return {
      questionNo: index + 1,
      headPageIndex: item.head.page.pageIndex,
      groupIndex: 0,
      regions: cropRegions(owned, pages, padding),
    }
  })
  if (questions.some(question => question.regions.length === 0)) {
    return { errors: ['one or more accepted boundaries produce an empty crop'] }
  }
  return { errors: [], questions }
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
    description: 'Describe the inferred head convention, then submit every top-level question head and optional exclusions. Host validation returns an accepted token or precise corrections.',
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
      submissions += 1
      if (submissions > config.maxQuestionBoundarySubmissions) {
        return Promise.resolve('REJECTED\nboundary submission limit reached')
      }
      const validated = validateBoundaryDraft(args, elements, request.pages, request.padding, config.maxSegmentedQuestions)
      if (validated.questions === undefined) {
        return Promise.resolve(['REJECTED', ...validated.errors].join('\n'))
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
      text: `Segment the selected PDF pages into complete top-level questions. Call ${sourceToolName} exactly once for each chunk number from 0 through ${String(chunks.length - 1)}. Inspect all chunks, infer this source's question-head convention, then submit one complete draft to ${submissionToolName}. Put the concise inferred convention in headConvention. Put additionalElementIds inside the owning question object; excludedElementIds and endElementId belong at the draft root. If rejected, change every reported decision before resubmitting. Then call structured_output with only the accepted validationToken.\n${JSON.stringify({ fileName: request.fileName, selectedPages: request.pages.map(page => page.pageIndex), elementCount: elements.length, sourceChunks: chunks.length })}`,
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
