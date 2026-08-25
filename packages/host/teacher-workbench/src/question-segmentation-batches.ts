/** Bounded semantic page-group orchestration for large question-layout requests. */

import type { Context } from '@deepseek-ai/cordis'
import {
  countQuestionHeadCandidates,
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
  /** Maximum decoded image bytes accepted by one automatic save part. */
  readonly maxQuestionBatchBytes: number
  /** Maximum local recuts admitted for one defective image before persistence. */
  readonly maxQuestionRecutAttempts: number
}

/** Page ownership and overlap passed to one semantic agent run. */
export interface TeacherQuestionSegmentationPageGroup {
  /** Zero-based group position in the complete selected-page request. */
  readonly groupIndex: number
  /** Pages whose question heads belong to this group. */
  readonly corePageIndexes: readonly number[]
  /** Core pages plus one adjacent selected page on each available side. */
  readonly inspectionPageIndexes: readonly number[]
}

type SegmentationRunner = (
  ctx: Context,
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
) => Promise<TeacherQuestionSegmentationAgentResult>

function maxQuestionWidthRatio(questions: readonly TeacherSegmentedQuestion[]): number {
  const regions = questions.flatMap(question => question.regions)
  if (regions.length === 0) return 1
  return Math.max(...regions.map(region => (region.right - region.left) / region.pageWidth))
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
      const nextCandidates = candidateCounts[end] ?? 0
      if (end > offset && candidates + nextCandidates > batchCandidates) break
      candidates += nextCandidates
      end += 1
    }
    const corePageIndexes = pageIndexes.slice(offset, end)
    const inspectionStart = Math.max(0, offset - 1)
    const inspectionEnd = Math.min(pageIndexes.length, end + 1)
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
  try {
    groups = planQuestionSegmentationPageGroups(
      request.pages.map(page => page.pageIndex),
      config.questionSegmentationBatchPages,
      request.pages.map(countQuestionHeadCandidates),
      config.questionSegmentationBatchCandidates,
    )
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
  const questions: TeacherSegmentedQuestion[] = []
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
    const result = await run(ctx, {
      ...request,
      pages,
      corePageIndexes: group.corePageIndexes,
      ...(request.pagePreviews === undefined ? {} : {
        pagePreviews: request.pagePreviews.filter(preview => inspectionPages.has(preview.pageIndex)),
      }),
    }, config)
    if (!result.ok) return result
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
      maxSaveBatchBytes: config.maxQuestionBatchBytes,
      maxRecutAttempts: config.maxQuestionRecutAttempts,
      maxQuestionWidthRatio: maxQuestionWidthRatio(numberedQuestions),
      questions: numberedQuestions,
    },
  }
}
