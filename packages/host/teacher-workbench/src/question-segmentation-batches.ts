/** Bounded semantic page-group orchestration for large question-layout requests. */

import type { Context } from '@deepseek-ai/cordis'
import { mapConcurrently } from '@deepseek-ai/dsh-concurrency'
import {
  countQuestionHeadCandidates,
  detectDocumentAnswerSectionPageIndexes,
  segmentQuestionsWithAgent,
  type TeacherQuestionSegmentationAgentConfig,
  type TeacherQuestionSegmentationAgentResult,
} from './question-segmentation-agent.ts'
import type {
  TeacherQuestionLayoutPage,
  TeacherQuestionSegmentRequest,
  TeacherQuestionSegmentResult,
  TeacherSegmentedQuestion,
} from './types.ts'

/** Batch-specific settings layered over one agent run's validation limits. */
export interface TeacherQuestionSegmentationBatchConfig extends TeacherQuestionSegmentationAgentConfig {
  /** Selected source pages owned by one semantic processing group. */
  readonly questionSegmentationBatchPages: number
  /** Maximum fallible question-head candidates owned by one semantic processing group. */
  readonly questionSegmentationBatchCandidates: number
  /** Maximum independently owned semantic groups processed at once. */
  readonly questionSegmentationConcurrency: number
  /** Maximum proportional excess above the median question width before exclusion from shared-width selection. */
  readonly maxQuestionWidthOutlierExcessRatio: number
  /** Maximum decoded image bytes accepted by one automatic save part. */
  readonly maxQuestionBatchBytes: number
  /** Maximum visual review attempts admitted before an unverified group fails. */
  readonly maxQuestionRecutAttempts: number
}

/** Page ownership and overlap passed to one semantic agent run. */
export interface TeacherQuestionSegmentationPageGroup {
  /** Zero-based group position in the complete selected-page request. */
  readonly groupIndex: number
  /** Pages whose question heads belong to this group. */
  readonly corePageIndexes: readonly number[]
  /** Core pages plus one available source page on each side. */
  readonly inspectionPageIndexes: readonly number[]
}

type SegmentationRunner = (
  ctx: Context,
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
) => Promise<TeacherQuestionSegmentationAgentResult>

type SuccessfulGroupRun = {
  readonly group: TeacherQuestionSegmentationPageGroup
  readonly result: Extract<TeacherQuestionSegmentationAgentResult, { readonly ok: true }>
}

class QuestionSegmentationGroupFailure extends Error {
  override name = 'QuestionSegmentationGroupFailure'

  constructor(readonly result: Extract<TeacherQuestionSegmentationAgentResult, { readonly ok: false }>) {
    super(result.error.message)
  }
}

function maxQuestionWidthRatio(
  questions: readonly TeacherSegmentedQuestion[],
  outlierExcessRatio: number,
): number {
  const widths = questions.flatMap((question) => {
    if (question.regions.length === 0) return []
    return [Math.max(...question.regions.map(region => (
      (region.rightLimit - region.left) / region.pageWidth
    )))]
  }).sort((left, right) => left - right)
  if (widths.length === 0) return 1
  const middle = Math.floor(widths.length / 2)
  const upper = widths[middle]
  if (upper === undefined) return 1
  const median = widths.length % 2 === 0
    ? ((widths[middle - 1] ?? upper) + upper) / 2
    : upper
  const largestInlier = widths.findLast(width => width <= median * (1 + outlierExcessRatio))
  return largestInlier ?? median
}

/**
 * Plan density-bounded core groups with adjacent-page overlap.
 * @param pageIndexes - ordered, unique original PDF page indexes.
 * @param batchPages - maximum core pages owned by one group.
 * @param candidateCounts - fallible question-head candidate counts aligned with `pageIndexes`.
 * @param batchCandidates - maximum candidates owned by one group; one dense page always remains indivisible.
 * @returns processing groups in source order.
 */
export function planQuestionSegmentationPageGroups(
  pageIndexes: readonly number[],
  batchPages: number,
  candidateCounts: readonly number[],
  batchCandidates: number,
): readonly TeacherQuestionSegmentationPageGroup[] {
  if (!Number.isSafeInteger(batchPages) || batchPages < 1) throw new TypeError('batchPages must be a positive integer')
  if (!Number.isSafeInteger(batchCandidates) || batchCandidates < 1) {
    throw new TypeError('batchCandidates must be a positive integer')
  }
  if (candidateCounts.length !== pageIndexes.length
    || candidateCounts.some(count => !Number.isSafeInteger(count) || count < 0)) {
    throw new TypeError('candidateCounts must contain one non-negative integer per page')
  }
  for (const [index, pageIndex] of pageIndexes.entries()) {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || (index > 0 && pageIndex <= (pageIndexes[index - 1] ?? -1))) {
      throw new TypeError('pageIndexes must be unique non-negative integers in source order')
    }
  }
  const groups: TeacherQuestionSegmentationPageGroup[] = []
  for (let offset = 0; offset < pageIndexes.length;) {
    let end = offset
    let candidates = 0
    while (end < pageIndexes.length && end - offset < batchPages) {
      if (end > offset && pageIndexes[end] !== (pageIndexes[end - 1] ?? -1) + 1) break
      const nextCandidates = candidateCounts[end] ?? 0
      if (end > offset && candidates + nextCandidates > batchCandidates) break
      candidates += nextCandidates
      end += 1
    }
    const corePageIndexes = pageIndexes.slice(offset, end)
    const precedingPage = pageIndexes[offset - 1]
    const firstCorePage = pageIndexes[offset]
    const finalCorePage = pageIndexes[end - 1]
    const followingPage = pageIndexes[end]
    const inspectionStart = precedingPage !== undefined && firstCorePage === precedingPage + 1
      ? offset - 1
      : offset
    const inspectionEnd = followingPage !== undefined && finalCorePage !== undefined && followingPage === finalCorePage + 1
      ? end + 1
      : end
    groups.push({
      groupIndex: groups.length,
      corePageIndexes,
      inspectionPageIndexes: pageIndexes.slice(inspectionStart, inspectionEnd),
    })
    offset = end
  }
  return groups
}

/**
 * Run one short-lived boundary agent per bounded page group and merge owned questions.
 * @param ctx - Host context carrying agent services.
 * @param request - complete selected-page layout from the browser.
 * @param config - group size, save size, and per-agent validation limits.
 * @param run - overridable single-group runner used by focused tests.
 * @returns merged questions with stable group ownership or the first group failure.
 */
export async function segmentQuestionsInBatches(
  ctx: Context,
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationBatchConfig,
  run: SegmentationRunner = segmentQuestionsWithAgent,
): Promise<TeacherQuestionSegmentResult> {
  let groups: readonly TeacherQuestionSegmentationPageGroup[]
  let detectedAnswerSectionPageIndexes: readonly number[] = []
  try {
    const availablePageIndexes = request.pages.map(page => page.pageIndex)
    for (const [index, pageIndex] of availablePageIndexes.entries()) {
      if (!Number.isSafeInteger(pageIndex) || pageIndex < 0
        || (index > 0 && pageIndex <= (availablePageIndexes[index - 1] ?? -1))) {
        throw new TypeError('pages must have unique non-negative indexes in source order')
      }
    }
    const pageByIndex = new Map(request.pages.map(page => [page.pageIndex, page] as const))
    const corePageIndexes = request.corePageIndexes ?? request.pages.map(page => page.pageIndex)
    if (corePageIndexes.length === 0
      || new Set(corePageIndexes).size !== corePageIndexes.length
      || corePageIndexes.some(pageIndex => !pageByIndex.has(pageIndex))) {
      throw new TypeError('corePageIndexes must contain unique pages from the supplied layout')
    }
    const ownedPageIndexes = new Set(corePageIndexes)
    detectedAnswerSectionPageIndexes = detectDocumentAnswerSectionPageIndexes(request.pages)
      .filter(pageIndex => ownedPageIndexes.has(pageIndex))
    const corePages = corePageIndexes.map((pageIndex) => {
      const page = pageByIndex.get(pageIndex)
      if (page === undefined) throw new TypeError('corePageIndexes must contain pages from the supplied layout')
      return page
    })
    groups = planQuestionSegmentationPageGroups(
      corePageIndexes,
      config.questionSegmentationBatchPages,
      corePages.map(page => countQuestionHeadCandidates(page)),
      config.questionSegmentationBatchCandidates,
    )
    groups = groups.map((group) => {
      const first = group.corePageIndexes[0]
      const last = group.corePageIndexes.at(-1)
      if (first === undefined || last === undefined) throw new TypeError('question group has no core pages')
      return {
        ...group,
        inspectionPageIndexes: availablePageIndexes.filter(pageIndex => pageIndex >= first - 1 && pageIndex <= last + 1),
      }
    })
  } catch (error) {
    return {
      ok: false,
      error: { code: 'invalid-request', message: error instanceof Error ? error.message : String(error) },
    }
  }
  if (groups.length === 0) {
    return { ok: false, error: { code: 'invalid-request', message: 'at least one selected page is required' } }
  }
  if (config.questionSegmentationBatchPages + 2 > config.maxQuestionLayoutPages) {
    return {
      ok: false,
      error: {
        code: 'invalid-request',
        message: 'questionSegmentationBatchPages plus two overlap pages exceeds maxQuestionLayoutPages',
      },
    }
  }

  const pageByIndex = new Map(request.pages.map(page => [page.pageIndex, page] as const))
  const requests = new Map<number, TeacherQuestionSegmentRequest>()
  for (const group of groups) {
    const pages: TeacherQuestionLayoutPage[] = []
    for (const pageIndex of group.inspectionPageIndexes) {
      const page = pageByIndex.get(pageIndex)
      if (page === undefined) {
        return { ok: false, error: { code: 'invalid-request', message: 'selected page layout is incomplete' } }
      }
      pages.push(page)
    }
    const inspectionPages = new Set(group.inspectionPageIndexes)
    requests.set(group.groupIndex, {
      ...request,
      pages,
      corePageIndexes: group.corePageIndexes,
      answerSectionPageIndexes: detectedAnswerSectionPageIndexes.filter(pageIndex => (
        group.corePageIndexes.includes(pageIndex)
      )),
      ...(request.pagePreviews === undefined ? {} : {
        pagePreviews: request.pagePreviews.filter(preview => inspectionPages.has(preview.pageIndex)),
      }),
    })
  }
  let successfulGroups: readonly SuccessfulGroupRun[]
  try {
    successfulGroups = await mapConcurrently(groups, config.questionSegmentationConcurrency, async (group) => {
      const groupRequest = requests.get(group.groupIndex)
      if (groupRequest === undefined) throw new Error('question group request is missing')
      const result = await run(ctx, groupRequest, config)
      if (!result.ok) throw new QuestionSegmentationGroupFailure(result)
      return { group, result }
    })
  } catch (error) {
    if (error instanceof QuestionSegmentationGroupFailure) return error.result
    throw error
  }

  const questions: TeacherSegmentedQuestion[] = []
  for (const item of successfulGroups) {
    const result = item.result
    const group = item.group
    const corePages = new Set(group.corePageIndexes)
    questions.push(...result.value.questions
      .filter(question => corePages.has(question.headPageIndex))
      .map(question => ({ ...question, groupIndex: group.groupIndex })))
  }
  const numberedQuestions = questions.map((question, index) => ({ ...question, questionNo: index + 1 }))
  return {
    ok: true,
    value: {
      groupCount: groups.length,
      groups,
      maxConcurrentGroups: config.questionSegmentationConcurrency,
      maxSaveBatchBytes: config.maxQuestionBatchBytes,
      maxRecutAttempts: config.maxQuestionRecutAttempts,
      maxQuestionWidthRatio: maxQuestionWidthRatio(
        numberedQuestions,
        config.maxQuestionWidthOutlierExcessRatio,
      ),
      questions: numberedQuestions,
    },
  }
}
