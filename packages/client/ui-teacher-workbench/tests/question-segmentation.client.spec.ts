import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OcrLayoutRequest } from '@deepseek-ai/dsh-api-remotes/client'
import { PDFDocument } from 'pdf-lib'
import { extractWorkbenchLayout, type TeacherWorkbenchOcrRemote } from '../src/client/extract-document.ts'
import { parseQuestionPageRange } from '../src/client/question-page-range.ts'
import { partitionQuestionUploads, readPdfPageCount, renderQuestionCrops } from '../src/client/question-segmentation.ts'

const pdfMocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => {}),
  getDocument: vi.fn(),
  workerHandler: { setup: vi.fn() },
}))

vi.mock('pdfjs-dist', () => ({ getDocument: pdfMocks.getDocument }))
vi.mock('pdfjs-dist/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: pdfMocks.workerHandler }))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(globalThis, 'pdfjsWorker')
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

describe('partitionQuestionUploads', () => {
  const upload = (questionNo: number, contentBase64: string) => ({
    questionNo,
    fileName: `第${String(questionNo)}题.png`,
    mediaType: 'image/png' as const,
    width: 1,
    height: 1,
    contentBase64,
  })

  it('preserves question order while splitting decoded bytes below the per-part ceiling', () => {
    const images = [
      upload(1, 'AQIDBA=='),
      upload(2, 'BQYHCA=='),
      upload(3, 'CQoLDA=='),
    ]
    expect(partitionQuestionUploads(images, 8)).toEqual([
      images.slice(0, 2),
      images.slice(2),
    ])
  })

  it('rejects a single crop that cannot fit any save part', () => {
    expect(() => partitionQuestionUploads([upload(9, 'AQIDBA==')], 3)).toThrow('第 9 题')
  })
})

describe('renderQuestionCrops', () => {
  it('directly crops every question between the PDF-wide MinerU horizontal bounds', async () => {
    const canvases: Array<{
      width: number
      height: number
      context: {
        fillStyle: string
        fillRect: ReturnType<typeof vi.fn>
        drawImage: ReturnType<typeof vi.fn>
      }
      getContext: () => unknown
      toBlob: (callback: (blob: Blob | null) => void) => void
    }> = []
    vi.stubGlobal('document', {
      createElement: () => {
        const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
        const canvas = {
          width: 0,
          height: 0,
          context,
          getContext: () => context,
          toBlob: (callback: (blob: Blob | null) => void) => {
            callback(new Blob([Uint8Array.of(1)], { type: 'image/png' }))
          },
        }
        canvases.push(canvas)
        return canvas
      },
    })
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        getPage: async () => ({
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      }),
      destroy: pdfMocks.destroy,
    })
    const file = { arrayBuffer: async () => Uint8Array.of(1).buffer } as File
    const layout = {
      name: 'paper.pdf',
      provider: 'mineru',
      pages: [{ pageIndex: 0, width: 100, height: 100, elements: [] }],
    }
    const questions = [{
      questionNo: 1,
      headPageIndex: 0,
      groupIndex: 0,
      regions: [{ pageIndex: 0, left: 10, top: 10, right: 60, bottom: 30, pageWidth: 100, pageHeight: 100 }],
    }, {
      questionNo: 2,
      headPageIndex: 0,
      groupIndex: 0,
      regions: [{ pageIndex: 0, left: 40, top: 40, right: 90, bottom: 60, pageWidth: 100, pageHeight: 100 }],
    }]

    const uploads = await renderQuestionCrops(
      file,
      layout,
      questions,
      { leftRatio: 0.1, rightRatio: 0.9 },
      1,
    )

    expect(uploads.map(upload => [upload.width, upload.height])).toEqual([[80, 20], [80, 20]])
    expect(canvases[1]?.context.drawImage).toHaveBeenCalledWith(
      canvases[0], 10, 10, 80, 20, 0, 0, 80, 20,
    )
    expect(canvases[2]?.context.drawImage).toHaveBeenCalledWith(
      canvases[0], 10, 40, 80, 20, 0, 0, 80, 20,
    )
    expect(pdfMocks.destroy).toHaveBeenCalledOnce()
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

describe('extractWorkbenchLayout', () => {
  it('copies exact selected pages into provider-sized PDF batches and restores source indexes', async () => {
    const source = await PDFDocument.create()
    for (let index = 0; index < 5; index += 1) source.addPage([600, 800])
    const file = new File([Uint8Array.from(await source.save())], 'paper.pdf', { type: 'application/pdf' })
    expect(file.size).toBeGreaterThan(600)
    const batchSizes: number[] = []
    const remote = {
      layoutLimits: vi.fn(async () => ({
        ok: true,
        value: { ok: true, value: { maxFileBytes: 600, maxPagesPerRequest: 2 } },
      } as const)),
      layout: vi.fn(async (request: OcrLayoutRequest) => {
        const bytes = Uint8Array.from(atob(request.contentBase64), character => character.charCodeAt(0))
        const batch = await PDFDocument.load(bytes)
        const pageCount = batch.getPageCount()
        batchSizes.push(pageCount)
        return {
          ok: true,
          value: {
            ok: true,
            value: {
              name: request.name,
              provider: 'mineru',
              pages: Array.from({ length: pageCount }, (_, pageIndex) => ({
                pageIndex,
                width: 600,
                height: 800,
                elements: [],
              })),
            },
          },
        } as const
      }),
      extract: vi.fn(),
    } satisfies TeacherWorkbenchOcrRemote

    await expect(extractWorkbenchLayout(file, remote, [0, 2, 4])).resolves.toEqual({
      ok: true,
      value: {
        name: 'paper.pdf',
        provider: 'mineru',
        pages: [
          { pageIndex: 0, width: 600, height: 800, elements: [] },
          { pageIndex: 2, width: 600, height: 800, elements: [] },
          { pageIndex: 4, width: 600, height: 800, elements: [] },
        ],
      },
    })
    expect(batchSizes).toEqual([2, 1])
  })

  it('bisects a copied PDF batch until every upload fits the provider byte limit', async () => {
    const source = await PDFDocument.create()
    for (let index = 0; index < 3; index += 1) source.addPage([600, 800])
    const file = new File([Uint8Array.from(await source.save())], 'large.pdf', { type: 'application/pdf' })
    const batchSizes: number[] = []
    const remote = {
      layoutLimits: vi.fn(async () => ({
        ok: true,
        value: { ok: true, value: { maxFileBytes: 580, maxPagesPerRequest: 3 } },
      } as const)),
      layout: vi.fn(async (request: OcrLayoutRequest) => {
        const bytes = Uint8Array.from(atob(request.contentBase64), character => character.charCodeAt(0))
        const batch = await PDFDocument.load(bytes)
        const pageCount = batch.getPageCount()
        batchSizes.push(pageCount)
        return {
          ok: true,
          value: {
            ok: true,
            value: {
              name: request.name,
              provider: 'mineru',
              pages: Array.from({ length: pageCount }, (_, pageIndex) => ({
                pageIndex,
                width: 600,
                height: 800,
                elements: [],
              })),
            },
          },
        } as const
      }),
      extract: vi.fn(),
    } satisfies TeacherWorkbenchOcrRemote

    const result = await extractWorkbenchLayout(file, remote)

    expect(result.ok && result.value.pages.map(page => page.pageIndex)).toEqual([0, 1, 2])
    expect(batchSizes).toEqual([1, 1, 1])
  })

  it('rasterizes and reduces a single copied page that exceeds the provider byte limit', async () => {
    const source = await PDFDocument.create()
    source.addPage([600, 800])
    const file = new File([Uint8Array.from(await source.save())], 'scan.pdf', { type: 'application/pdf' })
    const render = vi.fn(() => ({ promise: Promise.resolve() }))
    const rasterScales: number[] = []
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        getPage: async () => ({
          getViewport: ({ scale }: { scale: number }) => {
            rasterScales.push(scale)
            return { width: 10 * scale, height: 10 * scale }
          },
          render,
        }),
      }),
      destroy: pdfMocks.destroy,
    })
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toBlob(callback: (blob: Blob | null) => void) {
        const size = this.width >= 20 ? 200 : 50
        callback(new Blob([Uint8Array.from({ length: size }, () => 1)], { type: 'image/png' }))
      },
    }
    vi.stubGlobal('document', { createElement: () => canvas as unknown as HTMLCanvasElement })
    const remote = {
      layoutLimits: vi.fn(async () => ({
        ok: true,
        value: { ok: true, value: { maxFileBytes: 100, maxPagesPerRequest: 1 } },
      } as const)),
      layout: vi.fn(async (request: OcrLayoutRequest) => {
        expect(request.mediaType).toBe('image/png')
        expect(atob(request.contentBase64)).toHaveLength(50)
        return {
          ok: true,
          value: {
            ok: true,
            value: {
              name: request.name,
              provider: 'mineru',
              pages: [{ pageIndex: 0, width: 10, height: 10, elements: [] }],
            },
          },
        } as const
      }),
      extract: vi.fn(),
    } satisfies TeacherWorkbenchOcrRemote

    await expect(extractWorkbenchLayout(file, remote, [0], 2)).resolves.toMatchObject({
      ok: true,
      value: { pages: [{ pageIndex: 0 }] },
    })
    expect(render).toHaveBeenCalledTimes(2)
    expect(rasterScales).toEqual([2, 1])
  })
})
