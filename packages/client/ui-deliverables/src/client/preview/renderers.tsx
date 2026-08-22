import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { getSlides, loadPresentation } from '@office-kit/pptx'
import { renderSlideToSvg } from '@office-kit/pptx-preview'
import { fromArrayBuffer, loadWorkbook } from '@office-kit/xlsx/io'
import type { Workbook } from '@office-kit/xlsx/workbook'
import { cellValueAsString } from '@office-kit/xlsx/cell'
import { getCell, getMaxCol, getMaxRow } from '@office-kit/xlsx/worksheet'
import { renderAsync } from 'docx-preview'
import * as pdfjs from 'pdfjs-dist'
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilePreviewProps } from './FilePreview.tsx'
import css from './FilePreview.module.css'

const WORKSHEET_PREVIEW_MAX_ROWS = 200
const WORKSHEET_PREVIEW_MAX_COLUMNS = 50

type Translate = FilePreviewProps['t']
type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
type Presentation = Awaited<ReturnType<typeof loadPresentation>>

const workerScope = globalThis as typeof globalThis & {
  pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler }
}
workerScope.pdfjsWorker ??= { WorkerMessageHandler }

/** Preview renderer selected from a produced file's extension. */
export type PreviewKind = 'pdf' | 'pptx' | 'docx' | 'xlsx' | 'markdown' | 'image' | 'unsupported'

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

function extension(path: string): string {
  const name = path.split(/[\\/]/u).at(-1) ?? path
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Classify supported file extensions.
 * @param path - produced path as recorded by the mutation tool.
 * @returns The specialized renderer kind or `unsupported`.
 */
export function previewKind(path: string): PreviewKind {
  const ext = extension(path)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'pptx') return 'pptx'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx'
  if (['md', 'markdown', 'mdown', 'mkd'].includes(ext)) return 'markdown'
  if (IMAGE_MEDIA_TYPES[ext] !== undefined) return 'image'
  return 'unsupported'
}

/** Decode the API's complete Base64 payload without widening it through JSON arrays. */
export function decodePreviewBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function Pager({ page, total, unit, setPage, t }: {
  page: number
  total: number
  unit: 'page' | 'slide'
  setPage: (page: number) => void
  t: Translate
}) {
  return (
    <div className={css.pager}>
      <button type="button" disabled={page <= 1} onClick={() => { setPage(page - 1) }}>
        {t('preview.previous')}
      </button>
      <span>{t(unit === 'page' ? 'preview.page' : 'preview.slide', {
        page: String(page), total: String(total),
      })}</span>
      <button type="button" disabled={page >= total} onClick={() => { setPage(page + 1) }}>
        {t('preview.next')}
      </button>
    </div>
  )
}

/** Render settled Markdown through the same sanitized renderer as assistant messages. */
export function MarkdownPreview({ bytes }: { bytes: Uint8Array }) {
  const text = useMemo(() => new TextDecoder().decode(bytes), [bytes])
  return <div className={css.markdown}><MarkdownText text={text} /></div>
}

/** Render a browser-native image through an owned Blob URL. */
export function ImagePreview({ bytes, path }: { bytes: Uint8Array; path: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const mediaType = IMAGE_MEDIA_TYPES[extension(path)] ?? 'application/octet-stream'
    const next = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mediaType }))
    setUrl(next)
    return () => { URL.revokeObjectURL(next) }
  }, [bytes, path])
  return url === undefined ? null : <img className={css.image} src={url} alt="" />
}

/** Render one PDF page at panel width; page changes replace the canvas task. */
export function PdfPreview({ bytes, t }: { bytes: Uint8Array; t: Translate }) {
  const [document, setDocument] = useState<PdfDocument | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const loading = pdfjs.getDocument({ data: bytes.slice() })
    let active = true
    setDocument(null)
    setPage(1)
    setError(undefined)
    void loading.promise.then(
      (next) => { if (active) setDocument(next) },
      (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) },
    )
    return () => {
      active = false
      void loading.destroy()
    }
  }, [bytes])

  useEffect(() => {
    if (document === null) return
    let active = true
    let cancel: (() => void) | undefined
    void document.getPage(page).then(async (pdfPage) => {
      const canvas = canvasRef.current
      const stage = stageRef.current
      if (!active || canvas === null || stage === null) return
      const base = pdfPage.getViewport({ scale: 1 })
      const cssScale = Math.min(1.5, Math.max(0.25, (stage.clientWidth - 8) / base.width))
      const outputScale = Math.min(globalThis.devicePixelRatio || 1, 2)
      const viewport = pdfPage.getViewport({ scale: cssScale * outputScale })
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('Canvas is unavailable')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      canvas.style.width = `${String(viewport.width / outputScale)}px`
      canvas.style.height = `${String(viewport.height / outputScale)}px`
      const task = pdfPage.render({ canvas, canvasContext: context, viewport })
      cancel = () => { task.cancel() }
      await task.promise
    }).catch((reason: unknown) => {
      if (active && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    })
    return () => {
      active = false
      cancel?.()
    }
  }, [document, page])

  if (error !== undefined) return <div className={css.error}>{error}</div>
  if (document === null) return <div className={css.status}>{t('preview.loading')}</div>
  return (
    <div className={css.documentPreview}>
      <Pager page={page} total={document.numPages} unit="page" setPage={setPage} t={t} />
      <div ref={stageRef} className={css.canvasStage}><canvas ref={canvasRef} /></div>
    </div>
  )
}

/** Render one PPTX slide to sanitized SVG. */
export function PptxPreview({ bytes, t }: { bytes: Uint8Array; t: Translate }) {
  const [presentation, setPresentation] = useState<Presentation | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    setPresentation(null)
    setPage(1)
    setError(undefined)
    void loadPresentation(bytes).then(
      (next) => { if (active) setPresentation(next) },
      (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) },
    )
    return () => { active = false }
  }, [bytes])
  const slides = presentation === null ? [] : getSlides(presentation)
  const svg = useMemo(() => {
    if (presentation === null) return undefined
    const slide = slides[page - 1]
    if (slide === undefined) return undefined
    return DOMPurify.sanitize(renderSlideToSvg(presentation, slide), {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      ADD_TAGS: ['foreignObject'],
    })
  }, [page, presentation, slides])
  if (error !== undefined) return <div className={css.error}>{error}</div>
  if (presentation === null) return <div className={css.status}>{t('preview.loading')}</div>
  if (svg === undefined || slides.length === 0) return <div className={css.status}>{t('preview.empty')}</div>
  return (
    <div className={css.documentPreview}>
      <Pager page={page} total={slides.length} unit="slide" setPage={setPage} t={t} />
      <div className={css.slide} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}

/** Render DOCX into a plugin-owned DOM container and clear library resources on replacement. */
export function DocxPreview({ bytes, t }: { bytes: Uint8Array; t: Translate }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const body = bodyRef.current
    if (body === null) return
    let active = true
    body.replaceChildren()
    setError(undefined)
    setLoading(true)
    void renderAsync(new Blob([bytes.slice().buffer]), body, body, {
      breakPages: true,
      inWrapper: true,
      ignoreLastRenderedPageBreak: false,
    }).then(
      () => { if (active) setLoading(false) },
      (reason: unknown) => {
        if (!active) return
        setLoading(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => {
      active = false
      body.replaceChildren()
    }
  }, [bytes])
  return (
    <div className={css.wordPreview}>
      {loading && <div className={css.status}>{t('preview.loading')}</div>}
      {error !== undefined && <div className={css.error}>{error}</div>}
      <div ref={bodyRef} />
    </div>
  )
}

function columnName(index: number): string {
  let value = index
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + value % 26) + result
    value = Math.floor(value / 26)
  }
  return result
}

/** Render the selected XLSX worksheet as a bounded semantic table. */
export function XlsxPreview({ bytes, t }: { bytes: Uint8Array; t: Translate }) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    setWorkbook(null)
    setSheetIndex(0)
    setError(undefined)
    void loadWorkbook(fromArrayBuffer(bytes)).then(
      (next) => { if (active) setWorkbook(next) },
      (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) },
    )
    return () => { active = false }
  }, [bytes])
  if (error !== undefined) return <div className={css.error}>{error}</div>
  if (workbook === null) return <div className={css.status}>{t('preview.loading')}</div>
  const sheet = workbook.sheets[sheetIndex]
  if (sheet === undefined || sheet.kind !== 'worksheet') {
    return <div className={css.status}>{t('preview.empty')}</div>
  }
  const maxRow = getMaxRow(sheet.sheet)
  const maxColumn = getMaxCol(sheet.sheet)
  const rowCount = Math.min(maxRow, WORKSHEET_PREVIEW_MAX_ROWS)
  const columnCount = Math.min(maxColumn, WORKSHEET_PREVIEW_MAX_COLUMNS)
  const truncated = rowCount < maxRow || columnCount < maxColumn
  return (
    <div className={css.workbook}>
      <div className={css.sheetTabs} role="tablist">
        {workbook.sheets.map((candidate, index) => (
          <button
            key={candidate.sheetId}
            type="button"
            role="tab"
            aria-selected={index === sheetIndex}
            onClick={() => { setSheetIndex(index) }}
          >
            {candidate.sheet.title}
          </button>
        ))}
      </div>
      {rowCount === 0 || columnCount === 0
        ? <div className={css.status}>{t('preview.empty')}</div>
        : (
          <div className={css.sheetScroll}>
            <table>
              <thead>
                <tr><th />{Array.from(
                  { length: columnCount },
                  (_, index) => <th key={index}>{columnName(index + 1)}</th>,
                )}</tr>
              </thead>
              <tbody>
                {Array.from({ length: rowCount }, (_, rowIndex) => (
                  <tr key={rowIndex}>
                    <th>{rowIndex + 1}</th>
                    {Array.from({ length: columnCount }, (_, columnIndex) => (
                      <td key={columnIndex}>{cellValueAsString(
                        getCell(sheet.sheet, rowIndex + 1, columnIndex + 1)?.value ?? null,
                      )}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {truncated && (
        <div className={css.truncated}>{t('preview.sheetTruncated', {
          rows: String(rowCount), columns: String(columnCount),
        })}</div>
      )}
    </div>
  )
}
