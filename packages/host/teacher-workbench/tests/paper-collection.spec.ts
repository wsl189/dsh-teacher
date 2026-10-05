import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '../../../storage/storage-sqlite/src/index.ts'
import { TeacherPaperCollection } from '../src/paper-collection.ts'
import type { TeacherPaperFile, TeacherPaperResult } from '../src/paper-types.ts'

const roots: string[] = []
const cleanups: (() => Promise<void>)[] = []
let pdf: TeacherPaperFile
const caj = { name: '研究论文.caj', format: 'caj' as const, contentBase64: Buffer.from('CAJ\0paper original').toString('base64') }
const docx = { name: '研究论文.docx', format: 'docx' as const, contentBase64: Buffer.from('PK\x03\x04paper original').toString('base64') }

beforeAll(async () => {
  const document = await PDFDocument.create()
  document.addPage()
  pdf = { name: 'preview.pdf', mediaType: 'application/pdf', contentBase64: Buffer.from(await document.save()).toString('base64') }
})

function value<T>(result: TeacherPaperResult<T>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

async function harness(
  path?: string,
  render = vi.fn<ConstructorParameters<typeof TeacherPaperCollection>[3]>().mockResolvedValue({ ok: true, value: pdf }),
  limit = 1024 * 1024,
) {
  if (path === undefined) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-paper-test-'))
    roots.push(root)
    path = join(root, 'papers.sqlite')
  }
  const ctx = new Context()
  const fiber = await ctx.plugin(Storage)
  const backend = new SqliteStorageBackend({ path, journalMode: 'wal' })
  const unregister = ctx.storage.backend.register('sqlite', backend)
  const facility = new DomainFacility(ctx, { backend: 'sqlite' })
  const collection = new TeacherPaperCollection(facility, () => limit, () => limit, render)
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await collection.dispose()
    unregister()
    await backend.close()
    await fiber.dispose()
  }
  cleanups.push(close)
  return { collection, path, render, close }
}

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('paper collection', () => {
  it('persists custom numbers, tags, descriptions, and byte-identical originals across reopening', async () => {
    const first = await harness()
    const row = value(await first.collection.create())
    expect(row.name).toBe('1')
    await first.collection.addTag('数学教育')
    await first.collection.update({ id: row.id, name: 'P-2026-01', tags: ['数学教育'], description: '几何教学的实证研究' })
    const uploaded = value(await first.collection.upload({ id: row.id, files: [caj] }))
    expect(uploaded).toMatchObject({ name: 'P-2026-01', tags: ['数学教育'], description: '几何教学的实证研究' })
    expect(JSON.stringify(value(await first.collection.list()))).not.toContain('contentBase64')
    await first.close()
    const second = await harness(first.path)
    const reopened = value(await second.collection.list()).papers[0]!
    expect(reopened).toEqual(uploaded)
    expect(value(await second.collection.readFile({ id: row.id, sourceId: uploaded.files[0]!.id, kind: 'source' })).contentBase64).toBe(caj.contentBase64)
    expect(second.render).not.toHaveBeenCalled()
  })

  it.each([caj, docx])('caches a $format preview while retaining its original and concurrent description edits', async (source) => {
    let resolve!: (result: TeacherPaperResult<TeacherPaperFile>) => void
    const render = vi.fn<ConstructorParameters<typeof TeacherPaperCollection>[3]>(() => new Promise((done) => { resolve = done }))
    const owner = await harness(undefined, render)
    const row = value(await owner.collection.create())
    const uploaded = value(await owner.collection.upload({ id: row.id, files: [source] }))
    const request = { id: row.id, sourceId: uploaded.files[0]!.id, kind: 'preview' as const }
    const first = owner.collection.readFile(request)
    const shared = owner.collection.readFile(request)
    await vi.waitFor(() =>{  expect(render).toHaveBeenCalledTimes(1) })
    await owner.collection.update({ id: row.id, description: '阅读中新增的笔记' })
    resolve({ ok: true, value: pdf })
    expect(value(await first)).toEqual(pdf)
    expect(value(await shared)).toEqual(pdf)
    expect(value(await owner.collection.list()).papers[0]!.description).toBe('阅读中新增的笔记')
    await owner.close()
    const reopened = await harness(owner.path)
    expect(value(await reopened.collection.readFile(request))).toEqual(pdf)
    expect(reopened.render).not.toHaveBeenCalled()
    expect(value(await reopened.collection.readFile({ ...request, kind: 'source' })).contentBase64).toBe(source.contentBase64)
  })

  it('does not commit an obsolete preview after source replacement', async () => {
    let resolve!: (result: TeacherPaperResult<TeacherPaperFile>) => void
    const render = vi.fn<ConstructorParameters<typeof TeacherPaperCollection>[3]>(() => new Promise((done) => { resolve = done }))
    const owner = await harness(undefined, render)
    const row = value(await owner.collection.create())
    const uploaded = value(await owner.collection.upload({ id: row.id, files: [caj] }))
    const preview = owner.collection.readFile({ id: row.id, sourceId: uploaded.files[0]!.id, kind: 'preview' })
    await vi.waitFor(() =>{  expect(render).toHaveBeenCalled() })
    const replaced = value(await owner.collection.upload({ id: row.id, files: [{ name: '新论文.pdf', format: 'pdf', contentBase64: pdf.contentBase64 }] }))
    resolve({ ok: true, value: pdf })
    expect(await preview).toMatchObject({ ok: false, error: { code: 'source-changed' } })
    expect(value(await owner.collection.list()).papers[0]!.files).toEqual(replaced.files)
  })

  it('keeps originals downloadable after preview failure and retries generation', async () => {
    const render = vi.fn<ConstructorParameters<typeof TeacherPaperCollection>[3]>()
      .mockResolvedValueOnce({ ok: false, error: { code: 'preview-failed', message: 'Unsupported CAJ variant' } })
      .mockResolvedValueOnce({ ok: true, value: pdf })
    const owner = await harness(undefined, render)
    const row = value(await owner.collection.create())
    const uploaded = value(await owner.collection.upload({ id: row.id, files: [caj] }))
    const request = { id: row.id, sourceId: uploaded.files[0]!.id, kind: 'preview' as const }
    expect(await owner.collection.readFile(request)).toMatchObject({ ok: false, error: { code: 'preview-failed' } })
    expect(value(await owner.collection.readFile({ ...request, kind: 'source' })).contentBase64).toBe(caj.contentBase64)
    expect(value(await owner.collection.readFile(request))).toEqual(pdf)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid and oversized complete uploads without changing existing files', async () => {
    const owner = await harness(undefined, undefined, 32)
    const row = value(await owner.collection.create())
    const previous = value(await owner.collection.upload({ id: row.id, files: [caj] }))
    expect(await owner.collection.upload({ id: row.id, files: [{ ...caj, contentBase64: Buffer.from('invalid').toString('base64') }] }))
      .toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(await owner.collection.upload({ id: row.id, files: [caj, caj, caj] }))
      .toMatchObject({ ok: false, error: { code: 'file-too-large' } })
    expect(value(await owner.collection.list()).papers[0]!.files).toEqual(previous.files)
  })

  it('preserves assigned tags when a preset is deleted and removes files with the directory', async () => {
    const owner = await harness()
    const row = value(await owner.collection.create())
    await owner.collection.addTag('研究方法')
    await owner.collection.update({ id: row.id, tags: ['研究方法'] })
    await owner.collection.deleteTag('研究方法')
    expect(value(await owner.collection.list())).toMatchObject({ tags: [], papers: [{ tags: ['研究方法'] }] })
    expect(await owner.collection.update({ id: row.id, tags: ['不存在的预设'] })).toMatchObject({ ok: false })
    await owner.collection.delete({ id: row.id })
    expect(value(await owner.collection.list()).papers).toEqual([])
  })

  it('does not cache unreadable converter output and leaves its original available', async () => {
    const render = vi.fn<ConstructorParameters<typeof TeacherPaperCollection>[3]>()
      .mockResolvedValueOnce({ ok: true, value: { ...pdf, contentBase64: Buffer.from('%PDF-broken').toString('base64') } })
      .mockResolvedValueOnce({ ok: true, value: pdf })
    const owner = await harness(undefined, render)
    const row = value(await owner.collection.create())
    const uploaded = value(await owner.collection.upload({ id: row.id, files: [caj] }))
    const request = { id: row.id, sourceId: uploaded.files[0]!.id, kind: 'preview' as const }
    expect(await owner.collection.readFile(request)).toMatchObject({ ok: false, error: { code: 'preview-failed' } })
    expect(value(await owner.collection.readFile({ ...request, kind: 'source' })).contentBase64).toBe(caj.contentBase64)
    expect(value(await owner.collection.readFile(request))).toEqual(pdf)
  })

  it('settles preview cancellation before storage disposal', async () => {
    const render = vi.fn<ConstructorParameters<typeof TeacherPaperCollection>[3]>((_source, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () =>{  resolve({ ok: false, error: { code: 'disposed', message: 'Closed' } }) }, { once: true })
    }))
    const owner = await harness(undefined, render)
    const row = value(await owner.collection.create())
    const uploaded = value(await owner.collection.upload({ id: row.id, files: [caj] }))
    const preview = owner.collection.readFile({ id: row.id, sourceId: uploaded.files[0]!.id, kind: 'preview' })
    await vi.waitFor(() =>{  expect(render).toHaveBeenCalled() })
    await owner.close()
    expect(await preview).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(await owner.collection.list()).toMatchObject({ ok: false, error: { code: 'disposed' } })
  })
})
