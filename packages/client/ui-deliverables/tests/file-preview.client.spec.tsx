// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: {} }))
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FilePreview, type FilePreviewProps } from '../src/client/preview/FilePreview.tsx'
import { decodePreviewBytes, previewKind } from '../src/client/preview/renderers.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('file preview routing', () => {
  it('classifies the supported modern document and image extensions case-insensitively', () => {
    expect([
      'a.pdf', 'a.PPTX', 'a.docx', 'a.xlsx', 'a.xlsm', 'a.md', 'a.markdown',
      'a.avif', 'a.bmp', 'a.gif', 'a.jpeg', 'a.jpg', 'a.png', 'a.svg', 'a.webp',
    ].map(previewKind)).toEqual([
      'pdf', 'pptx', 'docx', 'xlsx', 'xlsx', 'markdown', 'markdown',
      'image', 'image', 'image', 'image', 'image', 'image', 'image', 'image',
    ])
    expect(['a.ppt', 'a.doc', 'a.xls', 'a.html', 'README'].map(previewKind))
      .toEqual(['unsupported', 'unsupported', 'unsupported', 'unsupported', 'unsupported'])
  })

  it('decodes the RPC Base64 payload byte-for-byte', () => {
    expect([...decodePreviewBytes('AAH+/w==')]).toEqual([0, 1, 254, 255])
  })
})

describe('FilePreview', () => {
  const t = makeTranslate(en)

  it('loads Markdown, renders it, and refreshes through a new bounded read', async () => {
    const loadPreview = vi.fn<
      (path: string, signal: AbortSignal) => Promise<{ dataBase64: string; size: number }>
    >(async () => ({ dataBase64: btoa('# Ready'), size: 7 }))
    const view = render(
      <FilePreview {...({
        path: 'notes.md',
        openFile: vi.fn(async () => {}),
        loadPreview,
        t,
      } as unknown as FilePreviewProps)} />,
    )
    expect(await view.findByRole('heading', { name: 'Ready' })).toBeTruthy()
    expect(loadPreview).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => { expect(loadPreview).toHaveBeenCalledTimes(2) })
    expect(loadPreview.mock.calls[0]?.[0]).toBe('notes.md')
    expect(loadPreview.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
  })

  it('does not read unsupported legacy Office files and retains the system-open fallback', async () => {
    const loadPreview = vi.fn()
    const openFile = vi.fn(async () => { throw new Error('no desktop opener') })
    const view = render(
      <FilePreview {...({
        path: 'legacy.doc', openFile, loadPreview, t,
      } as unknown as FilePreviewProps)} />,
    )
    expect(view.getByText('This file type cannot be previewed yet')).toBeTruthy()
    expect(loadPreview).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Open in system app' }))
    expect(await view.findByText('no desktop opener')).toBeTruthy()
    expect(openFile).toHaveBeenCalledWith('legacy.doc')
  })
})
