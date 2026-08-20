import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OcrLayoutDocument } from '@deepseek-ai/dsh-api-remotes/client'
import { parseQuestionPageRange } from '../src/client/question-page-range.ts'
import { detectQuestions, readPdfPageCount } from '../src/client/question-segmentation.ts'

const pdfMocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => {}),
  getDocument: vi.fn(),
  workerHandler: { setup: vi.fn() },
}))

vi.mock('pdfjs-dist', () => ({ getDocument: pdfMocks.getDocument }))
vi.mock('pdfjs-dist/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: pdfMocks.workerHandler }))

afterEach(() => {
  vi.clearAllMocks()
  Reflect.deleteProperty(globalThis, 'pdfjsWorker')
})

function layout(): OcrLayoutDocument {
  return {
    name: 'math.pdf',
    provider: 'mineru',
    pages: [
      {
        pageIndex: 0,
        width: 720,
        height: 1000,
        elements: [
          { type: 'text', text: '数学试卷', bbox: [100, 20, 300, 50] },
          { type: 'text', text: '1. 已知函数', bbox: [42, 120, 400, 150] },
          { type: 'text', text: '1) 干扰选项', bbox: [430, 300, 600, 330] },
          { type: 'text', text: '2．求下列值', bbox: [43, 620, 400, 650] },
        ],
      },
      {
        pageIndex: 1,
        width: 720,
        height: 1000,
        elements: [
          { type: 'text', text: '续页内容', bbox: [60, 40, 300, 70] },
          { type: 'text', text: '3、证明不等式', bbox: [44, 310, 420, 345] },
        ],
      },
    ],
  }
}

describe('detectQuestions', () => {
  it('selects the continuous left-margin number chain and cuts across pages', () => {
    const questions = detectQuestions(layout(), 10)
    expect(questions.map(question => question.questionNo)).toEqual([1, 2, 3])
    expect(questions[0]?.regions).toEqual([{ pageIndex: 0, top: 110, bottom: 610, pageWidth: 720, pageHeight: 1000 }])
    expect(questions[1]?.regions).toEqual([
      { pageIndex: 0, top: 610, bottom: 1000, pageWidth: 720, pageHeight: 1000 },
      { pageIndex: 1, top: 0, bottom: 300, pageWidth: 720, pageHeight: 1000 },
    ])
    expect(questions[2]?.regions).toEqual([{ pageIndex: 1, top: 300, bottom: 1000, pageWidth: 720, pageHeight: 1000 }])
  })

  it('accepts a selected range whose first visible question is not number one', () => {
    const selected: OcrLayoutDocument = {
      name: 'selected.pdf',
      provider: 'mineru',
      pages: [{
        pageIndex: 4,
        width: 720,
        height: 1000,
        elements: [
          { type: 'text', text: '8. 第一题', bbox: [40, 100, 300, 130] },
          { type: 'text', text: '9. 第二题', bbox: [40, 500, 300, 530] },
        ],
      }],
    }
    expect(detectQuestions(selected, 0).map(question => question.questionNo)).toEqual([8, 9])
  })
})

describe('readPdfPageCount', () => {
  it('loads the bundled in-process PDF.js worker before reading browser bytes', async () => {
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 4 }),
      destroy: pdfMocks.destroy,
    })
    const file = {
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    } as File

    await expect(readPdfPageCount(file)).resolves.toBe(4)
    expect(pdfMocks.getDocument).toHaveBeenCalledWith({ data: Uint8Array.from([1, 2, 3]) })
    expect(pdfMocks.destroy).toHaveBeenCalledOnce()
    expect((globalThis as { pdfjsWorker?: unknown }).pdfjsWorker).toEqual({
      WorkerMessageHandler: pdfMocks.workerHandler,
    })
  })
})

describe('parseQuestionPageRange', () => {
  it('keeps the original comma-separated range behavior and exact gaps', () => {
    expect(parseQuestionPageRange('1-3, 6，8', 10)).toEqual({
      start: 0,
      end: 7,
      pageIndexes: [0, 1, 2, 5, 7],
      label: '1-3, 6,8',
    })
  })

  it('treats a blank range as every page and rejects out-of-bounds input', () => {
    expect(parseQuestionPageRange('', 3)).toEqual({ start: 0, end: 2, pageIndexes: [0, 1, 2], label: '' })
    expect(() => parseQuestionPageRange('2-5', 4)).toThrow('1-4')
  })
})
