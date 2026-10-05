// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate/browser'
import { renderAsync } from 'docx-preview'
import type { TeacherPaperFile, TeacherPaperId, TeacherPaperSource, TeacherPaperSourceId } from '@deepseek-ai/dsh-api-remotes/client'
import { PaperFilePreview } from '../src/client/PaperFilePreview.tsx'
import { PaperCollectionFailure, type PaperCollectionCommands } from '../src/client/paper-collection-controller.ts'
import { openQuestionPdfRasterizer, type QuestionPdfRasterizer } from '../src/client/question-segmentation.ts'
import { zh } from '../src/client/locales.ts'
import type { TeacherWorkbenchTranslate } from '../src/client/shared.tsx'

vi.mock('docx-preview', () => ({ renderAsync: vi.fn(async (_file: Blob, body: HTMLElement) => { body.textContent = '论文正文' }) }))
vi.mock('../src/client/example-word-preview.ts', () => ({ renderExampleWordEquations: vi.fn() }))
vi.mock('../src/client/question-segmentation.ts', () => ({ openQuestionPdfRasterizer: vi.fn() }))

const descriptors = new Map(['createObjectURL', 'revokeObjectURL'].map(key => [key, Object.getOwnPropertyDescriptor(URL, key)]))
const t: TeacherWorkbenchTranslate = (key, params) => Object.entries(params ?? {})
  .reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), zh[key])
const paperId = 'paper' as TeacherPaperId
const source: TeacherPaperSource = {
  id: 'original' as TeacherPaperSourceId, name: '研究论文.docx', format: 'docx',
  mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 100,
}
const pdf: TeacherPaperFile = { name: '研究论文.pdf', mediaType: 'application/pdf', contentBase64: 'JVBERi0xLjc=' }
function original(extension: string): TeacherPaperFile {
  const bytes = zipSync({ [`word/media/image1.${extension}`]: new Uint8Array([1]) })
  return { name: source.name, mediaType: source.mediaType, contentBase64: btoa(String.fromCharCode(...bytes)) }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, writable: true, value: vi.fn(() => 'blob:original') },
    revokeObjectURL: { configurable: true, writable: true, value: vi.fn() },
  })
  vi.mocked(openQuestionPdfRasterizer).mockResolvedValue({
    pageCount: 1,
    renderPagePreviews: vi.fn<QuestionPdfRasterizer['renderPagePreviews']>(async () => [{ pageIndex: 0, width: 595, height: 842, mediaType: 'image/png', contentBase64: 'AQ==' }]),
    renderPageForOcr: vi.fn(), renderCrops: vi.fn(), dispose: vi.fn(async () => {}),
  } satisfies QuestionPdfRasterizer)
})

afterEach(() => {
  cleanup()
  for (const [key, descriptor] of descriptors) {
    if (descriptor !== undefined) Object.defineProperty(URL, key, descriptor)
    else Reflect.deleteProperty(URL, key)
  }
})

it.each(['tiff', 'EMF', 'wmf', 'eps'])('automatically previews Word with %s figures as PDF while keeping the original download', async (extension) => {
  const pending = Promise.withResolvers<TeacherPaperFile>()
  const readFile = vi.fn<PaperCollectionCommands['readFile']>(async request => request.kind === 'source' ? original(extension) : pending.promise)
  render(<PaperFilePreview paperId={paperId} source={source} readFile={readFile} t={t} />)
  expect((await screen.findByRole('link', { name: '下载原件' })).getAttribute('download')).toBe(source.name)
  expect(screen.getByRole('status').textContent).toBe(zh['papers.generatingPreview'])
  expect(renderAsync).not.toHaveBeenCalled()
  await act(async () => { pending.resolve(pdf) })
  await screen.findByRole('img', { name: '研究论文.pdf，第 1 页' })
  expect(screen.queryByLabelText('论文 Word 文档内容')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(readFile.mock.calls.map(([request]) => request.kind)).toEqual(['source', 'preview'])
})

it('previews ordinary DOCX from the original without requesting a derived file', async () => {
  const readFile = vi.fn<PaperCollectionCommands['readFile']>().mockResolvedValue(original('png'))
  render(<PaperFilePreview paperId={paperId} source={source} readFile={readFile} t={t} />)
  await screen.findByText('论文正文')
  expect(screen.getByRole('link', { name: '下载原件' }).getAttribute('download')).toBe(source.name)
  expect(readFile).toHaveBeenCalledOnce()
  expect(readFile).toHaveBeenCalledWith({ id: paperId, sourceId: source.id, kind: 'source' })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('retains the original download if automatic Word preview generation fails', async () => {
  const readFile = vi.fn<PaperCollectionCommands['readFile']>(async (request) => {
    if (request.kind === 'source') return original('tif')
    throw new PaperCollectionFailure('preview-failed')
  })
  render(<PaperFilePreview paperId={paperId} source={source} readFile={readFile} t={t} />)
  await screen.findByRole('alert')
  expect(screen.getByRole('link', { name: '下载原件' }).getAttribute('download')).toBe(source.name)
  expect(screen.getByRole('button', { name: '重新载入' })).toBeDefined()
  expect(renderAsync).not.toHaveBeenCalled()
})
