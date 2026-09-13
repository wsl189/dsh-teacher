// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TeacherQuestionPagePreview } from '@deepseek-ai/dsh-api-remotes/client'
import { ExamplePdfPreview } from '../src/client/ExamplePdfPreview.tsx'
import { openQuestionPdfRasterizer, type QuestionPdfRasterizer } from '../src/client/question-segmentation.ts'
import { zh } from '../src/client/locales.ts'
import type { TeacherWorkbenchTranslate } from '../src/client/shared.tsx'

vi.mock('../src/client/question-segmentation.ts', () => ({ openQuestionPdfRasterizer: vi.fn() }))

const t: TeacherWorkbenchTranslate = (key, params) => Object.entries(params ?? {})
  .reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), zh[key])
const file = new File(['pdf'], '长题.pdf', { type: 'application/pdf' })
const page = (pageIndex: number): TeacherQuestionPagePreview => ({
  pageIndex, width: 800, height: 400, mediaType: 'image/png', contentBase64: 'AQ==',
})
function reader(pageCount = 2) {
  return {
    pageCount,
    renderPagePreviews: vi.fn<QuestionPdfRasterizer['renderPagePreviews']>(async indexes => indexes.map(page)),
    renderPageForOcr: vi.fn(),
    renderCrops: vi.fn(),
    dispose: vi.fn(async () => {}),
  } satisfies QuestionPdfRasterizer
}

afterEach(() => { cleanup(); vi.resetAllMocks() })

it('displays every PDF page in reading order while the remaining pages load', async () => {
  const source = reader()
  const pending = Promise.withResolvers<TeacherQuestionPagePreview[]>()
  vi.mocked(source.renderPagePreviews).mockResolvedValueOnce([page(0)]).mockReturnValueOnce(pending.promise)
  vi.mocked(openQuestionPdfRasterizer).mockResolvedValue(source)
  render(<ExamplePdfPreview file={file} t={t} />)
  await screen.findByRole('img', { name: '长题.pdf，第 1 页' })
  expect(screen.getByRole('status').textContent).toContain('正在加载预览')
  await act(async () => { pending.resolve([page(1)]) })
  expect(screen.getAllByRole('img').map(image => image.getAttribute('alt'))).toEqual(['长题.pdf，第 1 页', '长题.pdf，第 2 页'])
  expect(screen.queryByRole('status')).toBeNull()
  expect(document.querySelector('iframe')).toBeNull()
  expect(source.dispose).toHaveBeenCalledOnce()
})

it('clears an incomplete preview and retries the same saved PDF after a failed page', async () => {
  const failed = reader()
  vi.mocked(failed.renderPagePreviews).mockResolvedValueOnce([page(0)]).mockRejectedValueOnce(new Error('PDF render failed'))
  const recovered = reader()
  vi.mocked(openQuestionPdfRasterizer).mockResolvedValueOnce(failed).mockResolvedValueOnce(recovered)
  render(<ExamplePdfPreview file={file} t={t} />)
  await screen.findByRole('alert')
  expect(screen.queryByRole('img')).toBeNull()
  expect(failed.dispose).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
  await screen.findByRole('img', { name: '长题.pdf，第 2 页' })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(openQuestionPdfRasterizer).toHaveBeenLastCalledWith(file)
  expect(recovered.dispose).toHaveBeenCalledOnce()
})

it('releases a PDF that finishes opening after the preview closes', async () => {
  const source = reader()
  const opened = Promise.withResolvers<QuestionPdfRasterizer>()
  vi.mocked(openQuestionPdfRasterizer).mockReturnValue(opened.promise)
  const view = render(<ExamplePdfPreview file={file} t={t} />)
  view.unmount()
  await act(async () => { opened.resolve(source) })
  expect(source.renderPagePreviews).not.toHaveBeenCalled()
  expect(source.dispose).toHaveBeenCalledOnce()
})

it('keeps replacement pages visible when an old page finishes or fails later', async () => {
  const previous = reader()
  const pending = Promise.withResolvers<TeacherQuestionPagePreview[]>()
  vi.mocked(previous.renderPagePreviews).mockReturnValue(pending.promise)
  const next = reader(1)
  vi.mocked(openQuestionPdfRasterizer).mockResolvedValueOnce(previous).mockResolvedValueOnce(next)
  const view = render(<ExamplePdfPreview file={file} t={t} />)
  await waitFor(() => { expect(previous.renderPagePreviews).toHaveBeenCalledOnce() })
  view.rerender(<ExamplePdfPreview file={new File(['pdf'], '新原件.pdf')} t={t} />)
  await screen.findByRole('img', { name: '新原件.pdf，第 1 页' })
  await act(async () => { pending.reject(new Error('Old PDF cancelled')) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getAllByRole('img')).toHaveLength(1)
  expect(previous.dispose).toHaveBeenCalledOnce()
  expect(next.dispose).toHaveBeenCalledOnce()
})
