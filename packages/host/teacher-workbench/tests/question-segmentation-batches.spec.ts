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
  maxQuestionBatchBytes: 300,
  maxQuestionLayoutPages: 50,
  maxQuestionLayoutElements: 5_000,
  maxQuestionSourceChunkCharacters: 18_000,
  maxSegmentedQuestions: 300,
  maxQuestionBoundarySubmissions: 5,
  maxQuestionBoundaryAgentRuns: 2,
  maxQuestionAutoOwnedGapRatio: 0.18,
  maxQuestionRecutAttempts: 2,
  maxQuestionVisionImagesPerToolCall: 4,
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
  it('owns twenty pages per group and inspects one adjacent selected page on each side', () => {
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
})

describe('segmentQuestionsInBatches', () => {
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
