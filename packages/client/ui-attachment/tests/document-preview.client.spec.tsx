// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComposerAttachmentsProps, DraftDocument } from '@deepseek-ai/dsh-client-ui-conversation/client'

const office = vi.hoisted(() => ({
  cellValueAsString: vi.fn(),
  fromArrayBuffer: vi.fn(),
  getCell: vi.fn(),
  getMaxCol: vi.fn(),
  getMaxRow: vi.fn(),
  getSlides: vi.fn(),
  loadPresentation: vi.fn(),
  loadWorkbook: vi.fn(),
  renderAsync: vi.fn(),
  renderSlideToSvg: vi.fn(),
}))

vi.mock('@office-kit/pptx', () => ({
  getSlides: office.getSlides,
  loadPresentation: office.loadPresentation,
}))
vi.mock('@office-kit/pptx-preview', () => ({ renderSlideToSvg: office.renderSlideToSvg }))
vi.mock('@office-kit/xlsx/io', () => ({
  fromArrayBuffer: office.fromArrayBuffer,
  loadWorkbook: office.loadWorkbook,
}))
vi.mock('@office-kit/xlsx/cell', () => ({ cellValueAsString: office.cellValueAsString }))
vi.mock('@office-kit/xlsx/worksheet', () => ({
  getCell: office.getCell,
  getMaxCol: office.getMaxCol,
  getMaxRow: office.getMaxRow,
}))
vi.mock('docx-preview', () => ({ renderAsync: office.renderAsync }))

import {
  DocumentPreview, DocxPreview, PptxPreview, XlsxPreview, documentPreviewKind,
} from '../src/client/DocumentPreview.tsx'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const t = ((key: string, values?: Record<string, string>): string => {
  const messages: Record<string, string> = {
    'document.previewDownload': 'Download',
    'document.previewEmpty': 'Empty',
    'document.previewLoading': 'Loading',
    'document.previewNext': 'Next',
    'document.previewPrevious': 'Previous',
    'document.previewRetry': 'Retry',
    'document.previewSheetTruncated': 'Limited {rows}x{columns}',
    'document.previewSlide': 'Slide {page} of {total}',
    'document.previewTitle': '{name} preview',
    'document.previewUnsupported': 'Unsupported',
  }
  let message = messages[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) message = message.replace(`{${name}}`, value)
  return message
}) as ComposerAttachmentsProps['t']

function row(name: string): DraftDocument {
  return { id: `document:${name}` as DraftDocument['id'], name, status: 'extracting' }
}

function fileWithArrayBuffer(name: string, arrayBuffer: () => Promise<ArrayBuffer>): File {
  const file = new File([Uint8Array.of(1)], name)
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer })
  return file
}

function stubBlobUrls(): { create: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> } {
  const create = vi.fn((file: File) => `blob:${file.name}`)
  const revoke = vi.fn()
  const NativeURL = URL
  class PreviewURL extends NativeURL {
    static override createObjectURL = create
    static override revokeObjectURL = revoke
  }
  vi.stubGlobal('URL', PreviewURL)
  return { create, revoke }
}

function worksheet(title: string, sheetId = title): {
  sheetId: string
  kind: 'worksheet'
  sheet: { title: string }
} {
  return { sheetId, kind: 'worksheet', sheet: { title } }
}

beforeEach(() => {
  vi.resetAllMocks()
  office.fromArrayBuffer.mockImplementation((value: unknown) => value)
  office.getSlides.mockReturnValue([])
  office.loadPresentation.mockResolvedValue({})
  office.loadWorkbook.mockResolvedValue({ sheets: [] })
  office.renderAsync.mockResolvedValue(undefined)
  office.renderSlideToSvg.mockReturnValue('<svg><text>slide</text></svg>')
  office.cellValueAsString.mockImplementation((value: unknown) => {
    if (value === null) return '∅'
    if (typeof value === 'string') return value
    return JSON.stringify(value) ?? ''
  })
  office.getCell.mockReturnValue(undefined)
  office.getMaxCol.mockReturnValue(0)
  office.getMaxRow.mockReturnValue(0)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('uploaded document format routing', () => {
  it('classifies modern document and browser image extensions with paths and case folding', () => {
    expect([
      'a.pdf', 'folder/a.PPTX', 'folder\\a.docx', 'a.xlsx', 'a.png', 'a.JPG', 'a.jpeg',
      'a.webp', 'a.bmp', 'a.ppt', 'a.doc', 'a.xls', 'a.tiff', 'README', '.hidden',
    ].map(documentPreviewKind)).toEqual([
      'pdf', 'pptx', 'docx', 'xlsx', 'image', 'image', 'image',
      'image', 'image', 'unsupported', 'unsupported', 'unsupported', 'unsupported', 'unsupported', 'unsupported',
    ])
  })
})

describe('PPTX preview', () => {
  it('renders sanitized slides and drives both pager directions', async () => {
    const presentation = { id: 'deck' }
    const slides = [{ id: 'one' }, { id: 'two' }]
    office.loadPresentation.mockResolvedValue(presentation)
    office.getSlides.mockReturnValue(slides)
    office.renderSlideToSvg.mockImplementation((_deck: unknown, slide: { id: string }) =>
      `<svg><script>unsafe()</script><text>${slide.id}</text></svg>`)

    const view = render(<PptxPreview bytes={Uint8Array.of(1)} t={t} />)
    expect(view.getByText('Loading')).toBeTruthy()
    await waitFor(() => { expect(view.getByText('Slide 1 of 2')).toBeTruthy() })
    expect(view.container.querySelector('script')).toBeNull()
    expect(view.getByText('one')).toBeTruthy()
    const previous = view.getByRole('button', { name: 'Previous' }) as HTMLButtonElement
    const next = view.getByRole('button', { name: 'Next' }) as HTMLButtonElement
    expect(previous.disabled).toBe(true)
    expect(next.disabled).toBe(false)

    fireEvent.click(next)
    expect(view.getByText('Slide 2 of 2')).toBeTruthy()
    expect(view.getByText('two')).toBeTruthy()
    expect(previous.disabled).toBe(false)
    expect(next.disabled).toBe(true)
    fireEvent.click(previous)
    expect(view.getByText('Slide 1 of 2')).toBeTruthy()
  })

  it('shows the empty state for a presentation without slides', async () => {
    const view = render(<PptxPreview bytes={Uint8Array.of(2)} t={t} />)
    await waitFor(() => { expect(view.getByText('Empty')).toBeTruthy() })
  })

  it.each([
    [new Error('deck failed'), 'deck failed'],
    ['plain deck failure', 'plain deck failure'],
  ])('shows a normalized load failure for %p', async (reason, message) => {
    office.loadPresentation.mockRejectedValue(reason)
    const view = render(<PptxPreview bytes={Uint8Array.of(3)} t={t} />)
    await waitFor(() => { expect(view.getByText(message)).toBeTruthy() })
  })

  it('ignores both resolution paths after the preview unmounts', async () => {
    const success = deferred<unknown>()
    office.loadPresentation.mockReturnValueOnce(success.promise)
    const first = render(<PptxPreview bytes={Uint8Array.of(4)} t={t} />)
    first.unmount()
    await act(async () => { success.resolve({}); await success.promise })

    const failure = deferred<unknown>()
    office.loadPresentation.mockReturnValueOnce(failure.promise)
    const second = render(<PptxPreview bytes={Uint8Array.of(5)} t={t} />)
    second.unmount()
    failure.reject('late failure')
    await failure.promise.catch(() => undefined)
  })
})

describe('DOCX preview', () => {
  it('renders into its owned container and clears it on release', async () => {
    let renderedBody: HTMLElement | undefined
    office.renderAsync.mockImplementation(async (_blob: Blob, body: HTMLElement) => {
      renderedBody = body
      body.textContent = 'Word body'
    })
    const view = render(<DocxPreview bytes={Uint8Array.of(6)} t={t} />)
    expect(view.getByText('Loading')).toBeTruthy()
    await waitFor(() => { expect(view.getByText('Word body')).toBeTruthy() })
    expect(view.queryByText('Loading')).toBeNull()
    expect(office.renderAsync).toHaveBeenCalledWith(
      expect.any(Blob), renderedBody, renderedBody,
      { breakPages: true, inWrapper: true, ignoreLastRenderedPageBreak: false },
    )
    view.unmount()
    expect(renderedBody?.childNodes).toHaveLength(0)
  })

  it.each([
    [new Error('word failed'), 'word failed'],
    ['plain word failure', 'plain word failure'],
  ])('shows a normalized render failure for %p', async (reason, message) => {
    office.renderAsync.mockRejectedValue(reason)
    const view = render(<DocxPreview bytes={Uint8Array.of(7)} t={t} />)
    await waitFor(() => { expect(view.getByText(message)).toBeTruthy() })
    expect(view.queryByText('Loading')).toBeNull()
  })

  it('ignores successful and failed renderer settlement after unmount', async () => {
    const success = deferred<undefined>()
    office.renderAsync.mockReturnValueOnce(success.promise)
    const first = render(<DocxPreview bytes={Uint8Array.of(8)} t={t} />)
    first.unmount()
    await act(async () => { success.resolve(undefined); await success.promise })

    const failure = deferred<undefined>()
    office.renderAsync.mockReturnValueOnce(failure.promise)
    const second = render(<DocxPreview bytes={Uint8Array.of(9)} t={t} />)
    second.unmount()
    failure.reject('late failure')
    await failure.promise.catch(() => undefined)
  })
})

describe('XLSX preview', () => {
  it('renders cell values, multi-letter columns, and switches worksheets', async () => {
    const first = worksheet('First', 'sheet-1')
    const second = worksheet('Second', 'sheet-2')
    office.loadWorkbook.mockResolvedValue({ sheets: [first, second] })
    office.getMaxRow.mockImplementation((sheet: { title: string }) => sheet.title === 'First' ? 2 : 1)
    office.getMaxCol.mockImplementation((sheet: { title: string }) => sheet.title === 'First' ? 28 : 2)
    office.getCell.mockImplementation((_sheet: unknown, rowIndex: number, columnIndex: number) =>
      rowIndex === 1 && columnIndex === 1 ? { value: 'A1' } : undefined)

    const bytes = Uint8Array.of(10)
    const view = render(<XlsxPreview bytes={bytes} t={t} />)
    expect(view.getByText('Loading')).toBeTruthy()
    await waitFor(() => { expect(view.getByRole('tab', { name: 'First' })).toBeTruthy() })
    expect(office.fromArrayBuffer).toHaveBeenCalledWith(bytes)
    expect(view.getByText('AB')).toBeTruthy()
    expect(view.getByText('A1')).toBeTruthy()
    expect(view.getAllByText('∅').length).toBeGreaterThan(0)
    expect(view.queryByText(/Limited/u)).toBeNull()

    fireEvent.click(view.getByRole('tab', { name: 'Second' }))
    expect(view.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('tab', { name: 'First' }).getAttribute('aria-selected')).toBe('false')
  })

  it.each([
    [201, 1, 'Limited 200x1'],
    [1, 51, 'Limited 1x50'],
  ])('bounds a %i by %i sheet', async (rows, columns, label) => {
    office.loadWorkbook.mockResolvedValue({ sheets: [worksheet('Large')] })
    office.getMaxRow.mockReturnValue(rows)
    office.getMaxCol.mockReturnValue(columns)
    const view = render(<XlsxPreview bytes={Uint8Array.of(11)} t={t} />)
    await waitFor(() => { expect(view.getByText(label)).toBeTruthy() })
  })

  it.each([[0, 1], [1, 0]])('shows an empty state for a %i by %i worksheet', async (rows, columns) => {
    office.loadWorkbook.mockResolvedValue({ sheets: [worksheet('Empty sheet')] })
    office.getMaxRow.mockReturnValue(rows)
    office.getMaxCol.mockReturnValue(columns)
    const view = render(<XlsxPreview bytes={Uint8Array.of(12)} t={t} />)
    await waitFor(() => { expect(view.getByText('Empty')).toBeTruthy() })
  })

  it('shows an empty state for a missing or non-worksheet sheet', async () => {
    office.loadWorkbook.mockResolvedValueOnce({ sheets: [] })
    const missing = render(<XlsxPreview bytes={Uint8Array.of(13)} t={t} />)
    await waitFor(() => { expect(missing.getByText('Empty')).toBeTruthy() })
    missing.unmount()

    office.loadWorkbook.mockResolvedValueOnce({
      sheets: [{ sheetId: 'chart', kind: 'chartsheet', sheet: { title: 'Chart' } }],
    })
    const chart = render(<XlsxPreview bytes={Uint8Array.of(14)} t={t} />)
    await waitFor(() => { expect(chart.getByText('Empty')).toBeTruthy() })
  })

  it.each([
    [new Error('sheet failed'), 'sheet failed'],
    ['plain sheet failure', 'plain sheet failure'],
  ])('shows a normalized workbook failure for %p', async (reason, message) => {
    office.loadWorkbook.mockRejectedValue(reason)
    const view = render(<XlsxPreview bytes={Uint8Array.of(15)} t={t} />)
    await waitFor(() => { expect(view.getByText(message)).toBeTruthy() })
  })

  it('ignores both loader settlement paths after unmount', async () => {
    const success = deferred<unknown>()
    office.loadWorkbook.mockReturnValueOnce(success.promise)
    const first = render(<XlsxPreview bytes={Uint8Array.of(16)} t={t} />)
    first.unmount()
    await act(async () => { success.resolve({ sheets: [] }); await success.promise })

    const failure = deferred<unknown>()
    office.loadWorkbook.mockReturnValueOnce(failure.promise)
    const second = render(<XlsxPreview bytes={Uint8Array.of(17)} t={t} />)
    second.unmount()
    failure.reject('late failure')
    await failure.promise.catch(() => undefined)
  })
})

describe('document preview shell', () => {
  it('renders PDF, image, and unsupported surfaces from one owned Blob URL each', async () => {
    const urls = stubBlobUrls()
    const pdfFile = fileWithArrayBuffer('lesson.pdf', async () => Uint8Array.of(1).buffer)
    const pdf = render(<DocumentPreview document={row(pdfFile.name)} file={pdfFile} t={t} />)
    await waitFor(() => { expect(pdf.getByTitle('lesson.pdf preview').getAttribute('src')).toBe('blob:lesson.pdf') })
    expect(pdf.getByRole('link', { name: 'Download' }).getAttribute('download')).toBe('lesson.pdf')
    pdf.unmount()
    expect(urls.revoke).toHaveBeenCalledWith('blob:lesson.pdf')

    const imageFile = fileWithArrayBuffer('photo.png', async () => Uint8Array.of(2).buffer)
    const image = render(<DocumentPreview document={row(imageFile.name)} file={imageFile} t={t} />)
    await waitFor(() => { expect(image.getByAltText('photo.png').getAttribute('src')).toBe('blob:photo.png') })
    image.unmount()

    const unsupportedFile = fileWithArrayBuffer('legacy.doc', async () => Uint8Array.of(3).buffer)
    const unsupported = render(
      <DocumentPreview document={row(unsupportedFile.name)} file={unsupportedFile} t={t} />,
    )
    expect(unsupported.getByText('Unsupported')).toBeTruthy()
    await waitFor(() => { expect(unsupported.getByRole('link', { name: 'Download' })).toBeTruthy() })
    expect(urls.create).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['deck.pptx', () => office.loadPresentation],
    ['notes.docx', () => office.renderAsync],
    ['scores.xlsx', () => office.loadWorkbook],
  ])('loads bytes before mounting the %s renderer', async (name, renderer) => {
    stubBlobUrls()
    const arrayBuffer = vi.fn(async () => Uint8Array.of(20).buffer)
    const file = fileWithArrayBuffer(name, arrayBuffer)
    render(<DocumentPreview document={row(name)} file={file} t={t} />)
    await waitFor(() => { expect(renderer()).toHaveBeenCalled() })
    expect(arrayBuffer).toHaveBeenCalledOnce()
  })

  it('retries a failed byte read and then mounts the document renderer', async () => {
    stubBlobUrls()
    const arrayBuffer = vi.fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(Uint8Array.of(21).buffer)
    const file = fileWithArrayBuffer('retry.pptx', arrayBuffer)
    const view = render(<DocumentPreview document={row(file.name)} file={file} t={t} />)
    await waitFor(() => { expect(view.getByText('read failed')).toBeTruthy() })
    fireEvent.click(view.getByRole('button', { name: 'Retry' }))
    await waitFor(() => { expect(office.loadPresentation).toHaveBeenCalled() })
    expect(arrayBuffer).toHaveBeenCalledTimes(2)
  })

  it('normalizes a non-Error byte-read rejection', async () => {
    stubBlobUrls()
    const file = fileWithArrayBuffer('plain.xlsx', async () => { throw 'plain read failure' })
    const view = render(<DocumentPreview document={row(file.name)} file={file} t={t} />)
    await waitFor(() => { expect(view.getByText('plain read failure')).toBeTruthy() })
  })

  it('ignores successful and failed byte reads after release', async () => {
    stubBlobUrls()
    const success = deferred<ArrayBuffer>()
    const firstFile = fileWithArrayBuffer('late.docx', () => success.promise)
    const first = render(<DocumentPreview document={row(firstFile.name)} file={firstFile} t={t} />)
    first.unmount()
    await act(async () => { success.resolve(Uint8Array.of(22).buffer); await success.promise })

    const failure = deferred<ArrayBuffer>()
    const secondFile = fileWithArrayBuffer('late.xlsx', () => failure.promise)
    const second = render(<DocumentPreview document={row(secondFile.name)} file={secondFile} t={t} />)
    second.unmount()
    failure.reject('late read failure')
    await failure.promise.catch(() => undefined)
  })
})
