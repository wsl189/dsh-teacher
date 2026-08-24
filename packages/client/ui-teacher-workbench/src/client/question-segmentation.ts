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
  const pdfjs = await loadPdfJs()
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loading.promise
  try {
    const page = await pdf.getPage(pageIndex + 1)
    let scale = initialScale
    for (;;) {
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('浏览器无法创建 PDF 画布')
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const blob = await canvasBlob(canvas)
      if (blob.size <= maxBytes) return blob
      if (canvas.width === 1 && canvas.height === 1) {
        throw new Error(`PDF 第 ${String(pageIndex + 1)} 页无法压缩到 OCR 单批大小限制以内`)
      }
      scale /= 2
    }
  } finally {
    await loading.destroy()
  }
}

/**
 * Read the number of pages in one browser-held PDF without retaining a worker document.
 * @param file - PDF selected through the question-workbench upload control.
 * @returns the positive page count reported by PDF.js.
 */
export async function readPdfPageCount(file: File): Promise<number> {
  const pdfjs = await loadPdfJs()
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loading.promise
  try {
    return pdf.numPages
  } finally {
    await loading.destroy()
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
  const pdfjs = await loadPdfJs()
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loading.promise
  try {
    const previews: TeacherQuestionPagePreview[] = []
    for (const pageIndex of pageIndexes) {
      const page = await pdf.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale: Math.max(1, Math.min(2, renderScale)) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d', { alpha: false })
      if (context === null) throw new Error('浏览器无法创建 PDF 预览画布')
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
    }
    return previews
  } finally {
    await loading.destroy()
  }
}

/**
 * Render detected PDF regions and join multi-page questions into PNG uploads.
 * @param file - original browser-held PDF.
 * @param layout - normalized OCR page dimensions used for proportional mapping.
 * @param questions - reviewed detection regions in source order.
 * @param maxQuestionWidthRatio - widest normalized MinerU question region in the PDF.
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
  const pdfjs = await loadPdfJs()
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loading.promise
  const pageLayouts = new Map<number, OcrLayoutPage>(layout.pages.map(page => [page.pageIndex, page] as const))
  const rendered = new Map<number, HTMLCanvasElement>()
  try {
    for (const pageIndex of new Set(questions.flatMap(question => question.regions.map(region => region.pageIndex)))) {
      const page = await pdf.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale: Math.max(1, Math.min(4, renderScale)) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d', { alpha: false })
      if (context === null) throw new Error('浏览器无法创建 PDF 画布')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport }).promise
      rendered.set(pageIndex, canvas)
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
        const targetWidth = Math.max(1, Math.ceil(maxQuestionWidthRatio * source.width))
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
      const width = Math.max(...slices.map(slice => slice.targetWidth))
      const height = slices.reduce((sum, slice) => sum + slice.height, 0) + separator * Math.max(0, slices.length - 1)
      const output = document.createElement('canvas')
      output.width = width
      output.height = height
      const context = output.getContext('2d', { alpha: false })
      if (context === null) throw new Error('浏览器无法创建切题画布')
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
        width: output.width,
        height: output.height,
        contentBase64: await blobBase64(blob),
      })
      progress?.(uploads.length, questions.length)
    }
    return uploads
  } finally {
    await loading.destroy()
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
