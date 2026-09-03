/** Large-layout question-segmentation page grouping. */

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import {
  planQuestionSegmentationPageGroups,
  segmentQuestionsInBatches,
  type TeacherQuestionSegmentationBatchConfig,
} from '../src/question-segmentation-batches.ts'
import type { TeacherQuestionSegmentRequest } from '../src/types.ts'

const CONFIG: TeacherQuestionSegmentationBatchConfig = {
  questionSegmentationBatchPages: 20,
  questionSegmentationBatchCandidates: 300,
  questionSegmentationConcurrency: 4,
  maxQuestionWidthOutlierExcessRatio: 0.5,
  maxQuestionBatchBytes: 300,
  maxQuestionLayoutPages: 50,
  maxQuestionLayoutElements: 5_000,
  maxQuestionSourceChunkCharacters: 18_000,
  maxQuestionCompactBoundaryCharacters: 12_000,
  questionSegmentationInlineEvidence: false,
  maxQuestionCompactBoundaryOutputTokens: 32_768,
  maxQuestionCompactReviewOutputTokens: 32_768,
  maxSegmentedQuestions: 300,
  maxQuestionBoundarySubmissions: 5,
  maxQuestionBoundaryAgentRuns: 2,
  maxQuestionRejectedToolCalls: 3,
  maxQuestionAutoOwnedGapRatio: 0.18,
  minQuestionRepeatedImagePages: 3,
  questionRepeatedImagePositionToleranceRatio: 0.015,
  maxQuestionRecutAttempts: 2,
  maxQuestionVisionImagesPerToolCall: 4,
  questionSegmentationReasoningEnabled: true,
  questionSegmentationAgentTimeoutMs: 180_000,
}

function request(pageCount: number): TeacherQuestionSegmentRequest {
  return {
    parentSessionId: SessionId('parent'),
    fileName: '大试卷.pdf',
    padding: 10,
    pages: Array.from({ length: pageCount }, (_, pageIndex) => ({
      pageIndex,
      width: 600,
      height: 800,
      elements: [{ type: 'text' as const, text: `${String(pageIndex + 1)}. 题目`, bbox: [20, 20, 200, 50] }],
    })),
  }
}

describe('planQuestionSegmentationPageGroups', () => {
  it('owns twenty pages per group and inspects one adjacent source page on each side', () => {
    const pageIndexes = Array.from({ length: 45 }, (_, index) => index)
    const groups = planQuestionSegmentationPageGroups(pageIndexes, 20, pageIndexes.map(() => 1), 300)
    expect(groups.map(group => ({
      core: [group.corePageIndexes[0], group.corePageIndexes.at(-1)],
      inspection: [group.inspectionPageIndexes[0], group.inspectionPageIndexes.at(-1)],
    }))).toEqual([
      { core: [0, 19], inspection: [0, 20] },
      { core: [20, 39], inspection: [19, 40] },
      { core: [40, 44], inspection: [39, 44] },
    ])
  })

  it('ends a group before adding a page that would exceed the candidate-density limit', () => {
    const groups = planQuestionSegmentationPageGroups([0, 1, 2, 3], 4, [10, 10, 10, 1], 20)
    expect(groups).toEqual([
      { groupIndex: 0, corePageIndexes: [0, 1], inspectionPageIndexes: [0, 1, 2] },
      { groupIndex: 1, corePageIndexes: [2, 3], inspectionPageIndexes: [1, 2, 3] },
    ])
  })

  it('starts a new group at every gap without treating distant sampled pages as context', () => {
    const groups = planQuestionSegmentationPageGroups([0, 1, 4, 5], 4, [1, 1, 1, 1], 20)
    expect(groups).toEqual([
      { groupIndex: 0, corePageIndexes: [0, 1], inspectionPageIndexes: [0, 1] },
      { groupIndex: 1, corePageIndexes: [4, 5], inspectionPageIndexes: [4, 5] },
    ])
  })
})

describe('segmentQuestionsInBatches', () => {
  it('runs independent groups up to the configured limit and preserves source order', async () => {
    let active = 0
    let maximumActive = 0
    const runner = vi.fn(async (_ctx: Context, groupRequest: TeacherQuestionSegmentRequest) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise(resolve => setTimeout(resolve, 0))
      active -= 1
      const page = groupRequest.pages.find(candidate => groupRequest.corePageIndexes?.includes(candidate.pageIndex))!
      return {
        ok: true as const,
        value: {
          questions: [{
            sourceHeadId: `p${String(page.pageIndex)}e0` as never,
            questionNo: 1,
            headPageIndex: page.pageIndex,
            groupIndex: 0,
            regions: [{
              pageIndex: page.pageIndex, left: 20, top: 20, right: 200, rightLimit: 600, bottom: 50,
              excludedAreas: [], pageWidth: 600, pageHeight: 800,
            }],
          }],
        },
      }
    })
    const ctx = new Context()

    const result = await segmentQuestionsInBatches(ctx, request(6), {
      ...CONFIG,
      questionSegmentationBatchPages: 1,
      questionSegmentationConcurrency: 2,
    }, runner)

    expect(maximumActive).toBe(2)
    expect(runner).toHaveBeenCalledTimes(6)
    expect(result.ok && result.value.questions.map(question => question.headPageIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(result.ok && result.value.maxConcurrentGroups).toBe(2)
    await ctx.fiber.dispose()
  })

  it('waits for in-flight groups and stops admitting new groups after one fails', async () => {
    const release = Promise.withResolvers<undefined>()
    const started: number[] = []
    let firstFinished = false
    const runner = vi.fn(async (_ctx: Context, groupRequest: TeacherQuestionSegmentRequest) => {
      const pageIndex = groupRequest.corePageIndexes?.[0] ?? -1
      started.push(pageIndex)
      if (pageIndex === 0) {
        await release.promise
        firstFinished = true
        return { ok: true as const, value: { questions: [] } }
      }
      return {
        ok: false as const,
        error: { code: 'invalid-output' as const, message: 'group failed' },
      }
    })
    const ctx = new Context()
    let settled = false
    const operation = segmentQuestionsInBatches(ctx, request(4), {
      ...CONFIG,
      questionSegmentationBatchPages: 1,
      questionSegmentationConcurrency: 2,
    }, runner).finally(() => { settled = true })
    await vi.waitFor(() => { expect(started).toEqual([0, 1]) })

    expect(settled).toBe(false)
    release.resolve(undefined)
    await expect(operation).resolves.toMatchObject({ ok: false, error: { message: 'group failed' } })
    expect(firstFinished).toBe(true)
    expect(started).toEqual([0, 1])
    await ctx.fiber.dispose()
  })

  it('runs bounded overlapping groups and keeps each question only with its head-page owner', async () => {
    const seenPages: number[][] = []
    const seenCorePages: number[][] = []
    const runner = vi.fn(async (_ctx: Context, groupRequest: TeacherQuestionSegmentRequest) => {
      const pageIndexes = groupRequest.pages.map(page => page.pageIndex)
      seenPages.push(pageIndexes)
      seenCorePages.push([...(groupRequest.corePageIndexes ?? [])])
      return {
        ok: true as const,
        value: {
          questions: pageIndexes.map(pageIndex => ({
            sourceHeadId: `p${String(pageIndex)}e0` as never,
            questionNo: pageIndex + 1,
            headPageIndex: pageIndex,
            groupIndex: 0,
            regions: [{
              pageIndex, left: 20, top: 20, right: 200, rightLimit: 600, bottom: 50, excludedAreas: [], pageWidth: 600, pageHeight: 800,
            }],
          })),
        },
      }
    })
    const ctx = new Context()
    const result = await segmentQuestionsInBatches(ctx, request(45), CONFIG, runner)

    expect(seenPages.map(pages => [pages[0], pages.at(-1)])).toEqual([[0, 20], [19, 40], [39, 44]])
    expect(seenCorePages.map(pages => [pages[0], pages.at(-1)])).toEqual([[0, 19], [20, 39], [40, 44]])
    expect(result.ok && result.value.questions.map(question => question.questionNo)).toEqual(
      Array.from({ length: 45 }, (_, index) => index + 1),
    )
    expect(result.ok && result.value.questions.filter(question => question.groupIndex === 1).map(question => question.questionNo))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 21))
    expect(result).toMatchObject({
      ok: true,
      value: {
        groupCount: 3,
        maxConcurrentGroups: 4,
        maxSaveBatchBytes: 300,
        maxRecutAttempts: 2,
        groups: [
          { groupIndex: 0, corePageIndexes: Array.from({ length: 20 }, (_, index) => index) },
          { groupIndex: 1, corePageIndexes: Array.from({ length: 20 }, (_, index) => index + 20) },
          { groupIndex: 2, corePageIndexes: Array.from({ length: 5 }, (_, index) => index + 40) },
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('uses unselected adjacent source pages only as continuation context', async () => {
    const source = request(10)
    const runner = vi.fn(async (_ctx: Context, groupRequest: TeacherQuestionSegmentRequest) => ({
      ok: true as const,
      value: {
        questions: groupRequest.pages.map(page => ({
          sourceHeadId: `p${String(page.pageIndex)}e0` as never,
          questionNo: page.pageIndex + 1,
          headPageIndex: page.pageIndex,
          groupIndex: 0,
          regions: [{
            pageIndex: page.pageIndex,
            left: 20,
            top: 20,
            right: 200,
            rightLimit: 600,
            bottom: 50,
            excludedAreas: [],
            pageWidth: 600,
            pageHeight: 800,
          }],
        })),
      },
    }))
    const ctx = new Context()
    const result = await segmentQuestionsInBatches(ctx, {
      ...source,
      pages: source.pages.filter(page => page.pageIndex >= 4 && page.pageIndex <= 9),
      corePageIndexes: [5, 6, 7, 8],
    }, {
      ...CONFIG,
      questionSegmentationBatchPages: 4,
    }, runner)

    expect(runner).toHaveBeenCalledOnce()
    expect(runner.mock.calls[0]?.[1].pages.map(page => page.pageIndex)).toEqual([4, 5, 6, 7, 8, 9])
    expect(runner.mock.calls[0]?.[1].corePageIndexes).toEqual([5, 6, 7, 8])
    expect(result.ok && result.value.questions.map(question => question.headPageIndex)).toEqual([5, 6, 7, 8])
    await ctx.fiber.dispose()
  })

  it('propagates document answer-section pages across groups and resets at a new learner paper', async () => {
    const source = request(4)
    const pages = source.pages.map((page) => {
      if (page.pageIndex === 1) {
        return {
          ...page,
          elements: [
            { type: 'text' as const, text: '数学试卷参考答案及评分标准', bbox: [120, 20, 480, 50] as const },
            { type: 'text' as const, text: '15.（13分）解：', bbox: [30, 80, 180, 105] as const },
          ],
        }
      }
      if (page.pageIndex === 2) {
        return {
          ...page,
          elements: [{ type: 'text' as const, text: '17.（15分）解：', bbox: [30, 40, 180, 65] as const }],
        }
      }
      if (page.pageIndex === 3) {
        return {
          ...page,
          elements: [
            { type: 'text' as const, text: '六月模拟数学试卷', bbox: [120, 20, 480, 50] as const },
            { type: 'text' as const, text: '注意事项：本卷共 19 题', bbox: [30, 80, 400, 105] as const },
            { type: 'text' as const, text: '1. 求函数定义域', bbox: [30, 140, 300, 165] as const },
          ],
        }
      }
      return page
    })
    const answerPagesByCore = new Map<number, readonly number[]>()
    const runner = vi.fn(async (_ctx: Context, groupRequest: TeacherQuestionSegmentRequest) => {
      const corePageIndex = groupRequest.corePageIndexes?.[0]
      if (corePageIndex !== undefined) {
        answerPagesByCore.set(corePageIndex, groupRequest.answerSectionPageIndexes ?? [])
      }
      return { ok: true as const, value: { questions: [] } }
    })
    const ctx = new Context()

    await expect(segmentQuestionsInBatches(ctx, { ...source, pages }, {
      ...CONFIG,
      questionSegmentationBatchPages: 1,
    }, runner)).resolves.toMatchObject({ ok: true })

    expect([...answerPagesByCore.entries()]).toEqual([
      [0, []],
      [1, [1]],
      [2, [2]],
      [3, []],
    ])
    await ctx.fiber.dispose()
  })

  it('assigns one source-order display sequence across semantic groups', async () => {
    const runner = vi.fn(async (_ctx: Context, groupRequest: TeacherQuestionSegmentRequest) => ({
      ok: true as const,
      value: {
        questions: groupRequest.pages.map(page => ({
          sourceHeadId: `p${String(page.pageIndex)}e0` as never,
          questionNo: page.pageIndex % 2 + 1,
          headPageIndex: page.pageIndex,
          groupIndex: 0,
          regions: [{
            pageIndex: page.pageIndex,
            left: 20,
            top: 20,
            right: 200,
            rightLimit: 600,
            bottom: 50,
            excludedAreas: [],
            pageWidth: 600,
            pageHeight: 800,
          }],
        })),
      },
    }))
    const ctx = new Context()
    const result = await segmentQuestionsInBatches(ctx, request(4), {
      ...CONFIG,
      questionSegmentationBatchPages: 2,
    }, runner)

    expect(result.ok && result.value.questions.map(question => question.questionNo)).toEqual([1, 2, 3, 4])
    await ctx.fiber.dispose()
  })

  it('publishes the maximum safe lane width after every semantic group is merged', async () => {
    const runner = vi.fn(async (_ctx: Context, groupRequest: TeacherQuestionSegmentRequest) => ({
      ok: true as const,
      value: {
        questions: groupRequest.pages.map(page => ({
          sourceHeadId: `p${String(page.pageIndex)}e0` as never,
          questionNo: 1,
          headPageIndex: page.pageIndex,
          groupIndex: 0,
          regions: [{
            pageIndex: page.pageIndex,
            left: page.pageIndex === 0 ? 30 : 120,
            top: 20,
            right: page.pageIndex === 0 ? 300 : 540,
            rightLimit: page.pageIndex === 0 ? 420 : 600,
            bottom: 50,
            excludedAreas: [],
            pageWidth: 600,
            pageHeight: 800,
          }],
        })),
      },
    }))
    const ctx = new Context()
    const result = await segmentQuestionsInBatches(ctx, request(2), {
      ...CONFIG,
      questionSegmentationBatchPages: 1,
    }, runner)

    expect(result.ok && result.value.maxQuestionWidthRatio).toBe(0.8)
    expect(result.ok && result.value.questions.map(question => question.regions[0])).toMatchObject([
      { left: 30, right: 300 },
      { left: 120, right: 540 },
    ])
    await ctx.fiber.dispose()
  })

  it('excludes question widths more than 50 percent above the median and retains the exact limit', async () => {
    const safeLaneSpans = [270, 288, 300, 450, 570]
    const runner = vi.fn(async () => ({
      ok: true as const,
      value: {
        questions: safeLaneSpans.map((span, index) => ({
          sourceHeadId: `p${String(index)}e0` as never,
          questionNo: index + 1,
          headPageIndex: index,
          groupIndex: 0,
          regions: Array.from({ length: index === 4 ? 4 : 1 }, (_, regionIndex) => ({
            pageIndex: index,
            left: 30,
            top: 20 + regionIndex * 60,
            right: 30 + span - 20,
            rightLimit: 30 + span,
            bottom: 50 + regionIndex * 60,
            excludedAreas: [],
            pageWidth: 600,
            pageHeight: 800,
          })),
        })),
      },
    }))
    const ctx = new Context()
    const filtered = await segmentQuestionsInBatches(ctx, request(5), CONFIG, runner)
    const retained = await segmentQuestionsInBatches(ctx, request(5), {
      ...CONFIG,
      maxQuestionWidthOutlierExcessRatio: 1,
    }, runner)

    expect(filtered.ok && filtered.value.maxQuestionWidthRatio).toBe(0.75)
    expect(filtered.ok && filtered.value.questions[4]?.regions).toHaveLength(4)
    expect(retained.ok && retained.value.maxQuestionWidthRatio).toBe(0.95)
    await ctx.fiber.dispose()
  })

  it('uses the complete page width when no group returns a question', async () => {
    const ctx = new Context()
    const result = await segmentQuestionsInBatches(ctx, request(1), CONFIG, async () => ({
      ok: true,
      value: { questions: [] },
    }))

    expect(result).toMatchObject({
      ok: true,
      value: { maxQuestionWidthRatio: 1, questions: [] },
    })
    await ctx.fiber.dispose()
  })
})
