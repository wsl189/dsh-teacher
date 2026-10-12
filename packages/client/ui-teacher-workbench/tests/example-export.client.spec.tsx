// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TeacherExample, TeacherExampleDocument, TeacherExampleExplanationId, TeacherExampleId } from '@deepseek-ai/dsh-api-remotes/client'
import { ExampleExportDialog } from '../src/client/ExampleExportDialog.tsx'
import type { ExampleCollectionCommands } from '../src/client/example-collection-controller.ts'
import type { TeacherWorkbenchTranslate } from '../src/client/shared.tsx'
import { zh } from '../src/client/locales.ts'

const clickDownload = vi.fn<() => void>()
const t: TeacherWorkbenchTranslate = key => zh[key]
const source = { id: 'source' as NonNullable<TeacherExampleDocument['source']>['id'], name: 'q.pdf', mediaType: 'application/pdf' as const }
const question: TeacherExample = {
  explanations: [],
  id: 'one' as TeacherExampleId, number: 1, name: '1', tags: [], description: '', handwriting: [], revision: 1,
  documents: {
    question: { source, status: 'ready', ocrError: null, wordRevision: 1 },
    explanation: { source: null, status: 'empty', ocrError: null, wordRevision: 0 },
  },
}

// JSDOM exposes dialog elements without native modal methods or blob URLs; Web tests use browser implementations.
const descriptors = [
  [HTMLDialogElement.prototype, 'showModal'],
  [HTMLDialogElement.prototype, 'close'],
  [URL, 'createObjectURL'],
  [URL, 'revokeObjectURL'],
] as const
const originals = descriptors.map(([object, key]) => Object.getOwnPropertyDescriptor(object, key))
beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } },
  })
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, writable: true, value: vi.fn(() => 'blob:export') },
    revokeObjectURL: { configurable: true, writable: true, value: vi.fn() },
  })
})
afterAll(() => {
  for (const [index, [object, key]] of descriptors.entries()) {
    const original = originals[index]
    if (original === undefined) Reflect.deleteProperty(object, key)
    else Object.defineProperty(object, key, original)
  }
})
beforeEach(() => {
  clickDownload.mockClear()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickDownload)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('selected question Word exports', () => {
  it('waits for every uploaded alternative solution while allowing empty solution slots', () => {
    const alternative = { id: 'solution-two' as TeacherExampleExplanationId,
      document: { source, status: 'pending' as const, ocrError: null, wordRevision: 0 },
    }
    const ready = { ...alternative, document: { ...alternative.document, status: 'ready' as const } }
    const onExport = vi.fn<ExampleCollectionCommands['exportWord']>()
    const view = render(<ExampleExportDialog
      questions={[{ ...question, explanations: [alternative] }]} onExport={onExport} onClose={() => {}} t={t}
    />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '导出并下载' }).disabled).toBe(true)
    view.rerender(<ExampleExportDialog questions={[{ ...question, explanations: [ready, { ...alternative, id: 'empty' as TeacherExampleExplanationId, document: question.documents.explanation }] }]} onExport={onExport} onClose={() => {}} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '导出并下载' }).disabled).toBe(false)
    expect(onExport).not.toHaveBeenCalled()
  })
  it('keeps the chosen layout after failure and downloads after retry, including questions without explanations', async () => {
    const onExport = vi.fn<ExampleCollectionCommands['exportWord']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ name: '题目与解析.docx', mediaType: 'application/zip', contentBase64: btoa('docx') })
    const onClose = vi.fn()
    render(<ExampleExportDialog questions={[question]} onExport={onExport} onClose={onClose} t={t} />)
    fireEvent.click(screen.getByRole('radio', { name: /所有题目在前/ }))
    fireEvent.click(screen.getByRole('button', { name: '导出并下载' }))
    await screen.findByRole('alert')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /所有题目在前/ }).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '导出并下载' }))
    await waitFor(() => { expect(onClose).toHaveBeenCalledOnce() })
    expect(onExport).toHaveBeenLastCalledWith({
      ids: ['one'], layout: 'grouped',
    })
    expect(clickDownload).toHaveBeenCalledOnce()
  })

  it('blocks partial exports while an uploaded explanation is pending and enables export when it becomes ready', () => {
    const onExport = vi.fn<ExampleCollectionCommands['exportWord']>()
    const pending: TeacherExample = { ...question, documents: {
      ...question.documents, explanation: { source, status: 'pending', ocrError: null, wordRevision: 0 },
    } }
    const view = render(<ExampleExportDialog questions={[pending]} onExport={onExport} onClose={() => {}} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '导出并下载' }).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('请完成识别后再导出')
    view.rerender(<ExampleExportDialog
      questions={[{ ...pending, documents: { ...pending.documents, explanation: { ...pending.documents.explanation, status: 'ready' } } }]}
      onExport={onExport} onClose={() => {}} t={t}
    />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '导出并下载' }).disabled).toBe(false)
    expect(onExport).not.toHaveBeenCalled()
  })
})
