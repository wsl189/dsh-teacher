/** Browser PDF raster cutting from Host-validated question regions. */

import type {
  OcrLayoutDocument,
  OcrLayoutPage,
  TeacherQuestionPageRegion,
  TeacherQuestionPagePreview,
  TeacherQuestionImageUpload,
  TeacherQuestionSegmentSuccess,
  TeacherSegmentedQuestion,
} from '@deepseek-ai/dsh-api-remotes/client'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs'

/** One page slice contributing pixels to a detected question. */
export type QuestionPageRegion = TeacherQuestionPageRegion

/** One detected question and its one-or-more source page slices. */
export type DetectedQuestion = TeacherSegmentedQuestion

type MaximumQuestionWidthRatio = TeacherQuestionSegmentSuccess['value']['maxQuestionWidthRatio']

/**
 * Split rendered crops into ordered save requests below a decoded-byte ceiling.
 * @param images - ordered browser-rendered question crops.
 * @param maxBytes - Host-advertised aggregate decoded-byte ceiling for one part.
 * @returns non-empty parts preserving question order.
 */
export function partitionQuestionUploads(
  images: readonly TeacherQuestionImageUpload[],
  maxBytes: number,
): readonly (readonly TeacherQuestionImageUpload[])[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('maxBytes must be a positive integer')
  const parts: TeacherQuestionImageUpload[][] = []
  let current: TeacherQuestionImageUpload[] = []
  let currentBytes = 0
  for (const image of images) {
    const bytes = decodedBase64Bytes(image.contentBase64)
    if (bytes > maxBytes) throw new Error(`第 ${String(image.questionNo)} 题图片超过单张保存上限`)
    if (current.length > 0 && currentBytes + bytes > maxBytes) {
      parts.push(current)
      current = []
      currentBytes = 0
    }
    current.push(image)
    currentBytes += bytes
  }
  if (current.length > 0) parts.push(current)
  return parts
}

function decodedBase64Bytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor(value.length * 3 / 4) - padding
}

type PdfJsModule = typeof import('pdfjs-dist')

let pdfJsPromise: Promise<PdfJsModule> | undefined

/** Load PDF.js inside the single-file Client plugin and install its in-process worker. */
function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsPromise ??= Promise.resolve().then(() => {
    const scope = globalThis as typeof globalThis & {
      pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler }
    }
    scope.pdfjsWorker ??= { WorkerMessageHandler }
    return pdfjs
  })
  return pdfJsPromise
}

interface PdfObjectUrl {
  readonly url: string
  readonly release: () => void
}

function browserPdfObjectUrl(file: File): PdfObjectUrl | undefined {
  if (typeof Blob !== 'undefined' && file instanceof Blob && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(file)
    return {
      url,
      release: () => { URL.revokeObjectURL(url) },
    }
  }
  return undefined
}

async function openLoadingTask(file: File): Promise<{
  readonly loading: PDFDocumentLoadingTask
  readonly pdf: PDFDocumentProxy
  readonly release: () => void
}> {
  const module = await loadPdfJs()
  const source = browserPdfObjectUrl(file)
  let loading: PDFDocumentLoadingTask | undefined
  try {
    const input: Parameters<PdfJsModule['getDocument']>[0] = source === undefined
      ? { data: new Uint8Array(await file.arrayBuffer()) }
      : { url: source.url }
    loading = module.getDocument(input)
    const pdf = await loading.promise
    return { loading, pdf, release: () => { source?.release() } }
  } catch (error) {
    await loading?.destroy()
    source?.release()
    throw error
  }
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 1
  canvas.height = 1
}

/** Reusable PDF.js document that bounds one background cut to one source reader. */
export interface QuestionPdfRasterizer {
  /** Positive source page count. */
  readonly pageCount: number
  /** Rasterize one page below the OCR provider's upload ceiling. */
  renderPageForOcr(pageIndex: number, initialScale: number, maxBytes: number): Promise<Blob>
  /** Render only the source pages needed by one visual-review group. */
  renderPagePreviews(
    pageIndexes: readonly number[],
    renderScale: number,
  ): Promise<TeacherQuestionPagePreview[]>
  /** Render one group of detected questions while reusing the open source document. */
  renderCrops(
    layout: OcrLayoutDocument,
    questions: readonly DetectedQuestion[],
    maxQuestionWidthRatio: MaximumQuestionWidthRatio,
    renderScale: number,
    progress?: (completedQuestions: number, totalQuestions: number) => void,
  ): Promise<TeacherQuestionImageUpload[]>
  /** Release PDF.js, its Blob URL, and cached page metrics. */
  dispose(): Promise<void>
}

class BrowserQuestionPdfRasterizer implements QuestionPdfRasterizer {
  readonly pageCount: number
  private disposed = false
  private targetWidthCache: {
    readonly layout: OcrLayoutDocument
    readonly ratio: number
    readonly scale: number
    readonly width: number
  } | undefined

  constructor(
    private readonly loading: PDFDocumentLoadingTask,
    private readonly pdf: PDFDocumentProxy,
    private readonly releaseSource: () => void,
  ) {
    this.pageCount = pdf.numPages
  }

  async renderPageForOcr(pageIndex: number, initialScale: number, maxBytes: number): Promise<Blob> {
    this.assertActive()
    const page = await this.pdf.getPage(pageIndex + 1)
    try {
      let scale = initialScale
      for (;;) {
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('浏览器无法创建 PDF 画布')
        try {
          await page.render({ canvas, canvasContext: context, viewport }).promise
          const blob = await canvasBlob(canvas)
          if (blob.size <= maxBytes) return blob
          if (canvas.width === 1 && canvas.height === 1) {
            throw new Error(`PDF 第 ${String(pageIndex + 1)} 页无法压缩到 OCR 单批大小限制以内`)
          }
        } finally {
          releaseCanvas(canvas)
        }
        scale /= 2
      }
    } finally {
      page.cleanup()
    }
  }

  async renderPagePreviews(
    pageIndexes: readonly number[],
    renderScale: number,
  ): Promise<TeacherQuestionPagePreview[]> {
    this.assertActive()
    const previews: TeacherQuestionPagePreview[] = []
    for (const pageIndex of pageIndexes) {
      const page = await this.pdf.getPage(pageIndex + 1)
      try {
        const viewport = page.getViewport({ scale: Math.max(1, Math.min(2, renderScale)) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        const context = canvas.getContext('2d', { alpha: false })
        if (context === null) throw new Error('浏览器无法创建 PDF 预览画布')
        try {
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvas, canvasContext: context, viewport }).promise
          const blob = await canvasBlob(canvas)
          previews.push({
            pageIndex,
            mediaType: 'image/png',
            width: canvas.width,
            height: canvas.height,
            contentBase64: await blobBase64(blob),
          })
        } finally {
          releaseCanvas(canvas)
        }
      } finally {
        page.cleanup()
      }
    }
    return previews
  }

  async renderCrops(
    layout: OcrLayoutDocument,
    questions: readonly DetectedQuestion[],
    maxQuestionWidthRatio: MaximumQuestionWidthRatio,
    renderScale: number,
    progress?: (completedQuestions: number, totalQuestions: number) => void,
  ): Promise<TeacherQuestionImageUpload[]> {
    this.assertActive()
    if (questions.length === 0) return []
    const pageLayouts = new Map<number, OcrLayoutPage>(layout.pages.map(page => [page.pageIndex, page] as const))
    const rendered = new Map<number, HTMLCanvasElement>()
    try {
      const requiredPageIndexes = new Set(questions.flatMap(question => question.regions.map(region => region.pageIndex)))
      const scale = Math.max(1, Math.min(4, renderScale))
      const targetWidth = await this.targetWidth(layout, maxQuestionWidthRatio, scale)
      for (const pageIndex of requiredPageIndexes) {
        const page = await this.pdf.getPage(pageIndex + 1)
        try {
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.ceil(viewport.width))
          canvas.height = Math.max(1, Math.ceil(viewport.height))
          const context = canvas.getContext('2d', { alpha: false })
          if (context === null) throw new Error('浏览器无法创建 PDF 画布')
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvas, canvasContext: context, viewport }).promise
          rendered.set(pageIndex, canvas)
        } finally {
          page.cleanup()
        }
      }
      const uploads: TeacherQuestionImageUpload[] = []
      for (const question of questions) {
        const slices = question.regions.map((region) => {
          const source = rendered.get(region.pageIndex)
          const pageLayout = pageLayouts.get(region.pageIndex)
          if (source === undefined || pageLayout === undefined) throw new Error('PDF 页渲染结果不完整')
          const scaleY = source.height / pageLayout.height
          const top = Math.max(0, Math.floor(region.top * scaleY))
          const bottom = Math.min(source.height, Math.ceil(region.bottom * scaleY))
          const left = Math.max(0, Math.min(source.width - 1, Math.floor(region.left / region.pageWidth * source.width)))
          const rightLimit = Math.max(
            left + 1,
            Math.min(source.width, Math.ceil(region.rightLimit / region.pageWidth * source.width)),
          )
          const right = Math.min(rightLimit, left + targetWidth)
          const excludedAreas = region.excludedAreas.flatMap((area) => {
            const areaLeft = Math.max(0, Math.floor(area[0] / region.pageWidth * source.width) - left)
            const areaTop = Math.max(0, Math.floor(area[1] * scaleY) - top)
            const areaRight = Math.min(right - left, Math.ceil(area[2] / region.pageWidth * source.width) - left)
            const areaBottom = Math.min(bottom - top, Math.ceil(area[3] * scaleY) - top)
            return areaRight > areaLeft && areaBottom > areaTop
              ? [{ left: areaLeft, top: areaTop, width: areaRight - areaLeft, height: areaBottom - areaTop }]
              : []
          })
          return {
            source,
            left,
            top,
            width: Math.max(1, right - left),
            targetWidth,
            height: Math.max(1, bottom - top),
            excludedAreas,
          }
        })
        const separator = slices.length > 1 ? 12 : 0
        const width = targetWidth
        const height = slices.reduce((sum, slice) => sum + slice.height, 0) + separator * Math.max(0, slices.length - 1)
        const output = document.createElement('canvas')
        output.width = width
        output.height = height
        const context = output.getContext('2d', { alpha: false })
        if (context === null) throw new Error('浏览器无法创建切题画布')
        try {
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, width, height)
          let y = 0
          for (const slice of slices) {
            context.drawImage(
              slice.source,
              slice.left,
              slice.top,
              slice.width,
              slice.height,
              0,
              y,
              slice.width,
              slice.height,
            )
            for (const area of slice.excludedAreas) {
              context.fillRect(area.left, y + area.top, area.width, area.height)
            }
            y += slice.height + separator
          }
          const blob = await canvasBlob(output)
          uploads.push({
            questionNo: question.questionNo,
            fileName: `第${String(question.questionNo)}题.png`,
            mediaType: 'image/png',
            width,
            height,
            contentBase64: await blobBase64(blob),
          })
        } finally {
          releaseCanvas(output)
        }
        progress?.(uploads.length, questions.length)
      }
      return uploads
    } finally {
      for (const canvas of rendered.values()) releaseCanvas(canvas)
      rendered.clear()
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.targetWidthCache = undefined
    try {
      await this.loading.destroy()
    } finally {
      this.releaseSource()
    }
  }

  private async targetWidth(
    layout: OcrLayoutDocument,
    ratio: number,
    scale: number,
  ): Promise<number> {
    const cached = this.targetWidthCache
    if (cached?.layout === layout && cached.ratio === ratio && cached.scale === scale) return cached.width
    let width = 1
    for (const pageLayout of layout.pages) {
      const page = await this.pdf.getPage(pageLayout.pageIndex + 1)
      try {
        const viewport = page.getViewport({ scale })
        width = Math.max(width, Math.ceil(ratio * Math.max(1, Math.ceil(viewport.width))))
      } finally {
        page.cleanup()
      }
    }
    this.targetWidthCache = { layout, ratio, scale, width }
    return width
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('PDF rasterizer is disposed')
  }
}

/**
 * Open one browser PDF through a Blob URL so large files stay outside the JavaScript heap.
 * @param file - browser-held source PDF.
 * @returns reusable page renderer owned by one background-cut operation.
 */
export async function openQuestionPdfRasterizer(file: File): Promise<QuestionPdfRasterizer> {
  const opened = await openLoadingTask(file)
  return new BrowserQuestionPdfRasterizer(opened.loading, opened.pdf, () => { opened.release() })
}

/**
 * Rasterize one source PDF page into a PNG that fits one OCR upload request.
 * @param file - original browser-held PDF.
 * @param pageIndex - zero-based source page index.
 * @param initialScale - configured PDF.js render scale.
 * @param maxBytes - provider-advertised decoded upload limit.
 * @returns PNG bytes whose size does not exceed `maxBytes`.
 */
export async function renderPdfPageForOcr(
  file: File,
  pageIndex: number,
  initialScale: number,
  maxBytes: number,
): Promise<Blob> {
  const rasterizer = await openQuestionPdfRasterizer(file)
  try {
    return await rasterizer.renderPageForOcr(pageIndex, initialScale, maxBytes)
  } finally {
    await rasterizer.dispose()
  }
}

/**
 * Read the number of pages in one browser-held PDF without retaining a worker document.
 * @param file - PDF selected through the question-workbench upload control.
 * @returns the positive page count reported by PDF.js.
 */
export async function readPdfPageCount(file: File): Promise<number> {
  const rasterizer = await openQuestionPdfRasterizer(file)
  try {
    return rasterizer.pageCount
  } finally {
    await rasterizer.dispose()
  }
}

/**
 * Render selected PDF pages for multimodal boundary understanding without changing final crop resolution.
 * @param file - original browser-held PDF.
 * @param pageIndexes - exact zero-based pages requested by semantic segmentation.
 * @param renderScale - configured PDF render scale, capped for preview transport.
 * @returns one PNG preview for every requested page in source order.
 */
export async function renderQuestionPagePreviews(
  file: File,
  pageIndexes: readonly number[],
  renderScale: number,
): Promise<TeacherQuestionPagePreview[]> {
  const rasterizer = await openQuestionPdfRasterizer(file)
  try {
    return await rasterizer.renderPagePreviews(pageIndexes, renderScale)
  } finally {
    await rasterizer.dispose()
  }
}

/**
 * Render detected PDF regions and join multi-page questions into PNG uploads.
 * @param file - original browser-held PDF.
 * @param layout - normalized OCR page dimensions used for proportional mapping.
 * @param questions - reviewed detection regions in source order.
 * @param maxQuestionWidthRatio - maximum non-outlier normalized safe-lane extent from a fixed question left edge.
 * @param renderScale - bounded PDF.js raster scale.
 * @param progress - optional callback after each complete question crop.
 * @returns browser-produced PNG payloads ready for Host persistence.
 */
export async function renderQuestionCrops(
  file: File,
  layout: OcrLayoutDocument,
  questions: readonly DetectedQuestion[],
  maxQuestionWidthRatio: MaximumQuestionWidthRatio,
  renderScale: number,
  progress?: (completedQuestions: number, totalQuestions: number) => void,
): Promise<TeacherQuestionImageUpload[]> {
  const rasterizer = await openQuestionPdfRasterizer(file)
  try {
    return await rasterizer.renderCrops(
      layout,
      questions,
      maxQuestionWidthRatio,
      renderScale,
      progress,
    )
  } finally {
    await rasterizer.dispose()
  }
}

/**
 * Rotate one PNG question crop clockwise for the built-in image editor.
 * @param image - current raster payload.
 * @returns a PNG payload rotated by ninety degrees.
 */
export async function rotateQuestionCrop(
  image: TeacherQuestionImageUpload,
): Promise<TeacherQuestionImageUpload> {
  const blob = new Blob([base64Bytes(image.contentBase64)], { type: image.mediaType })
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.height
    canvas.height = bitmap.width
    const context = canvas.getContext('2d', { alpha: false })
    if (context === null) throw new Error('浏览器无法创建图片编辑画布')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.translate(canvas.width, 0)
    context.rotate(Math.PI / 2)
    context.drawImage(bitmap, 0, 0)
    const output = await canvasBlob(canvas)
    return {
      ...image,
      mediaType: 'image/png',
      width: canvas.width,
      height: canvas.height,
      contentBase64: await blobBase64(output),
    }
  } finally {
    bitmap.close()
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('图片编码失败'))
      else resolve(blob)
    }, 'image/png')
  })
}

async function blobBase64(blob: Blob): Promise<string> {
  const data = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64Bytes(content: string): Uint8Array<ArrayBuffer> {
  const binary = atob(content)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
