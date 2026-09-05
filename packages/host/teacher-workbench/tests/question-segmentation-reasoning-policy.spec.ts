import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import type { TeacherQuestionSegmentationBatchConfig } from '../src/question-segmentation-batches.ts'
import type { TeacherQuestionSegmentationAgentConfig } from '../src/question-segmentation-agent.ts'
import type { TeacherQuestionCropReviewRequest, TeacherQuestionSegmentRequest } from '../src/types.ts'

const segmentationMocks = vi.hoisted(() => ({
  segment: vi.fn(async (
    _ctx: Context,
    _request: TeacherQuestionSegmentRequest,
    _config: TeacherQuestionSegmentationBatchConfig,
  ) => ({
    ok: false as const,
    error: { code: 'invalid-request' as const, message: 'test' },
  })),
  review: vi.fn(async (
    _ctx: Context,
    _request: TeacherQuestionCropReviewRequest,
    _config: TeacherQuestionSegmentationAgentConfig,
  ) => ({
    ok: false as const,
    error: { code: 'invalid-request' as const, message: 'test' },
  })),
}))

vi.mock('../src/question-segmentation-batches.ts', () => ({
  segmentQuestionsInBatches: segmentationMocks.segment,
}))

vi.mock('../src/question-segmentation-agent.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/question-segmentation-agent.ts')>()
  return { ...actual, reviewQuestionCropsWithAgent: segmentationMocks.review }
})

import TeacherWorkbenchService from '../src/index.ts'

const contexts: Context[] = []

function provideQuestionAgents(ctx: Context) {
  const dispose = vi.fn(async () => {})
  const create = vi.fn(async (options: {
    readonly sessionId: ReturnType<typeof SessionId>
    readonly meta?: { readonly origin?: string; readonly delegationDepth?: number }
  }) => ({
    agent: { id: options.sessionId },
    dispose,
  }))
  ctx.provide('agents', { create, get: () => undefined } as never)
  return { create, dispose }
}

afterEach(async () => {
  segmentationMocks.segment.mockClear()
  segmentationMocks.review.mockClear()
  await Promise.all(contexts.splice(0).map(async (ctx) => {
    await ctx.fiber.dispose()
  }))
})

describe('question segmentation reasoning policy', () => {
  it('overrides the Host default with each segmentation and review request', async () => {
    const parentSessionId = SessionId('reasoning-policy-parent')
    const page = { pageIndex: 0, width: 100, height: 100, elements: [] }
    for (const [index, hostDefault, reasoningEnabled] of [
      [0, true, false],
      [1, false, true],
    ] as const) {
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(Storage)
      ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
      const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
      ctx.storage.mount('domain', facility)
      ctx.provide('storageDomain', facility)
      provideQuestionAgents(ctx)
      await ctx.plugin(TeacherWorkbenchService, {
        ...TeacherWorkbenchService.Config({} as never),
        questionSegmentationReasoningEnabled: hostDefault,
      })
      const service = ctx.teacherWorkbench
      const fileName = `思考策略-${String(index)}.pdf`

      await service.segmentQuestions({
        parentSessionId,
        reasoningEnabled,
        fileName,
        pages: [page],
        padding: 4,
      })
      await service.reviewQuestionCrops({
        parentSessionId,
        reasoningEnabled,
        fileName,
        groupIndex: 0,
        corePageIndexes: [0],
        recutAttempt: 0,
        reviewQuestionIds: [],
        pages: [page],
        pagePreviews: [],
        questions: [],
        crops: [],
        padding: 4,
      })
      await service.segmentQuestions({
        parentSessionId,
        fileName,
        pages: [page],
        padding: 4,
      })
    }

    expect(segmentationMocks.segment.mock.calls.map(call => (
      call[2]?.questionSegmentationReasoningEnabled
    ))).toEqual([false, true, true, false])
    expect(segmentationMocks.review.mock.calls.map(call => (
      call[2]?.questionSegmentationReasoningEnabled
    ))).toEqual([false, true])
  })

  it('owns one hidden processing session when no user conversation exists', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    const { create, dispose } = provideQuestionAgents(ctx)
    await ctx.plugin(TeacherWorkbenchService, TeacherWorkbenchService.Config({} as never))
    const service = ctx.teacherWorkbench
    const page = { pageIndex: 0, width: 100, height: 100, elements: [] }

    await service.segmentQuestions({
      fileName: '无对话切题.pdf',
      pages: [page],
      padding: 4,
    })
    await service.reviewQuestionCrops({
      fileName: '无对话切题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [],
      pages: [page],
      pagePreviews: [],
      questions: [],
      crops: [],
      padding: 4,
    })
    await service.segmentQuestions({
      parentSessionId: SessionId('stale-user-session'),
      fileName: '旧客户端切题.pdf',
      pages: [page],
      padding: 4,
    })

    expect(create).toHaveBeenCalledOnce()
    const createOptions = create.mock.calls[0]?.[0]
    expect(createOptions?.meta?.origin).toBe('subagent')
    expect(createOptions?.meta?.delegationDepth).toBe(0)
    const workerSessionId = createOptions?.sessionId
    expect(workerSessionId).toBeDefined()
    expect(segmentationMocks.segment.mock.calls.map(call => call[1]?.parentSessionId)).toEqual([
      workerSessionId,
      workerSessionId,
    ])
    expect(segmentationMocks.review.mock.calls[0]?.[1].parentSessionId).toBe(workerSessionId)

    await ctx.fiber.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
