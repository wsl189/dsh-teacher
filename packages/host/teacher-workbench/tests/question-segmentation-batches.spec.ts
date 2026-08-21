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
  maxQuestionBatchBytes: 300,
  maxQuestionLayoutPages: 50,
  maxQuestionLayoutElements: 5_000,
  maxQuestionSourceChunkCharacters: 18_000,
  maxSegmentedQuestions: 300,
  maxQuestionBoundarySubmissions: 5,
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
    const groups = planQuestionSegmentationPageGroups(Array.from({ length: 45 }, (_, index) => index), 20)
    expect(groups.map(group => ({
      core: [group.corePageIndexes[0], group.corePageIndexes.at(-1)],
      inspection: [group.inspectionPageIndexes[0], group.inspectionPageIndexes.at(-1)],
    }))).toEqual([
      { core: [0, 19], inspection: [0, 20] },
      { core: [20, 39], inspection: [19, 40] },
      { core: [40, 44], inspection: [39, 44] },
    ])
  })
})

describe('segmentQuestionsInBatches', () => {
  it('runs bounded overlapping groups and keeps each question only with its head-page owner', async () => {
    const seenPages: number[][] = []
    const runner = vi.fn(async (_ctx: Context, groupRequest: TeacherQuestionSegmentRequest) => {
      const pageIndexes = groupRequest.pages.map(page => page.pageIndex)
      seenPages.push(pageIndexes)
      return {
        ok: true as const,
        value: {
          questions: pageIndexes.map(pageIndex => ({
            questionNo: pageIndex + 1,
            headPageIndex: pageIndex,
            groupIndex: 0,
            regions: [{
              pageIndex, left: 20, top: 20, right: 200, bottom: 50, pageWidth: 600, pageHeight: 800,
            }],
          })),
        },
      }
    })
    const ctx = new Context()
    const result = await segmentQuestionsInBatches(ctx, request(45), CONFIG, runner)

    expect(seenPages.map(pages => [pages[0], pages.at(-1)])).toEqual([[0, 20], [19, 40], [39, 44]])
    expect(result.ok && result.value.questions.map(question => question.questionNo)).toEqual(
      Array.from({ length: 45 }, (_, index) => index + 1),
    )
    expect(result.ok && result.value.questions.filter(question => question.groupIndex === 1).map(question => question.questionNo))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 21))
    expect(result).toMatchObject({ ok: true, value: { groupCount: 3, maxSaveBatchBytes: 300 } })
    await ctx.fiber.dispose()
  })

  it('assigns one source-order display sequence across semantic groups', async () => {
    const runner = vi.fn(async (_ctx: Context, groupRequest: TeacherQuestionSegmentRequest) => ({
      ok: true as const,
      value: {
        questions: groupRequest.pages.map(page => ({
          questionNo: page.pageIndex % 2 + 1,
          headPageIndex: page.pageIndex,
          groupIndex: 0,
          regions: [{
            pageIndex: page.pageIndex,
            left: 20,
            top: 20,
            right: 200,
            bottom: 50,
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
})
