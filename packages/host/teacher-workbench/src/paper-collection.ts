/** Independent paper storage; uploaded originals are never replaced by previews. */

import { randomUUID } from 'node:crypto'
import { defineDomain, domainTable, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { PDFDocument } from 'pdf-lib'
import type {
  TeacherPaper, TeacherPaperCatalog, TeacherPaperErrorCode, TeacherPaperFile, TeacherPaperFileRequest,
  TeacherPaperFormat, TeacherPaperId, TeacherPaperRequest, TeacherPaperResult, TeacherPaperSourceId,
  TeacherPaperUpdateRequest, TeacherPaperUploadRequest,
} from './paper-types.ts'

const identity = <T extends string>() => z.string().min(1).transform(value => value as T)
const tag = z.string().trim().min(1).max(80)
const fileName = z.string().trim().min(1).max(255).refine(value => !/[\\/\u0000-\u001f]/u.test(value))
const format = z.enum(['pdf', 'png', 'jpeg', 'webp', 'gif', 'bmp', 'docx', 'doc', 'caj'])
const fileSchema = z.object({ name: fileName, mediaType: z.string(), contentBase64: z.string().min(1) })
const sourceSchema = z.object({
  id: identity<TeacherPaperSourceId>(), name: fileName, format, mediaType: z.string(),
  bytes: z.number().int().positive(), contentBase64: z.string().min(1), preview: fileSchema.nullable(),
})
const recordSchema = z.object({
  id: identity<TeacherPaperId>(), number: z.number().int().positive(), name: z.string().trim().min(1).max(120),
  tags: z.array(tag).max(100), description: z.string().max(50_000), files: z.array(sourceSchema).max(100),
  revision: z.number().int().nonnegative(),
})
type PaperRecord = z.infer<typeof recordSchema>
const requestSchema = z.object({ id: identity<TeacherPaperId>() })
const updateSchema = requestSchema.extend({
  name: z.string().trim().min(1).max(120).optional(), tags: z.array(tag).max(100).optional(),
  description: z.string().max(50_000).optional(),
})
const uploadSchema = requestSchema.extend({
  files: z.array(z.object({ name: fileName, format, contentBase64: z.string().min(1) })).min(1).max(100),
})
const fileRequestSchema = requestSchema.extend({
  sourceId: identity<TeacherPaperSourceId>(), kind: z.enum(['source', 'preview']),
})

/** Separate format and namespace keep paper uploads independent from example OCR. */
export const teacherPaperDomainSpec = defineDomain({
  name: 'teacher_paper_collection', version: 1,
  tables: {
    papers: domainTable<TeacherPaperId, PaperRecord>(recordSchema),
    tags: domainTable<string, { name: string }>(z.object({ name: tag })),
  },
})

const MEDIA_TYPES: Record<TeacherPaperFormat, string> = {
  pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  caj: 'application/x-caj',
}

class PaperError extends Error {
  constructor(readonly code: TeacherPaperErrorCode, message: string) { super(message) }
}

/** Metadata writes are serialized; preview rendering runs independently and checks source identity at commit. */
export class TeacherPaperCollection {
  private domain: Promise<Domain<typeof teacherPaperDomainSpec>> | undefined
  private tail: Promise<void> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private readonly previews = new Map<TeacherPaperSourceId, Promise<TeacherPaperResult<TeacherPaperFile>>>()

  /**
   * @param facility - deployment-owned storage routing.
   * @param maxFileBytes - maximum total decoded bytes in one upload.
   * @param maxPreviewBytes - maximum complete generated preview bytes.
   * @param render - selected converter; receives original bytes and service-lifetime cancellation.
   */
  constructor(
    private readonly facility: DomainFacility,
    private readonly maxFileBytes: () => number,
    private readonly maxPreviewBytes: () => number,
    private readonly render: (
      source: TeacherPaperFile & { readonly id: TeacherPaperSourceId; readonly format: TeacherPaperFormat },
      signal: AbortSignal,
    ) => Promise<TeacherPaperResult<TeacherPaperFile>>,
  ) {}

  /**
   * Read searchable metadata independently of original and preview payloads.
   * @returns numbered directories and preset tags, without file bytes.
   */
  list(): Promise<TeacherPaperResult<TeacherPaperCatalog>> {
    return this.enqueue(async () => {
      const domain = await this.open()
      return {
        papers: [...domain.table('papers').entries()].map(([, row]) => metadata(row)).sort((a, b) => a.number - b.number),
        tags: [...domain.table('tags').entries()].map(([, row]) => row.name).sort((a, b) => a.localeCompare(b)),
      }
    })
  }

  /**
   * Assign the next directory number in creation order.
   * @returns an empty directory with the next creation number.
   */
  create(): Promise<TeacherPaperResult<TeacherPaper>> {
    return this.enqueue(async () => {
      const table = (await this.open()).table('papers')
      const number = [...table.entries()].reduce((maximum, [, row]) => Math.max(maximum, row.number), 0) + 1
      const row: PaperRecord = {
        id: randomUUID() as TeacherPaperId, number, name: String(number), tags: [], description: '', files: [], revision: 0,
      }
      await table.put(row.id, row)
      return metadata(row)
    })
  }

  /**
   * Commit submitted metadata fields while preserving unrelated edits.
   * @param request - paper identity and changed fields; newly selected tags must exist in the preset catalog.
   * @returns committed metadata.
   */
  update(request: TeacherPaperUpdateRequest): Promise<TeacherPaperResult<TeacherPaper>> {
    return this.enqueue(async () => {
      const parsed = parse(updateSchema, request)
      const domain = await this.open()
      const current = this.requireRecord(domain, parsed.id)
      const tags = parsed.tags === undefined ? current.tags : [...new Set(parsed.tags)]
      if (tags.some(name => !current.tags.includes(name) && domain.table('tags').get(name) === undefined))
        throw new PaperError('invalid-request', 'Unknown paper tag')
      const row = recordSchema.parse({ ...current, ...parsed, tags, revision: current.revision + 1 })
      await domain.table('papers').put(row.id, row)
      return metadata(row)
    })
  }

  /**
   * Save a reusable preset independently of paper selection.
   * @param name - reusable preset name.
   * @returns the saved normalized name; existing names are idempotent.
   */
  addTag(name: string): Promise<TeacherPaperResult<string>> {
    return this.enqueue(async () => {
      const normalized = parse(tag, name)
      await (await this.open()).table('tags').put(normalized, { name: normalized })
      return normalized
    })
  }

  /**
   * Remove a preset without changing tags already assigned to papers.
   * @param name - preset to remove; assigned paper tags remain searchable.
   * @returns normalized removed name.
   */
  deleteTag(name: string): Promise<TeacherPaperResult<string>> {
    return this.enqueue(async () => {
      const normalized = parse(tag, name)
      await (await this.open()).table('tags').delete(normalized)
      return normalized
    })
  }

  /**
   * Delete one directory and all its retained file payloads.
   * @param request - paper to delete with its original files and previews.
   * @returns deleted identity.
   */
  delete(request: TeacherPaperRequest): Promise<TeacherPaperResult<TeacherPaperId>> {
    return this.enqueue(async () => {
      const { id } = parse(requestSchema, request)
      await (await this.open()).table('papers').delete(id)
      return id
    })
  }

  /**
   * Retain a complete original batch before any preview generation.
   * @param request - ordered originals; invalid or oversized batches leave previous files intact.
   * @returns metadata after one atomic file replacement, preserving the paper name, tags, and description.
   */
  upload(request: TeacherPaperUploadRequest): Promise<TeacherPaperResult<TeacherPaper>> {
    return this.enqueue(async () => {
      const parsed = parse(uploadSchema, request)
      const limit = this.maxFileBytes()
      let total = 0
      const files = parsed.files.map((file) => {
        if (file.contentBase64.length > Math.ceil(limit / 3) * 4) throw new PaperError('file-too-large', 'Paper upload exceeds its byte limit')
        const bytes = Buffer.from(file.contentBase64, 'base64')
        if (bytes.length === 0 || bytes.toString('base64') !== file.contentBase64 || !matchesFormat(bytes, file.format))
          throw new PaperError('invalid-request', 'Invalid paper file')
        total += bytes.length
        if (total > limit) throw new PaperError('file-too-large', 'Paper upload exceeds its byte limit')
        return {
          ...file, id: randomUUID() as TeacherPaperSourceId, mediaType: MEDIA_TYPES[file.format], bytes: bytes.length,
          preview: null,
        }
      })
      const domain = await this.open()
      const current = this.requireRecord(domain, parsed.id)
      const row = { ...current, files, revision: current.revision + 1 }
      await domain.table('papers').put(row.id, row)
      return metadata(row)
    })
  }

  /**
   * Read a source or generate a preview shared by simultaneous readers.
   * @param request - current immutable source and original/preview selection.
   * @returns original bytes, or a cached preview; Word DOC and CAJ previews are generated without modifying originals.
   */
  async readFile(request: TeacherPaperFileRequest): Promise<TeacherPaperResult<TeacherPaperFile>> {
    const selected = await this.enqueue(async () => {
      const parsed = parse(fileRequestSchema, request)
      const row = this.requireRecord(await this.open(), parsed.id)
      const source = row.files.find(file => file.id === parsed.sourceId)
      if (source === undefined) throw new PaperError('source-changed', 'Paper source is no longer current')
      return source
    })
    if (!selected.ok) return selected
    const source = selected.value
    const original = { name: source.name, mediaType: source.mediaType, contentBase64: source.contentBase64 }
    if (request.kind === 'source' || (source.format !== 'caj' && source.format !== 'doc' && source.format !== 'docx'))
      return { ok: true, value: original }
    if (source.preview !== null) return { ok: true, value: source.preview }
    const active = this.previews.get(source.id)
    if (active !== undefined) return active
    const pending = this.run(async () => {
      const rendered = await this.render({ ...original, id: source.id, format: source.format }, this.lifetime.signal)
      if (!rendered.ok) throw new PaperError(rendered.error.code, rendered.error.message)
      const bytes = Buffer.from(rendered.value.contentBase64, 'base64')
      if (bytes.length > this.maxPreviewBytes()) throw new PaperError('file-too-large', 'Paper preview exceeds its byte limit')
      if (rendered.value.mediaType !== 'application/pdf' || !matchesFormat(bytes, 'pdf'))
        throw new PaperError('preview-failed', 'Converter did not produce a PDF preview')
      try {
        const document = await PDFDocument.load(bytes, { updateMetadata: false })
        if (document.getPageCount() === 0) throw new Error('Empty PDF preview')
      } catch (_error) {
        throw new PaperError('preview-failed', 'Converter did not produce a readable PDF preview')
      }
      const committed = await this.enqueue(async () => {
        const domain = await this.open()
        const current = this.requireRecord(domain, request.id)
        if (!current.files.some(file => file.id === source.id)) throw new PaperError('source-changed', 'Paper source changed during rendering')
        await domain.table('papers').put(current.id, {
          ...current, files: current.files.map(file => file.id === source.id ? { ...file, preview: rendered.value } : file),
        })
        return rendered.value
      })
      if (!committed.ok) throw new PaperError(committed.error.code, committed.error.message)
      return committed.value
    }).finally(() => { this.previews.delete(source.id) })
    this.previews.set(source.id, pending)
    return pending
  }

  /** Cancel converters, settle queued writes, and close the independent storage handle. */
  async dispose(): Promise<void> {
    this.lifetime.abort(new Error('Paper collection is closed'))
    await Promise.allSettled(this.previews.values())
    await this.tail
    const domain = await this.domain?.catch(() => undefined)
    await domain?.close()
  }

  private open(): Promise<Domain<typeof teacherPaperDomainSpec>> {
    this.lifetime.signal.throwIfAborted()
    this.domain ??= this.facility.open(teacherPaperDomainSpec).catch((error: unknown) => {
      this.domain = undefined
      throw error
    })
    return this.domain
  }

  private requireRecord(domain: Domain<typeof teacherPaperDomainSpec>, id: TeacherPaperId): PaperRecord {
    const row = domain.table('papers').get(id)
    if (row === undefined) throw new PaperError('not-found', 'Paper does not exist')
    return row
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<TeacherPaperResult<T>> {
    const queued = this.tail.then(() => this.run(operation))
    this.tail = queued.then(() => {})
    return queued
  }

  private async run<T>(operation: () => Promise<T>): Promise<TeacherPaperResult<T>> {
    try {
      if (this.lifetime.signal.aborted) throw new PaperError('disposed', 'Paper collection is closed')
      return { ok: true, value: await operation() }
    } catch (error) {
      return { ok: false, error: error instanceof PaperError
        ? { code: error.code, message: error.message }
        : { code: 'storage-failure', message: 'Paper collection operation failed' } }
    }
  }
}

function metadata(row: PaperRecord): TeacherPaper {
  return structuredClone({ ...row, files: row.files.map(({ contentBase64: _bytes, preview: _preview, ...source }) => source) })
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new PaperError('invalid-request', 'Invalid paper request')
  return parsed.data
}

function matchesFormat(bytes: Buffer, format: TeacherPaperFormat): boolean {
  const head = bytes.subarray(0, 12)
  switch (format) {
    case 'pdf': return bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))
    case 'png': return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    case 'jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    case 'webp': return head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP'
    case 'gif': return /^GIF8[79]a/u.test(head.toString('ascii'))
    case 'bmp': return head.subarray(0, 2).toString() === 'BM'
    case 'docx': return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
    case 'doc': return head.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]))
    case 'caj': return /^(CAJ|HN|KDH|%PDF-)/u.test(head.toString('ascii')) || head[0] === 0xc8
  }
}
