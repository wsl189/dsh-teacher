/** Bounded semantic page-group orchestration for large question-layout requests. */

import type { Context } from '@deepseek-ai/cordis'
import {
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
  /** Maximum decoded image bytes accepted by one automatic save part. */
  readonly maxQuestionBatchBytes: number
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

/**
 * Plan fixed-size core groups with adjacent-page overlap.
 * @param pageIndexes - ordered, unique original PDF page indexes.
 * @param batchPages - maximum core pages owned by one group.
 * @returns processing groups in source order.
 */
export function planQuestionSegmentationPageGroups(
  pageIndexes: readonly number[],
  batchPages: number,
): readonly TeacherQuestionSegmentationPageGroup[] {
  if (!Number.isSafeInteger(batchPages) || batchPages < 1) throw new TypeError('batchPages must be a positive integer')
  for (const [index, pageIndex] of pageIndexes.entries()) {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || (index > 0 && pageIndex <= (pageIndexes[index - 1] ?? -1))) {
      throw new TypeError('pageIndexes must be unique non-negative integers in source order')
    }
  }
  const groups: TeacherQuestionSegmentationPageGroup[] = []
  for (let offset = 0; offset < pageIndexes.length; offset += batchPages) {
    const corePageIndexes = pageIndexes.slice(offset, offset + batchPages)
    const inspectionStart = Math.max(0, offset - 1)
    const inspectionEnd = Math.min(pageIndexes.length, offset + batchPages + 1)
    groups.push({
      groupIndex: groups.length,
      corePageIndexes,
      inspectionPageIndexes: pageIndexes.slice(inspectionStart, inspectionEnd),
    })
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
    const result = await run(ctx, { ...request, pages }, config)
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
      maxSaveBatchBytes: config.maxQuestionBatchBytes,
      questions: numberedQuestions,
    },
  }
}
