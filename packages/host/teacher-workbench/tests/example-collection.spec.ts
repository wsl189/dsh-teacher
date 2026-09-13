import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { DOMParser } from '@xmldom/xmldom'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { Document, Packer, Paragraph } from 'docx'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import type { OcrExtractResult } from '@deepseek-ai/dsh-ocr'
import { SqliteStorageBackend } from '../../../storage/storage-sqlite/src/index.ts'
import { TeacherExampleCollection, teacherExampleDomainSpec } from '../src/example-collection.ts'
import { createExampleWord } from '../src/example-word.ts'
import { exampleWordNeedsHeading } from '../src/example-word-heading.ts'
import type { TeacherExample, TeacherExampleDocument, TeacherExampleDocumentKind, TeacherExampleExportRequest, TeacherExampleResult } from '../src/example-types.ts'

const roots: string[] = []
const cleanups: (() => Promise<void>)[] = []
const documentKinds = ['question', 'explanation'] as const
const emptyDocument = () => ({ source: null, status: 'empty' as const, ocrError: null, wordRevision: 0, sourceBase64: null, word: null })
const pdf = Buffer.from('%PDF-1.4\nfixture').toString('base64')
const ocrResult = (markdown = '# 一元二次方程\n已知 x² − 3x + 2 = 0，求 x。'): Extract<OcrExtractResult, { ok: true }> => ({
  ok: true,
  value: { markdown, name: 'question.pdf', mediaType: 'application/pdf', provider: 'mineru', truncated: false },
})

function value<T>(result: TeacherExampleResult<T>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

async function harness(
  path?: string,
  extract = vi.fn<ConstructorParameters<typeof TeacherExampleCollection>[2]>().mockResolvedValue(ocrResult()),
  correct = vi.fn<ConstructorParameters<typeof TeacherExampleCollection>[3]>()
    .mockImplementation(async request => ({ ok: true, value: request.markdown })),
  identifyHeading = vi.fn<ConstructorParameters<typeof TeacherExampleCollection>[4]>()
    .mockResolvedValue({ ok: true, value: [] }),
) {
  if (path === undefined) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-example-'))
    roots.push(root)
    path = join(root, 'examples.sqlite')
  }
  const ctx = new Context()
  const storageFiber = await ctx.plugin(Storage)
  const backend = new SqliteStorageBackend({ path, journalMode: 'wal' })
  const unregister = ctx.storage.backend.register('sqlite', backend)
  const facility = new DomainFacility(ctx, { backend: 'sqlite' })
  const collection = new TeacherExampleCollection(facility, () => 1024 * 1024, extract, correct, identifyHeading)
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await collection.dispose()
    unregister()
    await backend.close()
    await storageFiber.dispose()
  }
  cleanups.push(close)
  return { collection, path, close, extract, correct, identifyHeading, facility }
}

async function seedIllustration(
  owner: Awaited<ReturnType<typeof harness>>,
  documents: readonly TeacherExampleDocumentKind[] = documentKinds,
) {
  const question = {
    id: 'illustrated-question' as TeacherExample['id'], number: 1, name: '1', tags: [], description: '',
    handwriting: [], revision: 0, documents: { question: emptyDocument(), explanation: emptyDocument() },
  } satisfies TeacherExample
  const domain = await owner.facility.open(teacherExampleDomainSpec)
  await domain.table('questions').put(question.id, question)
  for (const document of documents) {
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(`${document} 原文 ![](images/figure.png)`)] }] }))
    const record = domain.table('questions').get(question.id)!
    await domain.table('questions').put(question.id, { ...record, documents: {
      ...record.documents,
      [document]: { ...record.documents[document], status: 'ready', wordRevision: 1, sourceBase64: pdf,
        source: { id: `${document}-source` as NonNullable<TeacherExampleDocument['source']>['id'], name: `${document}.pdf`, mediaType: 'application/pdf' },
        word: {
          name: `${document}.docx`, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', contentBase64: bytes.toString('base64'),
        } },
    } })
  }
  await domain.close()
  const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'blue' } }).png().toBuffer()
  const recognized: OcrExtractResult = { ok: true, value: {
    ...ocrResult().value,
    markdown: '重新识别的文字不覆盖原文',
    images: [{ name: 'images/figure.png', mediaType: 'image/png', contentBase64: bytes.toString('base64') }],
  } }
  return { question, recognized }
}

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('example collection in SQLite', () => {

  it('saves manual Word edits through metadata changes and rejects stale editors and late proofreading', async () => {
    const owner = await harness()
    const question = value(await owner.collection.create())
    const request = { id: question.id, document: 'question' as const }
    await owner.collection.upload({ ...request, files: [{ name: 'original.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    await owner.collection.recognize(request)
    const loaded = value(await owner.collection.readEditor(request))
    const paragraphs = loaded.paragraphs.map(paragraph => ({ ...paragraph, lineSpacing: 2 }))
    await owner.collection.update({ id: question.id, description: '保留描述' })
    let finish!: (result: TeacherExampleResult<string>) => void
    owner.correct.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const recognition = owner.collection.recognize(request)
    await vi.waitFor(() => { expect(finish).toBeDefined() })
    const saved = value(await owner.collection.saveEditor({
      ...request, sourceId: loaded.sourceId, wordRevision: loaded.wordRevision, paragraphs,
    }))
    expect(saved.question.description).toBe('保留描述')
    expect(value(await owner.collection.readEditor(request)).paragraphs).toEqual(paragraphs)
    finish({ ok: true, value: '迟到的识别内容' })
    expect(await recognition).toMatchObject({ ok: false, error: { code: 'source-changed' } })
    expect(await owner.collection.saveEditor({ ...request, sourceId: loaded.sourceId, wordRevision: loaded.wordRevision, paragraphs }))
      .toMatchObject({ ok: false, error: { code: 'word-changed' } })
    await owner.close()
    const restarted = await harness(owner.path)
    expect(value(await restarted.collection.readEditor(request)).paragraphs).toEqual(paragraphs)
  })
  it.each(documentKinds)('joins ordered image and PDF fragments into one durable %s and one corrected Word', async (document) => {
    const owner = await harness()
    const question = value(await owner.collection.create())
    const request = { id: question.id, document }
    const middle = await PDFDocument.create()
    middle.addPage([300, 160]).drawText('continuation one')
    middle.addPage([300, 180]).drawText('continuation two')
    const png = await sharp({ create: { width: 240, height: 100, channels: 3, background: 'white' } }).png().toBuffer()
    const webp = await sharp({ create: { width: 240, height: 120, channels: 3, background: 'blue' } }).webp().toBuffer()
    value(await owner.collection.upload({ ...request, files: [
      { name: 'top.png', mediaType: 'image/png', contentBase64: png.toString('base64') },
      { name: 'middle.pdf', mediaType: 'application/pdf', contentBase64: Buffer.from(await middle.save()).toString('base64') },
      { name: 'bottom.webp', mediaType: 'image/webp', contentBase64: webp.toString('base64') },
    ] }))
    const source = value(await owner.collection.readFile({ ...request, kind: 'source' }))
    expect(source.name).toBe(document === 'question' ? '1-原件.pdf' : '1-解析原件.pdf')
    const merged = await PDFDocument.load(Buffer.from(source.contentBase64, 'base64'))
    expect(merged.getPages().map(page => page.getSize())).toEqual([
      { width: 240, height: 100 }, { width: 300, height: 160 }, { width: 300, height: 180 }, { width: 240, height: 120 },
    ])
    owner.extract.mockResolvedValue(ocrResult('已知点0，\n求 $\\frac{1}{2}$。\n（i）保留最后一小问。'))
    owner.correct.mockResolvedValue({ ok: true, value: '已知点 $O$，求 $\\frac{1}{2}$。\n（i）保留最后一小问。' })
    value(await owner.collection.recognize(request))
    expect(owner.extract).toHaveBeenCalledExactlyOnceWith({ ...source, includeImages: true }, expect.any(AbortSignal))
    expect(owner.correct).toHaveBeenCalledExactlyOnceWith({
      source: { ...source, includeImages: true }, document, markdown: '已知点0，\n求 $\\frac{1}{2}$。\n（i）保留最后一小问。',
    }, expect.any(AbortSignal))
    expect(owner.identifyHeading).toHaveBeenCalledOnce()
    const word = value(await owner.collection.readFile({ ...request, kind: 'word' }))
    const xml = strFromU8(unzipSync(Buffer.from(word.contentBase64, 'base64'))['word/document.xml']!)
    expect(xml).toContain('<m:f>')
    expect(new DOMParser().parseFromString(xml, 'application/xml').documentElement?.textContent).toContain('（i）保留最后一小问。')
    await owner.close()
    const reopened = await harness(owner.path)
    expect(value(await reopened.collection.readFile({ ...request, kind: 'source' }))).toEqual(source)
    expect(value(await reopened.collection.readFile({ ...request, kind: 'word' }))).toEqual(word)
    expect(reopened.extract).not.toHaveBeenCalled()
  })

  it('rejects an empty, oversized, or unreadable fragment set atomically', async () => {
    const owner = await harness()
    const question = value(await owner.collection.create())
    const request = { id: question.id, document: 'question' as const }
    const valid = { name: 'saved.pdf', mediaType: 'application/pdf' as const, contentBase64: pdf }
    value(await owner.collection.upload({ ...request, files: [valid] }))
    value(await owner.collection.recognize(request))
    const before = value(await owner.collection.list())
    const word = value(await owner.collection.readFile({ ...request, kind: 'word' }))
    expect(await owner.collection.upload({ ...request, files: [] })).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(await owner.collection.upload({ ...request, files: [valid, valid] })).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    const oversized = Buffer.alloc(700_000)
    oversized.write('%PDF-1.4')
    const fragment = { ...valid, contentBase64: oversized.toString('base64') }
    expect(await owner.collection.upload({ ...request, files: [fragment, fragment] })).toMatchObject({ ok: false, error: { code: 'file-too-large' } })
    expect(value(await owner.collection.list())).toEqual(before)
    expect(value(await owner.collection.readFile({ ...request, kind: 'word' }))).toEqual(word)
    expect(value(await owner.collection.readFile({ ...request, kind: 'source' }))).toEqual(valid)
  })

  it('identifies a saved heading once across concurrent reads and exports without OCR, then reuses the result after restart', async () => {
    const owner = await harness()
    const question = { id: 'saved-heading' as TeacherExample['id'] }
    const request = { id: question.id, document: 'question' as const }
    const original = await createExampleWord('【题4】（2019人教A版P33）已知 $x>0$，求解。\n（1）求坐标。')
    const domain = await owner.facility.open(teacherExampleDomainSpec)
    await domain.table('questions').put(question.id, {
      id: question.id, number: 1, name: '1', tags: [], description: '', handwriting: [], revision: 0,
      documents: { explanation: emptyDocument(), question: {
        ...emptyDocument(), status: 'ready', wordRevision: 1, sourceBase64: pdf,
        source: { id: 'heading-source' as NonNullable<TeacherExampleDocument['source']>['id'], name: 'original.pdf', mediaType: 'application/pdf' },
        word: { name: '1.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', contentBase64: original.toString('base64') },
      } },
    })
    await domain.close()
    owner.extract.mockClear()
    owner.correct.mockClear()
    owner.identifyHeading.mockClear()
    let finish!: (result: TeacherExampleResult<readonly { paragraph: number; prefix: string }[]>) => void
    owner.identifyHeading.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const reads = [owner.collection.readFile({ ...request, kind: 'word' }), owner.collection.readFile({ ...request, kind: 'word' })]
    const exporting = owner.collection.exportWord({ ids: [question.id], layout: 'paired' })
    await vi.waitFor(() => { expect(owner.identifyHeading).toHaveBeenCalledOnce() })
    await owner.collection.update({ id: question.id, name: '保留名称', description: '保留描述' })
    finish({ ok: true, value: [{ paragraph: 0, prefix: '【题4】（2019人教A版P33）' }] })
    for (const result of await Promise.all([...reads, exporting])) {
      const bytes = Buffer.from(value(result).contentBase64, 'base64')
      expect(exampleWordNeedsHeading(bytes)).toBe(false)
      const xml = new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']!), 'application/xml')
      expect(xml.documentElement?.textContent).toContain('已知 x>0，求解。')
      expect(xml.documentElement?.textContent).toContain('（1）求坐标。')
      expect(xml.documentElement?.textContent).not.toContain('2019')
    }
    expect(owner.extract).not.toHaveBeenCalled()
    expect(owner.correct).not.toHaveBeenCalled()
    expect(owner.identifyHeading).toHaveBeenCalledOnce()
    expect(value(await owner.collection.readFile({ ...request, kind: 'source' })).contentBase64).toBe(pdf)
    expect(value(await owner.collection.list()).questions[0]).toMatchObject({ name: '保留名称', description: '保留描述' })
    await owner.close()
    const restarted = await harness(owner.path)
    expect(await restarted.collection.readFile({ ...request, kind: 'word' })).toMatchObject({ ok: true })
    expect(restarted.identifyHeading).not.toHaveBeenCalled()
  })

  it('retains an existing Word file when heading identification fails or selects a non-prefix', async () => {
    const owner = await harness()
    const question = value(await owner.collection.create())
    const request = { id: question.id, document: 'question' as const }
    await owner.collection.upload({ ...request, files: [{ name: 'original.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    await owner.collection.recognize(request)
    const before = value(await owner.collection.readFile({ ...request, kind: 'word' }))
    owner.identifyHeading.mockResolvedValue({ ok: false, error: { code: 'correction-failed', message: 'Unavailable' } })
    expect(await owner.collection.recognize(request)).toMatchObject({ ok: false, error: { code: 'correction-failed' } })
    owner.identifyHeading.mockResolvedValue({ ok: true, value: [{ paragraph: 0, prefix: '删除不存在的文字' }] })
    expect(await owner.collection.recognize(request)).toMatchObject({ ok: false, error: { code: 'correction-invalid' } })
    expect(value(await owner.collection.readFile({ ...request, kind: 'word' }))).toEqual(before)
  })

  it.each(documentKinds)('generates %s Word from visual corrections and retains it when a later correction fails', async (document) => {
    const owner = await harness()
    const question = value(await owner.collection.create())
    const request = { id: question.id, document }
    await owner.collection.upload({ ...request, files: [{ name: 'original.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    owner.extract.mockResolvedValue(ocrResult('A.点0；C. $a\\cdot b:c$'))
    owner.correct.mockResolvedValue({ ok: true, value: 'A.点 O；C. $a:b:c$' })
    expect(await owner.collection.recognize(request)).toMatchObject({ ok: true })
    expect(owner.correct).toHaveBeenCalledWith({
      document, markdown: 'A.点0；C. $a\\cdot b:c$',
      source: { name: 'original.pdf', mediaType: 'application/pdf', contentBase64: pdf, includeImages: true },
    }, expect.any(AbortSignal))
    const saved = value(await owner.collection.readFile({ ...request, kind: 'word' }))
    const xml = strFromU8(unzipSync(Buffer.from(saved.contentBase64, 'base64'))['word/document.xml']!)
    const text = new DOMParser().parseFromString(xml, 'application/xml').documentElement?.textContent
    expect(text).toContain('点 O')
    expect(text).toContain('a:b:c')
    expect(text).not.toContain('点0')
    owner.correct.mockResolvedValue({ ok: false, error: { code: 'correction-failed', message: 'provider unavailable' } })
    expect(await owner.collection.recognize(request)).toMatchObject({ ok: false, error: { code: 'correction-failed' } })
    expect(value(await owner.collection.readFile({ ...request, kind: 'word' }))).toEqual(saved)
  })

  it.each(['replace', 'delete'] as const)('does not save a correction after its source is subject to %s', async (action) => {
    const owner = await harness()
    const question = value(await owner.collection.create())
    const request = { id: question.id, document: 'question' as const }
    await owner.collection.upload({ ...request, files: [{ name: 'original.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    const completion = Promise.withResolvers<TeacherExampleResult<string>>()
    owner.correct.mockReturnValue(completion.promise)
    const pending = owner.collection.recognize(request)
    await vi.waitFor(() => { expect(owner.correct).toHaveBeenCalledOnce() })
    if (action === 'delete') await owner.collection.delete({ id: question.id })
    else await owner.collection.upload({ ...request, files: [{ name: 'replacement.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    completion.resolve({ ok: true, value: 'late corrected text' })
    expect(await pending).toMatchObject({ ok: false, error: { code: action === 'delete' ? 'not-found' : 'source-changed' } })
  })

  it('finishes image recovery before an explicit proofreading request for the same document', async () => {
    const owner = await harness()
    const { question, recognized } = await seedIllustration(owner, ['question'])
    const pendingOcr = Promise.withResolvers<OcrExtractResult>()
    owner.extract.mockReturnValueOnce(pendingOcr.promise).mockResolvedValueOnce(ocrResult('A. 点0'))
    owner.correct.mockResolvedValue({ ok: true, value: 'A. 点 O' })
    const request = { id: question.id, document: 'question' as const }
    const reading = owner.collection.readFile({ ...request, kind: 'word' })
    await vi.waitFor(() => { expect(owner.extract).toHaveBeenCalledOnce() })
    const correcting = owner.collection.recognize(request)
    pendingOcr.resolve(recognized)
    await reading
    expect(await correcting).toMatchObject({ ok: true })
    expect(owner.extract).toHaveBeenCalledTimes(2)
    expect(owner.correct).toHaveBeenCalledOnce()
    const word = value(await owner.collection.readFile({ ...request, kind: 'word' }))
    const xml = strFromU8(unzipSync(Buffer.from(word.contentBase64, 'base64'))['word/document.xml']!)
    expect(new DOMParser().parseFromString(xml, 'application/xml').documentElement?.textContent).toContain('点 O')
  })

  it.each(['read', 'export'])('restores saved illustrations once on %s without replacing original text or metadata', async (mode) => {
    const owner = await harness()
    const { question, recognized } = await seedIllustration(owner)
    owner.extract.mockResolvedValue(recognized)
    await owner.collection.update({ id: question.id, description: '保留描述' })
    const request = { id: question.id, document: 'question' as const, kind: 'word' as const }
    const file = mode === 'export'
      ? value(await owner.collection.exportWord({ ids: [question.id], layout: 'paired' }))
      : value((await Promise.all([owner.collection.readFile(request), owner.collection.readFile(request)]))[0])
    const doc = new DOMParser().parseFromString(strFromU8(unzipSync(Buffer.from(file.contentBase64, 'base64'))['word/document.xml']!), 'application/xml')
    expect(doc.documentElement?.textContent).toContain('question 原文')
    expect(doc.documentElement?.textContent).not.toContain('重新识别的文字')
    expect(doc.documentElement?.textContent).not.toContain('![]')
    expect(doc.getElementsByTagName('w:drawing').length).toBe(mode === 'export' ? 2 : 1)
    expect(owner.extract).toHaveBeenCalledTimes(mode === 'export' ? 2 : 1)
    expect(owner.extract).toHaveBeenCalledWith(expect.objectContaining({ includeImages: true }), expect.any(AbortSignal))
    expect(owner.correct).not.toHaveBeenCalled()
    const saved = value(await owner.collection.readFile(request))
    expect(value(await owner.collection.readFile(request))).toEqual(saved)
    expect(owner.extract).toHaveBeenCalledTimes(mode === 'export' ? 2 : 1)
    expect(value(await owner.collection.list()).questions[0]).toMatchObject({
      description: '保留描述', documents: { question: { wordRevision: 2 }, explanation: { wordRevision: mode === 'export' ? 2 : 1 } },
    })
    expect(value(await owner.collection.readFile({ ...request, kind: 'source' })).contentBase64).toBe(pdf)
  })

  it('retains the saved Word on failed illustration recovery and permits a later retry', async () => {
    const owner = await harness()
    const { question, recognized } = await seedIllustration(owner, ['question'])
    const before = value(await owner.collection.list())
    const request = { id: question.id, document: 'question' as const, kind: 'word' as const }
    expect(await owner.collection.readFile(request)).toMatchObject({ ok: false, error: { code: 'ocr-failed' } })
    expect(value(await owner.collection.list())).toEqual(before)
    owner.extract.mockResolvedValue(recognized)
    expect((await owner.collection.readFile(request)).ok).toBe(true)
    expect(owner.extract).toHaveBeenCalledTimes(2)
  })

  it.each(['replace', 'delete'])('does not restore stale illustrations after a source %s during recovery', async (action) => {
    const owner = await harness()
    const { question, recognized } = await seedIllustration(owner, ['question'])
    let finish!: (result: OcrExtractResult) => void
    owner.extract.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const reading = owner.collection.readFile({ id: question.id, document: 'question', kind: 'word' })
    await vi.waitFor(() =>{  expect(owner.extract).toHaveBeenCalledOnce() })
    if (action === 'delete') await owner.collection.delete({ id: question.id })
    else await owner.collection.upload({ id: question.id, document: 'question', files: [{ name: 'replacement.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    finish(recognized)
    expect(await reading).toMatchObject({ ok: false, error: { code: action === 'delete' ? 'not-found' : 'source-changed' } })
    const rows = value(await owner.collection.list()).questions
    if (action === 'delete') expect(rows).toHaveLength(0)
    else expect(rows[0]?.documents.question).toMatchObject({ status: 'pending', source: { name: 'replacement.pdf' } })
  })

  it.each(documentKinds.flatMap(document => ['text', 'native'].map(format => ({ document, format }))))(
    'persists normalized $document $format Word once without OCR or changes to the other document',
    async ({ document: documentKind, format }) => {
      const { collection, facility, extract } = await harness()
      const question = {
        id: 'saved-question' as TeacherExample['id'], number: 1, name: '1', tags: [], description: '',
        handwriting: [], revision: 0, documents: { question: emptyDocument(), explanation: emptyDocument() },
      } satisfies TeacherExample
      const original = format === 'text' ? await Packer.toBuffer(
        new Document({
          sections: [{ children: [new Paragraph(String.raw`求 $\overrightarrow{PA}$，答案为 $-\frac{3}{2}$。`)] }],
        }),
      ) : await createExampleWord(String.raw`求 $\overrightarrow{PA}$，答案为 $-\frac{3}{2}$。`)
      const saved = unzipSync(original)
      saved['word/document.xml'] = strToU8(strFromU8(saved['word/document.xml']!).replaceAll('Times New Roman', 'Arial').replaceAll('w:val="24"', 'w:val="36"'))
      const domain = await facility.open(teacherExampleDomainSpec)
      await domain.table('questions').put(question.id, {
        ...question,
        description: '保留描述',
        documents: {
          ...question.documents,
          [documentKind]: {
            ...emptyDocument(),
            status: 'ready',
            source: {
              id: 'source' as NonNullable<TeacherExampleDocument['source']>['id'],
              name: 'question.pdf',
              mediaType: 'application/pdf',
            },
            sourceBase64: pdf,
            word: {
              name: '1.docx',
              mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              contentBase64: Buffer.from(zipSync(saved)).toString('base64'),
            },
          },
        },
      })
      await domain.close()
      const rebuilt = value(await collection.readFile({ id: question.id, document: documentKind, kind: 'word' }))
      const parts = unzipSync(Buffer.from(rebuilt.contentBase64, 'base64'))
      expect(Buffer.from(parts['word/document.xml'] ?? []).toString()).toContain('<m:acc>')
      expect(strFromU8(parts['word/document.xml']!)).not.toMatch(/Arial|w:val="36"/u)
      expect(Buffer.from(parts['docProps/custom.xml'] ?? []).toString()).toContain('dsh.example.mathml')
      expect(value(await collection.readFile({ id: question.id, document: documentKind, kind: 'word' }))).toEqual(rebuilt)
      expect(value(await collection.list()).questions[0]).toMatchObject({
        description: '保留描述',
        revision: 1,
        documents: { [documentKind]: { wordRevision: 1 }, [documentKind === 'question' ? 'explanation' : 'question']: { status: 'empty', wordRevision: 0 } },
      })
      expect(value(await collection.readFile({ id: question.id, document: documentKind, kind: 'source' })).contentBase64).toBe(pdf)
      expect(extract).not.toHaveBeenCalled()
    })

  it('creates numeric directories concurrently, renames without reordering, and reopens both document pairs with tags and description', async () => {
    const { collection, path, close } = await harness()
    const [first, second] = (await Promise.all([collection.create(), collection.create()])).map(value)
    expect([first?.name, second?.name]).toEqual(['1', '2'])
    const question = first as TeacherExample
    await collection.addTag('  二次方程  ')
    await collection.update({
      id: question.id,
      name: '方程例题',
      tags: ['二次方程'],
      description: '因式分解的课堂练习',
      handwriting: [
        {
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.5, y: 0.6 },
          ],
        },
      ],
    })
    await collection.upload({ id: question.id, document: 'question', files: [{ name: 'question.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    expect(value(await collection.recognize({ id: question.id, document: 'question' })).documents.question.status).toBe('ready')
    const word = value(await collection.readFile({ id: question.id, document: 'question', kind: 'word' }))
    const xml = unzipSync(Buffer.from(word.contentBase64, 'base64'))['word/document.xml']
    const document = new DOMParser().parseFromString(Buffer.from(xml ?? []).toString(), 'application/xml')
    expect(document.documentElement?.textContent).toContain('已知 x² − 3x + 2 = 0，求 x。')
    await collection.upload({ id: question.id, document: 'explanation', files: [{ name: 'explanation.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    expect(value(await collection.recognize({ id: question.id, document: 'explanation' })).documents.explanation.status).toBe('ready')
    const explanationWord = value(await collection.readFile({ id: question.id, document: 'explanation', kind: 'word' }))
    expect(explanationWord.name).toBe('方程例题-解析.docx')
    expect(word.name).toBe('方程例题.docx')
    const before = value(await collection.list())
    expect(JSON.stringify(before)).not.toContain('contentBase64')
    await close()
    expect((await readFile(path)).subarray(0, 16).toString()).toBe('SQLite format 3\0')
    const reopened = await harness(path)
    const domain = await reopened.facility.open(teacherExampleDomainSpec)
    const stored = domain.table('questions').get(question.id)!
    await domain.table('questions').put(question.id, {
      ...stored,
      documents: {
        ...stored.documents,
        explanation: { ...stored.documents.explanation, word: { ...explanationWord, name: '方程例题-explanation.docx' } },
      },
    })
    await domain.close()
    expect(value(await reopened.collection.list())).toEqual(before)
    expect(value(await reopened.collection.readFile({ id: question.id, document: 'question', kind: 'source' })).contentBase64).toBe(pdf)
    expect(value(await reopened.collection.readFile({ id: question.id, document: 'question', kind: 'word' }))).toEqual(word)
    expect(value(await reopened.collection.readFile({ id: question.id, document: 'explanation', kind: 'source' })).contentBase64).toBe(pdf)
    expect(value(await reopened.collection.readFile({ id: question.id, document: 'explanation', kind: 'word' }))).toEqual(explanationWord)
    expect(reopened.extract).not.toHaveBeenCalled()
    await reopened.collection.delete({ id: question.id })
    for (const document of documentKinds) {
      for (const kind of ['source', 'word'] as const) {
        expect(await reopened.collection.readFile({ id: question.id, document, kind })).toMatchObject({ ok: false, error: { code: 'not-found' } })
      }
    }
    expect(value(await reopened.collection.list()).tags).toEqual(['二次方程'])
  })

  it('persists preset deletion while retaining existing question tags and rejecting new assignments', async () => {
    const owner = await harness()
    const first = value(await owner.collection.create())
    const second = value(await owner.collection.create())
    value(await owner.collection.addTag('几何'))
    value(await owner.collection.addTag('向量'))
    const tagged = value(await owner.collection.update({ id: first.id, tags: ['几何'] }))
    expect(value(await owner.collection.deleteTag('  几何  '))).toBe('几何')
    expect(value(await owner.collection.deleteTag('几何'))).toBe('几何')
    expect(await owner.collection.deleteTag('   ')).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    await owner.close()
    const { collection } = await harness(owner.path)
    expect(value(await collection.list())).toMatchObject({ tags: ['向量'], questions: [tagged, second] })
    expect(value(await collection.update({ id: first.id, description: '仍可编辑' })).tags).toEqual(['几何'])
    expect(value(await collection.update({ id: first.id, tags: ['几何', '向量'] })).tags).toEqual(['几何', '向量'])
    expect(await collection.update({ id: second.id, tags: ['几何'] })).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    value(await collection.update({ id: first.id, tags: [] }))
    expect(await collection.update({ id: first.id, tags: ['几何'] })).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    value(await collection.addTag('几何'))
    expect(value(await collection.update({ id: first.id, tags: ['几何'] })).tags).toEqual(['几何'])
  })

  it('keeps metadata edits made during OCR and collapses duplicate recognition requests', async () => {
    let finish!: (result: OcrExtractResult) => void
    const extract = vi.fn<ConstructorParameters<typeof TeacherExampleCollection>[2]>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { collection } = await harness(undefined, extract)
    const question = value(await collection.create())
    await collection.upload({ id: question.id, document: 'question', files: [{ name: 'question.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    const recognizing = collection.recognize({ id: question.id, document: 'question' })
    const duplicate = collection.recognize({ id: question.id, document: 'question' })
    await vi.waitFor(() => {
      expect(extract).toHaveBeenCalledOnce()
    })
    await collection.update({ id: question.id, description: '识别期间写的描述' })
    finish(ocrResult())
    expect(value(await recognizing)).toMatchObject({ description: '识别期间写的描述', documents: { question: { status: 'ready' } } })
    expect(await duplicate).toEqual(await recognizing)
  })

  it('recognizes question and explanation independently while preserving edits and the other Word file', async () => {
    const finishes = new Map<string, (result: OcrExtractResult) => void>()
    const extract = vi.fn<ConstructorParameters<typeof TeacherExampleCollection>[2]>(request =>
      new Promise((resolve) => {
        finishes.set(request.name, resolve)
      }),
    )
    const { collection } = await harness(undefined, extract)
    const question = value(await collection.create())
    for (const document of documentKinds) {
      await collection.upload({ id: question.id, document, files: [{ name: `${document}.pdf`, mediaType: 'application/pdf', contentBase64: pdf }] })
    }
    const recognizing = {
      question: collection.recognize({ id: question.id, document: 'question' }),
      explanation: collection.recognize({ id: question.id, document: 'explanation' }),
    }
    await vi.waitFor(() => { expect(extract).toHaveBeenCalledTimes(2) })
    await collection.update({ id: question.id, description: '独立识别期间的笔记' })
    finishes.get('explanation.pdf')?.(ocrResult('解析：代入求解。'))
    const explanation = value(await recognizing.explanation)
    expect(explanation.documents.question.status).toBe('pending')
    expect(explanation.documents.explanation.status).toBe('ready')
    finishes.get('question.pdf')?.(ocrResult('题目：求方程的根。'))
    expect(value(await recognizing.question)).toMatchObject({ description: '独立识别期间的笔记', documents: { question: { status: 'ready' }, explanation: { status: 'ready' } } })
    for (const document of documentKinds) {
      const word = value(await collection.readFile({ id: question.id, document, kind: 'word' }))
      const xml = Buffer.from(unzipSync(Buffer.from(word.contentBase64, 'base64'))['word/document.xml'] ?? []).toString()
      expect(xml).toContain(document === 'question' ? '题目：求方程的根。' : '解析：代入求解。')
    }
    const explanationWord = value(await collection.readFile({ id: question.id, document: 'explanation', kind: 'word' }))
    await collection.upload({ id: question.id, document: 'question', files: [{ name: 'replacement.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    expect(value(await collection.readFile({ id: question.id, document: 'explanation', kind: 'word' }))).toEqual(explanationWord)
    expect(await collection.readFile({ id: question.id, document: 'question', kind: 'word' })).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it.each(documentKinds.flatMap(document => (['replace', 'delete'] as const).map(operation => ({ document, operation }))))('does not attach late OCR to a $operation $document source', async ({ document, operation }) => {
    let finish!: (result: OcrExtractResult) => void
    const extract = vi.fn<ConstructorParameters<typeof TeacherExampleCollection>[2]>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { collection } = await harness(undefined, extract)
    const question = value(await collection.create())
    await collection.upload({ id: question.id, document, files: [{ name: 'question.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    const recognizing = collection.recognize({ id: question.id, document })
    await vi.waitFor(() => {
      expect(extract).toHaveBeenCalledOnce()
    })
    if (operation === 'delete') await collection.delete({ id: question.id })
    else
      await collection.upload({ id: question.id, document, files: [{ name: 'replacement.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    finish(ocrResult())
    expect(await recognizing).toMatchObject({
      ok: false,
      error: { code: operation === 'delete' ? 'not-found' : 'source-changed' },
    })
    expect(await collection.readFile({ id: question.id, document, kind: 'word' })).toMatchObject({ ok: false })
  })

  it.each(documentKinds)('retains the %s original across OCR failure and retries without saving truncated Word text', async (document) => {
    const extract = vi
      .fn<ConstructorParameters<typeof TeacherExampleCollection>[2]>()
      .mockResolvedValueOnce({ ok: false, error: { code: 'provider-unavailable', message: 'offline' } })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          name: 'question.pdf',
          mediaType: 'application/pdf',
          provider: 'mineru',
          markdown: 'partial',
          truncated: true,
        },
      })
      .mockResolvedValueOnce(ocrResult())
    const { collection } = await harness(undefined, extract)
    const question = value(await collection.create())
    await collection.upload({ id: question.id, document, files: [{ name: 'question.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    expect(value(await collection.recognize({ id: question.id, document }))).toMatchObject({ documents: { [document]: { status: 'error', ocrError: 'ocr-unavailable' } } })
    expect(value(await collection.recognize({ id: question.id, document }))).toMatchObject({ documents: { [document]: { status: 'error', ocrError: 'ocr-truncated' } } })
    expect(value(await collection.readFile({ id: question.id, document, kind: 'source' })).contentBase64).toBe(pdf)
    expect(value(await collection.recognize({ id: question.id, document })).documents[document].status).toBe('ready')
  })

  it('rejects malformed uploads and unknown tag references without replacing a saved source', async () => {
    const { collection } = await harness()
    const question = value(await collection.create())
    const upload = { id: question.id, document: 'question' as const, files: [{ name: 'question.pdf', mediaType: 'application/pdf' as const, contentBase64: pdf }] }
    await collection.upload(upload)
    for (const patch of [
      { name: '../question.pdf' },
      { contentBase64: 'not base64' },
      { contentBase64: Buffer.from('not a pdf').toString('base64') },
    ]) {
      expect(await collection.upload({ ...upload, files: [{ ...upload.files[0]!, ...patch }] })).toMatchObject({
        ok: false,
        error: { code: 'invalid-request' },
      })
    }
    expect(
      await collection.upload({ ...upload, files: [{ ...upload.files[0]!, contentBase64: Buffer.alloc(1024 * 1024 + 1).toString('base64') }] }),
    ).toMatchObject({ ok: false, error: { code: 'file-too-large' } })
    expect(await collection.update({ id: question.id, tags: ['missing'] })).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    })
    expect(await collection.update({ id: question.id, handwriting: [{ points: [{ x: 2, y: 0 }] }] })).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    })
    expect(value(await collection.readFile({ id: question.id, document: 'question', kind: 'source' })).contentBase64).toBe(pdf)
    expect(
      teacherExampleDomainSpec.tables.questions.valueSchema.safeParse({
        ...question,
        documents: { question: emptyDocument(), explanation: { ...emptyDocument(), status: 'ready' } },
      }).success,
    ).toBe(false)
  })

  it.each(['paired', 'grouped'] as const)('exports %s questions and explanations in selection order without changing saved files or running OCR', async (layout) => {
    const { collection, extract } = await harness()
    const questions: TeacherExample[] = []
    for (let index = 0; index < 3; index++) {
      const question = value(await collection.create())
      questions.push(question)
      for (const document of documentKinds) {
        if (index === 1 && document === 'explanation') continue
        extract.mockResolvedValueOnce(ocrResult(String.raw`${document} content ${index} $\frac{${index + 1}}{2}$`))
        await collection.upload({ id: question.id, document, files: [{ name: `${document}.pdf`, mediaType: 'application/pdf', contentBase64: pdf }] })
        value(await collection.recognize({ id: question.id, document }))
      }
    }
    await collection.addTag('标签不导出')
    await collection.update({ id: questions[0]!.id, name: '目录标题不导出', tags: ['标签不导出'], description: '描述不导出' })
    const before = value(await collection.list())
    extract.mockClear()
    const request: TeacherExampleExportRequest = {
      ids: questions.map(question => question.id).reverse(), layout,
    }
    const file = value(await collection.exportWord(request))
    const parts = unzipSync(Buffer.from(file.contentBase64, 'base64'))
    const xml = Buffer.from(parts['word/document.xml'] ?? []).toString()
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const text = doc.documentElement?.textContent ?? ''
    const expected = layout === 'paired'
      ? ['question content 2', 'explanation content 2', 'question content 1', 'question content 0', 'explanation content 0']
      : ['question content 2', 'question content 1', 'question content 0', 'explanation content 2', 'explanation content 0']
    const positions = expected.map(part => text.indexOf(part))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(text).not.toMatch(/题目 [123]|解析 [123]|题目与解析/u)
    expect(text).not.toContain('目录标题不导出')
    expect(text).not.toContain('标签不导出')
    expect(text).not.toContain('描述不导出')
    expect(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'f').length).toBe(5)
    expect(xml).not.toContain('\\frac')
    expect((xml.match(/<w:sectPr>/gu) ?? []).length).toBe(layout === 'grouped' ? 2 : 1)
    const paragraphs = Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p'))
      .map(paragraph => paragraph.textContent?.replace(/ [123]2$/u, ''))
    expect(paragraphs).toEqual(layout === 'paired'
      ? ['question content 2', 'explanation content 2', '', '', 'question content 1', '', '', 'question content 0', 'explanation content 0']
      : ['question content 2', '', '', 'question content 1', '', '', 'question content 0', '', 'explanation content 2', '', '', 'explanation content 0'])
    expect(Buffer.from(parts['docProps/custom.xml'] ?? []).toString()).toContain('dsh.example.mathml')
    expect(value(await collection.list())).toEqual(before)
    expect(extract).not.toHaveBeenCalled()
    expect(file.name).toBe('examples.docx')
  })

  it('rejects empty, duplicate, missing, and unfinished selections without exporting partial content', async () => {
    const { collection } = await harness()
    const question = value(await collection.create())
    const request: TeacherExampleExportRequest = {
      ids: [question.id], layout: 'paired',
    }
    expect(await collection.exportWord({ ...request, ids: [] })).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(await collection.exportWord({ ...request, ids: [question.id, question.id] })).toMatchObject({
      ok: false, error: { code: 'invalid-request' },
    })
    expect(await collection.exportWord(request)).toMatchObject({ ok: false, error: { code: 'export-not-ready' } })
    await collection.upload({ id: question.id, document: 'question', files: [{ name: 'question.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    value(await collection.recognize({ id: question.id, document: 'question' }))
    expect((await collection.exportWord(request)).ok).toBe(true)
    await collection.upload({ id: question.id, document: 'explanation', files: [{ name: 'explanation.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    expect(await collection.exportWord(request)).toMatchObject({ ok: false, error: { code: 'export-not-ready' } })
    await collection.delete({ id: question.id })
    expect(await collection.exportWord(request)).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('aborts provider work and closes storage before disposal resolves', async () => {
    const extract = vi.fn<ConstructorParameters<typeof TeacherExampleCollection>[2]>(
      (_request, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve({ ok: false, error: { code: 'provider-failure', message: 'aborted' } })
            },
            { once: true },
          )
        }),
    )
    const { collection, close } = await harness(undefined, extract)
    const question = value(await collection.create())
    await collection.upload({ id: question.id, document: 'question', files: [{ name: 'question.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    await collection.upload({ id: question.id, document: 'explanation', files: [{ name: 'explanation.pdf', mediaType: 'application/pdf', contentBase64: pdf }] })
    const recognizing = Promise.all(documentKinds.map(document => collection.recognize({ id: question.id, document })))
    await vi.waitFor(() => {
      expect(extract).toHaveBeenCalledTimes(2)
    })
    await close()
    for (const result of await recognizing) expect(result).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(await collection.create()).toMatchObject({ ok: false, error: { code: 'disposed' } })
  })
})
