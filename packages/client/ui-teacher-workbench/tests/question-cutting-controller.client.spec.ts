// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type {
  OcrLayoutDocument,
  TeacherQuestionBatchId,
  TeacherQuestionBatchSaveRequest,
  TeacherQuestionImageUpload,
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

const segmented = (): TeacherQuestionSegmentResult => ({
  ok: true,
  value: {
    groupCount: 1,
    maxSaveBatchBytes: 1_000,
    maxQuestionWidthRatio: 0.5,
    questions: [{
      questionNo: 1,
      headPageIndex: 0,
      groupIndex: 0,
      regions: [{
        pageIndex: 0,
        left: 0,
        top: 0,
        right: 50,
        bottom: 50,
        pageWidth: 100,
        pageHeight: 100,
      }],
    }],
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
  pageIndexes: [0],
  pageRange: '1',
  renderScale: 2,
  padding: 8,
})

describe('QuestionCuttingController', () => {
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
      { extractLayout, resolveSegmentation, saveBatch },
      {
        key: () => `job-${String(++key)}`,
        now: () => now += 1_000,
        renderCrops,
        partitionUploads: images => [images],
      },
    )
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    controller.enqueue(request('第一份.pdf'))
    controller.enqueue(request('第二份.pdf'))

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
      'save:第一份.pdf',
      'extract:第二份.pdf',
      'segment:第二份.pdf',
      'render:第二份.pdf',
      'save:第二份.pdf',
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
        saveBatch: async () => ({ ok: true, batchId: 'batch-ok' as TeacherQuestionBatchId }),
      },
      {
        key: (() => {
          let value = 0
          return () => `job-${String(++value)}`
        })(),
        renderCrops: async file => [upload(`${file.name}.png`)],
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
