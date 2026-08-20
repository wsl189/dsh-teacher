/** Deterministic MinerU-layout question detection and browser PDF raster cutting. */

import type {
  OcrLayoutDocument,
  OcrLayoutPage,
  TeacherQuestionImageUpload,
} from '@deepseek-ai/dsh-api-remotes/client'

/** One page slice contributing pixels to a detected question. */
export interface QuestionPageRegion {
  /** Zero-based source PDF page index. */
  readonly pageIndex: number
  /** Top coordinate in MinerU page units. */
  readonly top: number
  /** Bottom coordinate in MinerU page units. */
  readonly bottom: number
  /** MinerU page width. */
  readonly pageWidth: number
  /** MinerU page height. */
  readonly pageHeight: number
}

/** One detected question and its one-or-more source page slices. */
export interface DetectedQuestion {
  /** Number recognized at the question marker. */
  readonly questionNo: number
  /** Source regions joined vertically into the saved raster. */
  readonly regions: readonly QuestionPageRegion[]
}

type PdfJsModule = typeof import('pdfjs-dist')
type PdfJsWorkerModule = typeof import('pdfjs-dist/build/pdf.worker.mjs')

let pdfJsPromise: Promise<PdfJsModule> | undefined

/** Load PDF.js inside the single-file Client plugin and install its in-process worker. */
function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs'),
  ]).then(([pdfjs, worker]) => {
    const scope = globalThis as typeof globalThis & {
      pdfjsWorker?: { WorkerMessageHandler: PdfJsWorkerModule['WorkerMessageHandler'] }
    }
    scope.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler }
    return pdfjs
  })
  return pdfJsPromise
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

interface QuestionMarker {
  readonly questionNo: number
  readonly pageIndex: number
  readonly top: number
  readonly left: number
}

/**
 * Find a monotonic question-number chain and convert it into page crop regions.
 * @param layout - normalized OCR pages and reading-order elements.
 * @param padding - extra vertical page units retained around each marker boundary.
 * @returns detected questions in source order.
 */
export function detectQuestions(layout: OcrLayoutDocument, padding: number): DetectedQuestion[] {
  const pages = [...layout.pages].sort((left, right) => left.pageIndex - right.pageIndex)
  const markers = chooseMarkerChain(pages.flatMap(findPageMarkers))
  return markers.map((marker, index) => {
    const next = markers[index + 1]
    return {
      questionNo: marker.questionNo,
      regions: questionRegions(pages, marker, next, Math.max(0, padding)),
    }
  }).filter(question => question.regions.length > 0)
}

/**
 * Render detected PDF regions and join multi-page questions into PNG uploads.
 * @param file - original browser-held PDF.
 * @param layout - normalized OCR page dimensions used for proportional mapping.
 * @param questions - reviewed detection regions in source order.
 * @param renderScale - bounded PDF.js raster scale.
 * @returns browser-produced PNG payloads ready for Host persistence.
 */
export async function renderQuestionCrops(
  file: File,
  layout: OcrLayoutDocument,
  questions: readonly DetectedQuestion[],
  renderScale: number,
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
        return { source, top, height: Math.max(1, bottom - top) }
      })
      const separator = slices.length > 1 ? 12 : 0
      const width = Math.max(...slices.map(slice => slice.source.width))
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
        context.drawImage(slice.source, 0, slice.top, slice.source.width, slice.height, 0, y, slice.source.width, slice.height)
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

function findPageMarkers(page: OcrLayoutPage): QuestionMarker[] {
  const maxLeft = page.width * 0.38
  return page.elements.flatMap((element): QuestionMarker[] => {
    if (element.type !== 'text' && element.type !== 'equation') return []
    const match = /^\s*(?:第\s*)?(\d{1,3})\s*(?:[.．、:：)）]|题(?:\s|$))/u.exec(element.text)
    if (match?.[1] === undefined || element.bbox[0] > maxLeft) return []
    const questionNo = Number(match[1])
    return Number.isSafeInteger(questionNo) && questionNo > 0
      ? [{ questionNo, pageIndex: page.pageIndex, top: element.bbox[1], left: element.bbox[0] }]
      : []
  })
}

function chooseMarkerChain(raw: readonly QuestionMarker[]): QuestionMarker[] {
  const markers = [...raw].sort((left, right) => left.pageIndex - right.pageIndex || left.top - right.top || left.left - right.left)
  if (markers.length < 2) return markers
  let best: QuestionMarker[] = []
  for (let start = 0; start < markers.length; start += 1) {
    const first = markers[start]
    if (first === undefined) continue
    const chain = [first]
    let expected = first.questionNo + 1
    for (let index = start + 1; index < markers.length; index += 1) {
      const candidate = markers[index]
      if (candidate?.questionNo !== expected) continue
      chain.push(candidate)
      expected += 1
    }
    const preferred = chain.length > best.length
      || (chain.length === best.length
        && (chain[0]?.questionNo ?? Number.MAX_SAFE_INTEGER) < (best[0]?.questionNo ?? Number.MAX_SAFE_INTEGER))
    if (preferred) best = chain
  }
  return best.length >= 2 ? best : markers
}

function questionRegions(
  pages: readonly OcrLayoutPage[],
  marker: QuestionMarker,
  next: QuestionMarker | undefined,
  padding: number,
): QuestionPageRegion[] {
  const lastPageIndex = next?.pageIndex ?? pages.at(-1)?.pageIndex ?? marker.pageIndex
  return pages.filter(page => page.pageIndex >= marker.pageIndex && page.pageIndex <= lastPageIndex).flatMap((page) => {
    const top = page.pageIndex === marker.pageIndex ? Math.max(0, marker.top - padding) : 0
    const bottom = next !== undefined && page.pageIndex === next.pageIndex
      ? Math.min(page.height, Math.max(0, next.top - padding))
      : page.height
    return bottom > top
      ? [{ pageIndex: page.pageIndex, top, bottom, pageWidth: page.width, pageHeight: page.height }]
      : []
  })
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
