import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeacherExample, TeacherExampleDocument, TeacherExampleDocumentKind, TeacherExampleId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ExampleCollectionController,
  type ExampleCollectionRemote,
} from '../src/client/example-collection-controller.ts'

function question(id = 'one'): TeacherExample {
  return {
    id: id as TeacherExampleId,
    number: 1,
    name: '1',
    tags: [],
    description: '',
    handwriting: [],
    documents: { question: { source: null, status: 'empty', ocrError: null, wordRevision: 0 }, explanation: { source: null, status: 'empty', ocrError: null, wordRevision: 0 } },
    revision: 0,
  }
}

function withDocument(row: TeacherExample, document: TeacherExampleDocumentKind, status: TeacherExampleDocument['status'], revision: number): TeacherExample {
  return { ...row, revision, documents: { ...row.documents, [document]: { ...row.documents[document], status } } }
}

const success = <T>(value: T) => ({ ok: true as const, value: { ok: true as const, value } })

function harness() {
  const row = question()
  const remote = {
    listExamples: vi.fn().mockResolvedValue(success({ questions: [row], tags: [] })),
    createExample: vi.fn().mockResolvedValue(success(question('two'))),
    updateExample: vi.fn<ExampleCollectionRemote['updateExample']>(async request =>
      success({ ...row, ...request, revision: 1 }),
    ),
    addExampleTag: vi.fn<ExampleCollectionRemote['addExampleTag']>(async request => success(request.name)),
    deleteExampleTag: vi.fn<ExampleCollectionRemote['deleteExampleTag']>(async request => success(request.name.trim())),
    deleteExample: vi.fn<ExampleCollectionRemote['deleteExample']>(async request => success(request.id)),
    uploadExample: vi.fn<ExampleCollectionRemote['uploadExample']>(async request =>
      success(withDocument(row, request.document, 'pending', 1)),
    ),
    recognizeExample: vi.fn<ExampleCollectionRemote['recognizeExample']>(async request =>
      success(withDocument(row, request.document, 'ready', 2)),
    ),
    exportExamplesWord: vi.fn<ExampleCollectionRemote['exportExamplesWord']>(),
    readExampleWordEditor: vi.fn<ExampleCollectionRemote['readExampleWordEditor']>(),
    saveExampleWordEditor: vi.fn<ExampleCollectionRemote['saveExampleWordEditor']>(),
    readExampleFile: vi.fn<ExampleCollectionRemote['readExampleFile']>(),
  } satisfies ExampleCollectionRemote
  return { row, remote, controller: new ExampleCollectionController(remote) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('example collection drafts and background recognition', () => {
  it('retains a failed preset deletion for retry and preserves question tags and drafts after success', async () => {
    const { row, remote, controller } = harness()
    remote.listExamples.mockResolvedValue(success({ questions: [{ ...row, tags: ['几何'] }], tags: ['几何', '向量'] }))
    await controller.commands.refresh()
    controller.commands.editDraft(row.id, { description: '保留输入' })
    const before = controller.getSnapshot()
    remote.deleteExampleTag.mockRejectedValueOnce(new Error('offline'))
    await controller.commands.deleteTag('几何')
    expect(controller.getSnapshot()).toMatchObject({ error: 'transport', tags: before.tags })
    await controller.commands.deleteTag('  几何  ')
    expect(remote.deleteExampleTag).toHaveBeenLastCalledWith({ name: '  几何  ' })
    expect(controller.getSnapshot()).toMatchObject({ error: null, tags: ['向量'], pending: 0 })
    expect(controller.getSnapshot().questions).toBe(before.questions)
    expect(controller.getSnapshot().drafts).toBe(before.drafts)
    expect(remote.updateExample).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('submits every fragment in the chosen order and recognizes the combined source once', async () => {
    const { row, remote, controller } = harness()
    await controller.commands.refresh()
    await controller.commands.upload(row.id, 'explanation', [
      new File(['first'], 'top.PNG'),
      new File(['middle'], 'middle.pdf', { type: 'application/pdf' }),
      new File(['last'], 'bottom.jpg', { type: 'image/jpeg' }),
    ])
    expect(remote.uploadExample).toHaveBeenCalledExactlyOnceWith({
      id: row.id, document: 'explanation', files: [
        { name: 'top.PNG', mediaType: 'image/png', contentBase64: btoa('first') },
        { name: 'middle.pdf', mediaType: 'application/pdf', contentBase64: btoa('middle') },
        { name: 'bottom.jpg', mediaType: 'image/jpeg', contentBase64: btoa('last') },
      ],
    })
    expect(remote.recognizeExample).toHaveBeenCalledExactlyOnceWith({ id: row.id, document: 'explanation' })
    await controller.dispose()
  })

  it('keeps the saved source when any fragment is unsupported and does not start OCR', async () => {
    const { row, remote, controller } = harness()
    await controller.commands.refresh()
    await controller.commands.upload(row.id, 'question', [new File(['image'], 'top.png'), new File(['bad'], 'bottom.txt')])
    expect(controller.getSnapshot().error).toBe('invalid-request')
    expect(remote.uploadExample).not.toHaveBeenCalled()
    expect(remote.recognizeExample).not.toHaveBeenCalled()
    expect(controller.getSnapshot().busy.question).toEqual({})
    await controller.dispose()
  })

  it('automatically saves the latest description after typing settles', async () => {
    vi.useFakeTimers()
    const { row, remote, controller } = harness()
    await controller.commands.refresh()
    controller.commands.editDraft(row.id, { description: '向量' })
    await vi.advanceTimersByTimeAsync(400)
    controller.commands.editDraft(row.id, { description: '向量数量积' })
    await vi.advanceTimersByTimeAsync(400)
    expect(remote.updateExample).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(controller.getSnapshot()).toMatchObject({ drafts: {}, questions: [{ description: '向量数量积' }] })
    expect(remote.updateExample).toHaveBeenCalledOnce()
    await controller.dispose()
  })

  it('keeps a failed description draft until a successful retry', async () => {
    vi.useFakeTimers()
    const { row, remote, controller } = harness()
    await controller.commands.refresh()
    remote.updateExample.mockRejectedValueOnce(new Error('offline'))
    controller.commands.editDraft(row.id, { description: '保留输入' })
    await controller.commands.saveDraft(row.id)
    expect(controller.getSnapshot()).toMatchObject({ error: 'transport', drafts: { one: { description: '保留输入' } } })
    await controller.commands.saveDraft(row.id)
    expect(controller.getSnapshot()).toMatchObject({ drafts: {}, questions: [{ description: '保留输入' }] })
    await controller.dispose()
  })

  it('does not clear newer text when an earlier save completes', async () => {
    const { row, remote, controller } = harness()
    await controller.commands.refresh()
    let finish!: (result: Awaited<ReturnType<ExampleCollectionRemote['updateExample']>>) => void
    remote.updateExample.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    controller.commands.editDraft(row.id, { description: '第一段' })
    const saving = controller.commands.saveDraft(row.id)
    await vi.waitFor(() => {
      expect(remote.updateExample).toHaveBeenCalledOnce()
    })
    controller.commands.editDraft(row.id, { description: '第一段和第二段' })
    finish(success({ ...row, description: '第一段', revision: 1 }))
    await saving
    expect(controller.getSnapshot().drafts.one?.description).toBe('第一段和第二段')
    await controller.commands.saveDraft(row.id)
    expect(controller.getSnapshot().questions[0]?.description).toBe('第一段和第二段')
    await controller.dispose()
  })

  it('uploads before starting OCR and allows directory changes while OCR is pending', async () => {
    const { row, remote, controller } = harness()
    await controller.commands.refresh()
    let finish!: (result: Awaited<ReturnType<ExampleCollectionRemote['recognizeExample']>>) => void
    remote.recognizeExample.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const upload = controller.commands.upload(
      row.id,
      'question',
      [new File(['%PDF-1.4'], 'question.pdf', { type: 'application/pdf' })],
    )
    await vi.waitFor(() => {
      expect(remote.recognizeExample).toHaveBeenCalledOnce()
    })
    expect(remote.uploadExample).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().busy.question.one).toBe('ocr')
    await controller.commands.create()
    expect(controller.getSnapshot().selectedId).toBe('two')
    await controller.commands.delete(row.id)
    finish(success(withDocument(row, 'question', 'ready', 3)))
    await upload
    expect(controller.getSnapshot().questions.map(item => item.id)).toEqual(['two'])
    expect(controller.getSnapshot().busy).toEqual({ question: {}, explanation: {} })
    await controller.dispose()
  })

  it('keeps both uploads running when switching directories and ignores older OCR responses', async () => {
    const { row, remote, controller } = harness()
    await controller.commands.refresh()
    const finishes = new Map<TeacherExampleDocumentKind, (result: Awaited<ReturnType<ExampleCollectionRemote['recognizeExample']>>) => void>()
    remote.recognizeExample.mockImplementation(request => new Promise((resolve) => { finishes.set(request.document, resolve) }))
    const questionUpload = controller.commands.upload(row.id, 'question', [new File(['%PDF-1.4'], 'question.pdf', { type: 'application/pdf' })])
    const explanationUpload = controller.commands.upload(row.id, 'explanation', [new File(['%PDF-1.4'], 'explanation.pdf', { type: 'application/pdf' })])
    await vi.waitFor(() => { expect(remote.recognizeExample).toHaveBeenCalledTimes(2) })
    expect(remote.uploadExample.mock.calls.map(([request]) => request.document)).toEqual(['question', 'explanation'])
    expect(controller.getSnapshot().busy).toEqual({ question: { one: 'ocr' }, explanation: { one: 'ocr' } })
    await controller.commands.create()
    const earlier = withDocument(row, 'explanation', 'ready', 3)
    const latest = withDocument(earlier, 'question', 'ready', 4)
    finishes.get('question')?.(success(latest))
    await questionUpload
    expect(controller.getSnapshot().busy).toEqual({ question: {}, explanation: { one: 'ocr' } })
    finishes.get('explanation')?.(success(earlier))
    await explanationUpload
    expect(controller.getSnapshot().selectedId).toBe('two')
    controller.commands.select(row.id)
    expect(controller.getSnapshot().questions[0]).toEqual(latest)
    expect(controller.getSnapshot().busy).toEqual({ question: {}, explanation: {} })
    await controller.dispose()
  })

  it('flushes description drafts when changing directory and disposing the plugin', async () => {
    vi.useFakeTimers()
    const { row, controller } = harness()
    await controller.commands.refresh()
    controller.commands.editDraft(row.id, { description: '切换前的内容' })
    controller.commands.select('two' as TeacherExampleId)
    await controller.dispose()
    expect(controller.getSnapshot().questions[0]?.description).toBe('切换前的内容')
    expect(controller.getSnapshot().drafts).toEqual({})
  })
})
