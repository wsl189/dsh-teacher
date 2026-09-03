// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type {
  OcrLayoutDocument,
  TeacherQuestionBatchId,
  TeacherQuestionBatchSaveRequest,
  TeacherQuestionCropReviewRequest,
  TeacherQuestionImageUpload,
  TeacherQuestionLayoutElementId,
  TeacherQuestionLibraryFolderId,
  TeacherQuestionSegmentResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  QuestionCuttingController,
  type QuestionCuttingEnqueueRequest,
} from '../src/client/question-cutting-controller.ts'

vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: {} }))

const layout = (name: string): OcrLayoutDocument => ({
  name,
  provider: 'mineru',
  pages: [{ pageIndex: 0, width: 100, height: 100, elements: [] }],
})

const segmented = (questionCount = 1): TeacherQuestionSegmentResult => ({
  ok: true,
  value: {
    groupCount: 1,
    maxConcurrentGroups: 1,
    groups: [{ groupIndex: 0, corePageIndexes: [0], inspectionPageIndexes: [0] }],
    maxSaveBatchBytes: 1_000,
    maxRecutAttempts: 1,
    maxQuestionWidthRatio: 1,
    questions: Array.from({ length: questionCount }, (_, index) => ({
      sourceHeadId: `p0e${String(index)}` as TeacherQuestionLayoutElementId,
      questionNo: index + 1,
      headPageIndex: 0,
      groupIndex: 0,
      regions: [{
        pageIndex: 0,
        left: 0,
        top: index * 20,
        right: 50,
        rightLimit: 100,
        bottom: index * 20 + 20,
        excludedAreas: [],
        pageWidth: 100,
        pageHeight: 100,
      }],
    })),
  },
})

const upload = (fileName: string): TeacherQuestionImageUpload => ({
  questionNo: 1,
  fileName,
  mediaType: 'image/png',
  width: 50,
  height: 50,
  contentBase64: 'AQ==',
})

const request = (fileName: string): QuestionCuttingEnqueueRequest => ({
  file: new File([Uint8Array.of(1)], fileName, { type: 'application/pdf' }),
  pageCount: 1,
  pageIndexes: [0],
  pageRange: '1',
  renderScale: 2,
  padding: 8,
})

describe('QuestionCuttingController', () => {
  it('completes a verified zero-question selection without creating an empty batch', async () => {
    const saveBatch = vi.fn(async () => ({ ok: true as const, batchId: 'unused' as TeacherQuestionBatchId }))
    const controller = new QuestionCuttingController(
      {
        extractLayout: async () => ({ ok: true, value: layout('知识讲义.pdf') }),
        resolveSegmentation: () => async () => segmented(0),
        resolveCropReview: () => async review => ({
          ok: true,
          value: { decision: 'accepted', affectedQuestionIds: [], questions: review.questions },
        }),
        saveBatch,
      },
      {
        key: () => 'zero-question',
        renderCrops: async () => [],
        renderPagePreviews: async () => [{
          pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: 'AQ==',
        }],
        partitionUploads: images => [images],
      },
    )

    controller.enqueue(request('知识讲义.pdf'))
    await waitFor(() => { expect(controller.getSnapshot().jobs[0]?.stage).toBe('completed') })

    expect(controller.getSnapshot().jobs[0]).toMatchObject({
      pageRange: '1',
      progress: 100,
      questionCount: 0,
      savedCount: 0,
    })
    expect(saveBatch).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('extracts adjacent source pages as context while assigning heads only to selected pages', async () => {
    const sourceLayout: OcrLayoutDocument = {
      name: '跨页题.pdf',
      provider: 'mineru',
      pages: [0, 1, 2].map(pageIndex => ({ pageIndex, width: 100, height: 100, elements: [] })),
    }
    const question = {
      sourceHeadId: 'p1e0' as TeacherQuestionLayoutElementId,
      questionNo: 1,
      headPageIndex: 1,
      groupIndex: 0,
      regions: [{
        pageIndex: 1,
        left: 0,
        top: 0,
        right: 50,
        rightLimit: 100,
        bottom: 20,
        excludedAreas: [],
        pageWidth: 100,
        pageHeight: 100,
      }],
    }
    const extractLayout = vi.fn(async (
      _file: File,
      pageIndexes: readonly number[],
    ) => {
      expect(pageIndexes).toEqual([0, 1, 2])
      return { ok: true as const, value: sourceLayout }
    })
    const segmentQuestions = vi.fn(async (
      receivedLayout: OcrLayoutDocument,
      _padding: number,
      pagePreviews: readonly { readonly pageIndex: number }[],
      corePageIndexes: readonly number[],
    ): Promise<TeacherQuestionSegmentResult> => {
      expect(receivedLayout.pages.map(page => page.pageIndex)).toEqual([0, 1, 2])
      expect(pagePreviews.map(preview => preview.pageIndex)).toEqual([0, 1, 2])
      expect(corePageIndexes).toEqual([1])
      return {
        ok: true,
        value: {
          groupCount: 1,
          groups: [{ groupIndex: 0, corePageIndexes: [1], inspectionPageIndexes: [0, 1, 2] }],
          maxConcurrentGroups: 1,
          maxSaveBatchBytes: 1_000,
          maxRecutAttempts: 1,
          maxQuestionWidthRatio: 1,
          questions: [question],
        },
      }
    })
    const controller = new QuestionCuttingController(
      {
        extractLayout,
        resolveSegmentation: () => segmentQuestions,
        resolveCropReview: () => async review => ({
          ok: true,
          value: { decision: 'accepted', affectedQuestionIds: [], questions: review.questions },
        }),
        saveBatch: async () => ({ ok: true, batchId: 'context-pages' as TeacherQuestionBatchId }),
      },
      {
        key: () => 'context-pages',
        renderCrops: async (_file, _layout, questions) => questions.map(item => ({
          ...upload(`${String(item.sourceHeadId)}.png`),
          questionNo: item.questionNo,
        })),
        renderPagePreviews: async (_file, pageIndexes) => pageIndexes.map(pageIndex => ({
          pageIndex,
          mediaType: 'image/png' as const,
          width: 1,
          height: 1,
          contentBase64: 'AQ==',
        })),
        partitionUploads: images => [images],
      },
    )

    controller.enqueue({
      ...request('跨页题.pdf'),
      pageCount: 3,
      pageIndexes: [1],
      pageRange: '2',
    })
    await waitFor(() => { expect(controller.getSnapshot().jobs[0]?.stage).toBe('completed') })

    expect(extractLayout).toHaveBeenCalledOnce()
    expect(segmentQuestions).toHaveBeenCalledOnce()
    await controller.dispose()
  })

  it('reviews independent semantic groups concurrently and saves them in source order', async () => {
    const sourceLayout: OcrLayoutDocument = {
      name: '并行复核.pdf',
      provider: 'mineru',
      pages: [0, 1].map(pageIndex => ({ pageIndex, width: 100, height: 100, elements: [] })),
    }
    const questions = [0, 1].map(pageIndex => ({
      sourceHeadId: `p${String(pageIndex)}e0` as TeacherQuestionLayoutElementId,
      questionNo: pageIndex + 1,
      headPageIndex: pageIndex,
      groupIndex: pageIndex,
      regions: [{
        pageIndex, left: 0, top: 0, right: 50, rightLimit: 100, bottom: 20,
        excludedAreas: [], pageWidth: 100, pageHeight: 100,
      }],
    }))
    const release = Promise.withResolvers<undefined>()
    let active = 0
    let maximumActive = 0
    const reviewCrops = vi.fn(async (review: Omit<TeacherQuestionCropReviewRequest, 'parentSessionId'>) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await release.promise
      active -= 1
      return {
        ok: true as const,
        value: { decision: 'accepted' as const, affectedQuestionIds: [], questions: review.questions },
      }
    })
    const savedQuestionNos: number[] = []
    const controller = new QuestionCuttingController(
      {
        extractLayout: async () => ({ ok: true, value: sourceLayout }),
        resolveSegmentation: () => async () => ({
          ok: true,
          value: {
            groupCount: 2,
            groups: [0, 1].map(groupIndex => ({
              groupIndex,
              corePageIndexes: [groupIndex],
              inspectionPageIndexes: [groupIndex],
            })),
            maxConcurrentGroups: 2,
            maxSaveBatchBytes: 1_000,
            maxRecutAttempts: 1,
            maxQuestionWidthRatio: 1,
            questions,
          },
        }),
        resolveCropReview: () => reviewCrops,
        saveBatch: async (save) => {
          savedQuestionNos.push(...save.images.map(image => image.questionNo))
          return { ok: true, batchId: 'parallel' as TeacherQuestionBatchId }
        },
      },
      {
        key: () => 'parallel-review',
        renderCrops: async (_file, _layout, renderedQuestions) => renderedQuestions.map(question => ({
          ...upload(`${String(question.sourceHeadId)}.png`),
          questionNo: question.questionNo,
        })),
        renderPagePreviews: async () => [0, 1].map(pageIndex => ({
          pageIndex, mediaType: 'image/png' as const, width: 1, height: 1, contentBase64: 'AQ==',
        })),
        partitionUploads: images => [images],
      },
    )

    controller.enqueue({ ...request('并行复核.pdf'), pageIndexes: [0, 1], pageRange: '1-2' })
    await waitFor(() => { expect(maximumActive).toBe(2) })
    release.resolve(undefined)
    await waitFor(() => { expect(controller.getSnapshot().jobs[0]?.stage).toBe('completed') })

    expect(reviewCrops).toHaveBeenCalledTimes(2)
    expect(savedQuestionNos).toEqual([1, 2])
    await controller.dispose()
  })

  it('narrows a follow-up recut to local pages even when every current question changed', async () => {
    const multiPageLayout: OcrLayoutDocument = {
      name: '整页漏题.pdf',
      provider: 'mineru',
      pages: [0, 1, 2].map(pageIndex => ({ pageIndex, width: 100, height: 100, elements: [] })),
    }
    const initial = segmented()
    if (!initial.ok) throw new Error('segmentation fixture is invalid')
    const question = {
      ...initial.value.questions[0]!,
      sourceHeadId: 'p2e0' as TeacherQuestionLayoutElementId,
      headPageIndex: 2,
      regions: [{
        pageIndex: 2, left: 0, top: 0, right: 50, rightLimit: 100, bottom: 20,
        excludedAreas: [], pageWidth: 100, pageHeight: 100,
      }],
    }
    let reviewPass = 0
    const reviewCrops = vi.fn(async (review: Omit<TeacherQuestionCropReviewRequest, 'parentSessionId'>) => {
      reviewPass += 1
      expect(review.pagePreviews.map(preview => preview.pageIndex)).toEqual(
        reviewPass === 1 ? [0, 1, 2] : [1, 2],
      )
      if (reviewPass === 1) {
        return {
          ok: true as const,
          value: {
            decision: 'revised' as const,
            affectedQuestionIds: [question.sourceHeadId],
            questions: review.questions.map(item => ({
              ...item,
              regions: item.regions.map(region => ({ ...region, bottom: region.bottom + 1 })),
            })),
          },
        }
      }
      return {
        ok: true as const,
        value: { decision: 'accepted' as const, affectedQuestionIds: [], questions: review.questions },
      }
    })
    const controller = new QuestionCuttingController(
      {
        extractLayout: async () => ({ ok: true, value: multiPageLayout }),
        resolveSegmentation: () => async () => ({
          ...initial,
          value: {
            ...initial.value,
            groups: [{ groupIndex: 0, corePageIndexes: [0, 1, 2], inspectionPageIndexes: [0, 1, 2] }],
            maxRecutAttempts: 2,
            questions: [question],
          },
        }),
        resolveCropReview: () => reviewCrops,
        saveBatch: async () => ({ ok: true, batchId: 'all-pages' as TeacherQuestionBatchId }),
      },
      {
        key: () => 'all-core-pages',
        renderCrops: async (_file, _layout, questions) => questions.map(item => ({
          ...upload(`${String(item.sourceHeadId)}.png`), questionNo: item.questionNo,
        })),
        renderPagePreviews: async () => [0, 1, 2].map(pageIndex => ({
          pageIndex, mediaType: 'image/png' as const, width: 1, height: 1, contentBase64: 'AQ==',
        })),
        partitionUploads: images => [images],
      },
    )

    controller.enqueue({ ...request('整页漏题.pdf'), pageIndexes: [0, 1, 2], pageRange: '1-3' })
    await waitFor(() => { expect(controller.getSnapshot().jobs[0]?.stage).toBe('completed') })

    expect(reviewCrops).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })

  it('reviews an empty preliminary group and adds a visually detected missing question', async () => {
    const initial = segmented(0)
    if (!initial.ok) throw new Error('segmentation fixture is invalid')
    const recovered = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1,
      headPageIndex: 0,
      groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 0, top: 0, right: 50, rightLimit: 100, bottom: 20,
        excludedAreas: [], pageWidth: 100, pageHeight: 100,
      }],
    }
    let reviewPass = 0
    const reviewCrops = vi.fn(async (review: Omit<TeacherQuestionCropReviewRequest, 'parentSessionId'>) => {
      reviewPass += 1
      if (reviewPass === 1) {
        expect(review.reviewQuestionIds).toEqual([])
        expect(review.crops).toEqual([])
        expect(review.pagePreviews.map(preview => preview.pageIndex)).toEqual([0])
        return {
          ok: true as const,
          value: {
            decision: 'revised' as const,
            affectedQuestionIds: [recovered.sourceHeadId],
            questions: [recovered],
          },
        }
      }
      expect(review.reviewQuestionIds).toEqual([recovered.sourceHeadId])
      return {
        ok: true as const,
        value: { decision: 'accepted' as const, affectedQuestionIds: [], questions: review.questions },
      }
    })
    const rendered: string[][] = []
    const renderCrops = vi.fn(async (
      _file: File,
      _layout: OcrLayoutDocument,
      questions: TeacherQuestionCropReviewRequest['questions'],
    ) => {
      rendered.push(questions.map(question => question.sourceHeadId))
      return questions.map(question => ({
        ...upload(`${String(question.sourceHeadId)}.png`),
        questionNo: question.questionNo,
      }))
    })
    const saveBatch = vi.fn(async () => ({ ok: true as const, batchId: 'recovered' as TeacherQuestionBatchId }))
    const controller = new QuestionCuttingController(
      {
        extractLayout: async file => ({ ok: true, value: layout(file.name) }),
        resolveSegmentation: () => async () => ({
          ...initial,
          value: { ...initial.value, maxRecutAttempts: 2 },
        }),
        resolveCropReview: () => reviewCrops,
        saveBatch,
      },
      {
        key: () => 'zero-question-recovery',
        renderCrops,
        renderPagePreviews: async () => [{
          pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: 'AQ==',
        }],
        partitionUploads: images => [images],
      },
    )

    controller.enqueue(request('漏题恢复.pdf'))
    await waitFor(() => { expect(controller.getSnapshot().jobs[0]?.stage).toBe('completed') })

    expect(reviewCrops).toHaveBeenCalledTimes(2)
    expect(rendered).toEqual([[], ['p0e0'], ['p0e0']])
    expect(saveBatch).toHaveBeenCalledWith(expect.objectContaining({
      images: [expect.objectContaining({ fileName: 'p0e0.png' })],
    }))
    await controller.dispose()
  })

  it('rerenders only the defective crop, confirms it, and preserves the fixed group width', async () => {
    const initial = segmented(3)
    if (!initial.ok) throw new Error('segmentation fixture is invalid')
    const fixedWidthQuestions = initial.value.questions.map((question, index) => ({
      ...question,
      regions: question.regions.map(region => ({
        ...region,
        rightLimit: index === 2 ? 95 : 50,
      })),
    }))
    const segmentQuestions = vi.fn(async (): Promise<TeacherQuestionSegmentResult> => ({
      ...initial,
      value: {
        ...initial.value,
        maxRecutAttempts: 2,
        maxQuestionWidthRatio: 0.7,
        questions: fixedWidthQuestions,
      },
    }))
    let reviewPass = 0
    const reviewCrops = vi.fn(async (review: Omit<TeacherQuestionCropReviewRequest, 'parentSessionId'>) => {
      reviewPass += 1
      if (reviewPass > 1) {
        return {
          ok: true as const,
          value: { decision: 'accepted' as const, affectedQuestionIds: [], questions: review.questions },
        }
      }
      return {
        ok: true as const,
        value: {
          decision: 'revised' as const,
          affectedQuestionIds: ['p0e1' as TeacherQuestionLayoutElementId],
          questions: review.questions.map(question => ({
            ...question,
            regions: question.sourceHeadId === 'p0e1'
              ? question.regions.map(region => ({ ...region, right: 40 }))
              : question.regions,
          })),
        },
      }
    })
    const renders: Array<{ ids: string[]; rights: number[]; widthRatio: number }> = []
    const renderCrops = vi.fn(async (
      _file: File,
      _layout: OcrLayoutDocument,
      questions: TeacherQuestionCropReviewRequest['questions'],
      widthRatio: number,
    ) => {
      const rights = questions.map(question => question.regions[0]?.right)
      if (rights.some(right => right === undefined)) throw new Error('render fixture has no question region')
      renders.push({
        ids: questions.map(question => question.sourceHeadId),
        rights: rights as number[],
        widthRatio,
      })
      return questions.map((question, index) => ({
        ...upload(`${String(question.sourceHeadId)}-right-${String(rights[index])}.png`),
        questionNo: question.questionNo,
        width: Math.round(widthRatio * 100),
      }))
    })
    const saveBatch = vi.fn(async (_request: TeacherQuestionBatchSaveRequest) => (
      { ok: true as const, batchId: 'corrected' as TeacherQuestionBatchId }
    ))
    const controller = new QuestionCuttingController(
      {
        extractLayout: async file => ({ ok: true, value: layout(file.name) }),
        resolveSegmentation: () => segmentQuestions,
        resolveCropReview: () => reviewCrops,
        saveBatch,
      },
      {
        key: () => 'corrected-job',
        renderCrops,
        renderPagePreviews: async () => [{
          pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: 'AQ==',
        }],
        partitionUploads: images => [images],
      },
    )

    controller.enqueue(request('需要重切.pdf'))
    await waitFor(() => { expect(controller.getSnapshot().jobs[0]?.stage).toBe('completed') })

    expect(reviewCrops).toHaveBeenCalledTimes(2)
    expect(renders).toEqual([
      { ids: ['p0e0', 'p0e1', 'p0e2'], rights: [50, 50, 50], widthRatio: 0.7 },
      { ids: ['p0e1'], rights: [40], widthRatio: 0.7 },
      { ids: ['p0e0', 'p0e1', 'p0e2'], rights: [50, 40, 50], widthRatio: 0.7 },
    ])
    const savedImages = saveBatch.mock.calls[0]?.[0].images ?? []
    expect(savedImages.some(image => image.fileName === 'p0e1-right-40.png' && image.width === 70)).toBe(true)
    await controller.dispose()
  })

  it('saves the latest safe regions and reports an unverified group when the final recut remains defective', async () => {
    const initial = segmented()
    if (!initial.ok) throw new Error('segmentation fixture is invalid')
    const reviewCrops = vi.fn(async (review: Omit<TeacherQuestionCropReviewRequest, 'parentSessionId'>) => {
      const right = review.recutAttempt === 0 ? 45 : 35
      return {
        ok: true as const,
        value: {
          decision: 'revised' as const,
          affectedQuestionIds: review.reviewQuestionIds,
          questions: review.questions.map(question => ({
            ...question,
            regions: question.regions.map(region => ({ ...region, right })),
          })),
        },
      }
    })
    const renderedRights: number[] = []
    const renderCrops = vi.fn(async (
      _file: File,
      _layout: OcrLayoutDocument,
      questions: TeacherQuestionCropReviewRequest['questions'],
    ) => {
      const right = questions[0]?.regions[0]?.right
      if (right === undefined) throw new Error('render fixture has no question region')
      renderedRights.push(right)
      return [{ ...upload(`right-${String(right)}.png`) }]
    })
    const saveBatch = vi.fn(async () => ({ ok: true as const, batchId: 'last-recut' as TeacherQuestionBatchId }))
    const controller = new QuestionCuttingController(
      {
        extractLayout: async file => ({ ok: true, value: layout(file.name) }),
        resolveSegmentation: () => async () => ({
          ...initial,
          value: { ...initial.value, maxRecutAttempts: 2 },
        }),
        resolveCropReview: () => reviewCrops,
        saveBatch,
      },
      {
        key: () => 'persistent-defect',
        renderCrops,
        renderPagePreviews: async () => [{
          pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: 'AQ==',
        }],
        partitionUploads: images => [images],
      },
    )

    controller.enqueue(request('持续异常.pdf'))
    await waitFor(() => { expect(controller.getSnapshot().jobs[0]?.stage).toBe('completed') })

    expect(reviewCrops).toHaveBeenCalledTimes(2)
    expect(renderedRights).toEqual([50, 45, 35])
    expect(saveBatch).toHaveBeenCalledWith(expect.objectContaining({
      images: [expect.objectContaining({ fileName: 'right-35.png' })],
    }))
    expect(controller.getSnapshot().jobs[0]).toMatchObject({
      stage: 'completed',
      unverifiedGroupCount: 1,
    })
    await controller.dispose()
  })

  it('retains an unresolved group without repeating the same visual review', async () => {
    const reviewCrops = vi.fn(async (review: Omit<TeacherQuestionCropReviewRequest, 'parentSessionId'>) => ({
      ok: true as const,
      value: {
        decision: 'unresolved' as const,
        affectedQuestionIds: review.reviewQuestionIds,
        questions: review.questions,
      },
    }))
    const saveBatch = vi.fn(async () => ({ ok: true as const, batchId: 'unresolved' as TeacherQuestionBatchId }))
    const initial = segmented()
    if (!initial.ok) throw new Error('segmentation fixture is invalid')
    const controller = new QuestionCuttingController(
      {
        extractLayout: async file => ({ ok: true, value: layout(file.name) }),
        resolveSegmentation: () => async () => ({
          ...initial,
          value: { ...initial.value, maxRecutAttempts: 2 },
        }),
        resolveCropReview: () => reviewCrops,
        saveBatch,
      },
      {
        key: () => 'unresolved-review',
        renderCrops: async () => [{ ...upload('unresolved.png') }],
        renderPagePreviews: async () => [{
          pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: 'AQ==',
        }],
        partitionUploads: images => [images],
      },
    )

    controller.enqueue(request('无法复核.pdf'))
    await waitFor(() => { expect(controller.getSnapshot().jobs[0]?.stage).toBe('completed') })

    expect(reviewCrops).toHaveBeenCalledOnce()
    expect(saveBatch).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().jobs[0]).toMatchObject({
      stage: 'completed',
      unverifiedGroupCount: 1,
    })
    await controller.dispose()
  })

  it('accepts consecutive PDFs, runs them sequentially, and completes without a mounted subscriber', async () => {
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const operations: string[] = []
    const extractLayout = vi.fn(async (
      file: File,
      _pageIndexes: readonly number[],
      _renderScale: number,
      progress: (completedPages: number, totalPages: number) => void,
    ) => {
      operations.push(`extract:${file.name}`)
      progress(1, 1)
      if (file.name === '第一份.pdf') await firstGate
      return { ok: true as const, value: layout(file.name) }
    })
    const firstSegment = vi.fn(async () => {
      operations.push('segment:第一份.pdf')
      return segmented()
    })
    const secondSegment = vi.fn(async () => {
      operations.push('segment:第二份.pdf')
      return segmented()
    })
    const resolveSegmentation = vi.fn()
      .mockReturnValueOnce(firstSegment)
      .mockReturnValueOnce(secondSegment)
    const resolveCropReview = vi.fn(() => async (review: Omit<TeacherQuestionCropReviewRequest, 'parentSessionId'>) => {
      operations.push('review')
      return {
        ok: true as const,
        value: { decision: 'accepted' as const, affectedQuestionIds: [], questions: review.questions },
      }
    })
    const renderCrops = vi.fn(async (file: File, ...args: readonly unknown[]) => {
      operations.push(`render:${file.name}`)
      const progress = args.at(-1) as (completedQuestions: number, totalQuestions: number) => void
      progress(1, 1)
      return [upload(`${file.name}.png`)]
    })
    const saveBatch = vi.fn(async (request: TeacherQuestionBatchSaveRequest) => {
      operations.push(`save:${request.sourceName}`)
      return { ok: true as const, batchId: `batch-${request.sourceName}` as TeacherQuestionBatchId }
    })
    let key = 0
    let now = 1_000
    const controller = new QuestionCuttingController(
      { extractLayout, resolveSegmentation, resolveCropReview, saveBatch },
      {
        key: () => `job-${String(++key)}`,
        now: () => now += 1_000,
        renderCrops,
        renderPagePreviews: async () => [{
          pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: 'AQ==',
        }],
        partitionUploads: images => [images],
      },
    )
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    controller.enqueue(request('第一份.pdf'))
    controller.enqueue({
      ...request('第二份.pdf'),
      folderId: 'selected-folder' as TeacherQuestionLibraryFolderId,
    })

    expect(resolveSegmentation).toHaveBeenCalledTimes(2)
    expect(extractLayout).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().jobs.map(job => [job.fileName, job.stage, job.progress])).toEqual([
      ['第一份.pdf', 'extracting', 40],
      ['第二份.pdf', 'queued', 0],
    ])

    unsubscribe()
    releaseFirst?.()
    await waitFor(() => {
      expect(controller.getSnapshot().jobs.map(job => job.stage)).toEqual(['completed', 'completed'])
    })

    expect(operations).toEqual([
      'extract:第一份.pdf',
      'segment:第一份.pdf',
      'render:第一份.pdf',
      'review',
      'render:第一份.pdf',
      'save:第一份.pdf',
      'extract:第二份.pdf',
      'segment:第二份.pdf',
      'render:第二份.pdf',
      'review',
      'render:第二份.pdf',
      'save:第二份.pdf',
    ])
    expect(saveBatch.mock.calls.map(([saved]) => saved.destination)).toEqual([
      { kind: 'source-folder' },
      { kind: 'library-folder', folderId: 'selected-folder' },
    ])
    expect(controller.getSnapshot().jobs.map(job => ({
      fileName: job.fileName,
      progress: job.progress,
      savedCount: job.savedCount,
    }))).toEqual([
      { fileName: '第一份.pdf', progress: 100, savedCount: 1 },
      { fileName: '第二份.pdf', progress: 100, savedCount: 1 },
    ])
    expect(listener).toHaveBeenCalled()
    await controller.dispose()
  })

  it('fails a PDF without blocking the next queued task', async () => {
    const extractLayout = vi.fn(async (file: File) => file.name === '损坏.pdf'
      ? { ok: false as const, error: { code: 'provider-unavailable' as const, message: 'OCR unavailable' } }
      : { ok: true as const, value: layout(file.name) })
    const controller = new QuestionCuttingController(
      {
        extractLayout,
        resolveSegmentation: () => async () => segmented(),
        resolveCropReview: () => async review => ({
          ok: true,
          value: { decision: 'accepted', affectedQuestionIds: [], questions: review.questions },
        }),
        saveBatch: async () => ({ ok: true, batchId: 'batch-ok' as TeacherQuestionBatchId }),
      },
      {
        key: (() => {
          let value = 0
          return () => `job-${String(++value)}`
        })(),
        renderCrops: async file => [upload(`${file.name}.png`)],
        renderPagePreviews: async () => [{
          pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: 'AQ==',
        }],
        partitionUploads: images => [images],
      },
    )

    controller.enqueue(request('损坏.pdf'))
    controller.enqueue(request('正常.pdf'))

    await waitFor(() => {
      expect(controller.getSnapshot().jobs.map(job => job.stage)).toEqual(['failed', 'completed'])
    })
    expect(controller.getSnapshot().jobs[0]).toMatchObject({
      failureCode: 'operation-failed',
      failureMessage: 'OCR unavailable',
    })
    await controller.dispose()
  })
})
