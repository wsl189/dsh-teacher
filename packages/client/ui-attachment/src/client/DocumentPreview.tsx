import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import DOMPurify from 'dompurify'
import { getSlides, loadPresentation } from '@office-kit/pptx'
import { renderSlideToSvg } from '@office-kit/pptx-preview'
import { fromArrayBuffer, loadWorkbook } from '@office-kit/xlsx/io'
import type { Workbook } from '@office-kit/xlsx/workbook'
import { cellValueAsString } from '@office-kit/xlsx/cell'
import { getCell, getMaxCol, getMaxRow } from '@office-kit/xlsx/worksheet'
import { renderAsync } from 'docx-preview'
import type { ComposerAttachmentsProps, DraftDocument } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './DocumentPreview.module.css'

const WORKSHEET_PREVIEW_MAX_ROWS = 200
const WORKSHEET_PREVIEW_MAX_COLUMNS = 50

type Translate = ComposerAttachmentsProps['t']
type Presentation = Awaited<ReturnType<typeof loadPresentation>>

/** Browser-held file and row metadata backing one transient sidebar tab. */
export interface DocumentPreviewSource {
  /** Public OCR row whose identity and name address the tab. */
  readonly document: DraftDocument
  /** Immutable browser file retained until the draft row is released. */
  readonly file: File
  /** Conversation namespace translator captured from the composer slot. */
  readonly t: Translate
}

/** Preview renderer selected from an uploaded file's extension. */
export type DocumentPreviewKind = 'pdf' | 'pptx' | 'docx' | 'xlsx' | 'image' | 'unsupported'

const IMAGE_EXTENSIONS = new Set(['bmp', 'jpeg', 'jpg', 'png', 'webp'])
const OFFICE_PREVIEW_KINDS = new Set<DocumentPreviewKind>(['docx', 'pptx', 'xlsx'])

function extension(path: string): string {
  const name = path.replace(/^.*[\\/]/u, '')
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Classify the formats accepted by the document-upload control.
 * @param path - uploaded file name.
 * @returns the specialized renderer kind or `unsupported`.
 */
export function documentPreviewKind(path: string): DocumentPreviewKind {
  const ext = extension(path)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'pptx') return 'pptx'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx') return 'xlsx'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'unsupported'
}

function Pager({ page, total, setPage, t }: {
  page: number
  total: number
  setPage: (page: number) => void
  t: Translate
}) {
  return (
    <div className={css.pager}>
      <button type="button" disabled={page <= 1} onClick={() => { setPage(page - 1) }}>
        {t('document.previewPrevious')}
      </button>
      <span>{t('document.previewSlide', {
        page: String(page), total: String(total),
      })}</span>
      <button type="button" disabled={page >= total} onClick={() => { setPage(page + 1) }}>
        {t('document.previewNext')}
      </button>
    </div>
  )
}

/** Render a PDF with the browser's native PDF surface. */
function PdfPreview({ url, name, t }: { url: string; name: string; t: Translate }) {
  return <iframe className={css.pdf} src={url} title={t('document.previewTitle', { name })} />
}

/** Render a browser-native image through the source file's owned Blob URL. */
function ImagePreview({ url, name }: { url: string; name: string }) {
  return <img className={css.image} src={url} alt={name} />
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
  const slides = useMemo(() => presentation === null ? [] : getSlides(presentation), [presentation])
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
  if (presentation === null) return <div className={css.status}>{t('document.previewLoading')}</div>
  if (svg === undefined) return <div className={css.status}>{t('document.previewEmpty')}</div>
  return (
    <div className={css.documentPreview}>
      <Pager page={page} total={slides.length} setPage={setPage} t={t} />
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
    const body = bodyRef.current as HTMLDivElement
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
      {loading && <div className={css.status}>{t('document.previewLoading')}</div>}
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
  if (workbook === null) return <div className={css.status}>{t('document.previewLoading')}</div>
  const sheet = workbook.sheets[sheetIndex]
  if (sheet === undefined || sheet.kind !== 'worksheet') {
    return <div className={css.status}>{t('document.previewEmpty')}</div>
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
        ? <div className={css.status}>{t('document.previewEmpty')}</div>
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
        <div className={css.truncated}>{t('document.previewSheetTruncated', {
          rows: String(rowCount), columns: String(columnCount),
        })}</div>
      )}
    </div>
  )
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; bytes: Uint8Array }

/** Load and render one browser-held upload inside a better-sidebar tab. */
export function DocumentPreview({ document, file, t }: DocumentPreviewSource) {
  const kind = documentPreviewKind(document.name)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => { URL.revokeObjectURL(next) }
  }, [file])

  useEffect(() => {
    if (!OFFICE_PREVIEW_KINDS.has(kind)) return
    let active = true
    setState({ kind: 'loading' })
    void file.arrayBuffer().then(
      (buffer) => { if (active) setState({ kind: 'ready', bytes: new Uint8Array(buffer) }) },
      (reason: unknown) => {
        if (active) setState({ kind: 'failed', message: reason instanceof Error ? reason.message : String(reason) })
      },
    )
    return () => { active = false }
  }, [file, kind, revision])

  let body: ReactNode
  if (kind === 'unsupported') body = <div className={css.status}>{t('document.previewUnsupported')}</div>
  else if (kind === 'pdf' || kind === 'image') {
    if (url === undefined) body = <div className={css.status}>{t('document.previewLoading')}</div>
    else body = kind === 'pdf'
      ? <PdfPreview url={url} name={document.name} t={t} />
      : <ImagePreview url={url} name={document.name} />
  } else if (state.kind === 'loading') body = <div className={css.status}>{t('document.previewLoading')}</div>
  else if (state.kind === 'failed') {
    body = (
      <div className={css.failure}>
        <div className={css.error}>{state.message}</div>
        <button type="button" onClick={() => { setRevision(value => value + 1) }}>
          {t('document.previewRetry')}
        </button>
      </div>
    )
  } else {
    if (kind === 'pptx') body = <PptxPreview bytes={state.bytes} t={t} />
    else if (kind === 'docx') body = <DocxPreview bytes={state.bytes} t={t} />
    else body = <XlsxPreview bytes={state.bytes} t={t} />
  }

  return (
    <div className={css.root} data-upload-document-preview={document.name}>
      <div className={css.toolbar}>
        {url !== undefined && <a href={url} download={document.name}>{t('document.previewDownload')}</a>}
      </div>
      <div className={css.body}>{body}</div>
    </div>
  )
}
