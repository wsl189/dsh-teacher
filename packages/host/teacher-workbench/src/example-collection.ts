/** Question metadata, source bytes, and OCR Word files in one routed storage domain. */

import { randomUUID } from 'node:crypto'
import { defineDomain, domainTable, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { OcrExtractRequest, OcrExtractResult } from '@deepseek-ai/dsh-ocr'
import { z } from 'zod'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { compileExampleWord, createExampleWord, exampleWordNeedsImages, normalizeExampleWord, type ExampleWordBlock } from './example-word.ts'
import type { TeacherExampleCorrectionSource, TeacherExampleHeadingSource } from './example-correction-agent.ts'
import { exampleHeadingEvidence, exampleWordNeedsHeading, removeExampleHeading, type ExampleHeadingRemoval } from './example-word-heading.ts'
import { exampleWordParagraphsSchema, readExampleWordEditor, saveExampleWordEditor } from './example-word-editor.ts'
import type {
  TeacherExample,
  TeacherExampleCatalog,
  TeacherExampleDocument,
  TeacherExampleDocumentKind,
  TeacherExampleDocumentRequest,
  TeacherExampleErrorCode,
  TeacherExampleExportRequest,
  TeacherExampleFile,
  TeacherExampleFileRequest,
  TeacherExampleId,
  TeacherExampleRequest,
  TeacherExampleResult,
  TeacherExampleSourceId,
  TeacherExampleUpdateRequest,
  TeacherExampleUploadRequest,
  TeacherExampleWordEditor,
  TeacherExampleWordSaveRequest,
  TeacherExampleWordSaved,
} from './example-types.ts'

const identity = <T extends string>() =>
  z
    .string()
    .min(1)
    .transform(value => value as T)
const tagName = z.string().trim().min(1).max(80)
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
const handwriting = z.array(z.object({ points: z.array(point).min(1).max(10_000) })).max(1_000)
const mediaType = z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
const fileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(value => !/[\\/\u0000-\u001f]/u.test(value))
const file = z.object({ name: fileName, mediaType: z.string(), contentBase64: z.string().min(1) })
const source = z.object({ id: identity<TeacherExampleSourceId>(), name: fileName, mediaType })
const documentSchema = z
  .object({
    source: source.nullable(),
    status: z.enum(['empty', 'pending', 'ready', 'error']),
    ocrError: z.string().nullable(),
    wordRevision: z.number().int().nonnegative(),
    sourceBase64: z.string().nullable(),
    word: file.nullable(),
  })
  .superRefine((record, ctx) => {
    const invalid =
      record.source === null
        ? record.status !== 'empty' || record.sourceBase64 !== null || record.word !== null
        : record.status === 'empty' || record.sourceBase64 === null
    if (
      invalid ||
      (record.status === 'ready') !== (record.word !== null) ||
      (record.status === 'error') !== (record.ocrError !== null)
    ) {
      ctx.addIssue({ code: 'custom', message: 'example source, OCR status, and Word file must agree' })
    }
  })
const recordSchema = z.object({
  id: identity<TeacherExampleId>(),
  number: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  tags: z.array(tagName).max(100),
  description: z.string().max(50_000),
  handwriting,
  revision: z.number().int().nonnegative(),
  documents: z.object({ question: documentSchema, explanation: documentSchema }),
})
type ExampleRecord = z.infer<typeof recordSchema>
type ExampleDocumentRecord = z.infer<typeof documentSchema>

/** Independent collection format; the shipped Web profile routes this domain to SQLite. */
export const teacherExampleDomainSpec = defineDomain({
  name: 'teacher_example_collection',
  version: 2,
  tables: {
    questions: domainTable<TeacherExampleId, ExampleRecord>(recordSchema),
    tags: domainTable<string, { name: string }>(z.object({ name: tagName })),
  },
})

const updateSchema = z.object({
  id: identity<TeacherExampleId>(),
  name: z.string().trim().min(1).max(120).optional(),
  tags: z.array(tagName).max(100).optional(),
  description: z.string().max(50_000).optional(),
  handwriting: handwriting.optional(),
})
const documentRequestSchema = z.object({
  id: identity<TeacherExampleId>(),
  document: z.enum(['question', 'explanation']),
})
const fileRequestSchema = documentRequestSchema.extend({ kind: z.enum(['source', 'word']) })
const uploadSchema = documentRequestSchema.extend({
  files: z.array(z.object({ name: fileName, mediaType, contentBase64: z.string().min(1) })),
})
const exportSchema = z.object({
  ids: z.array(identity<TeacherExampleId>()).min(1).refine(ids => new Set(ids).size === ids.length),
  layout: z.enum(['paired', 'grouped']),
})

class ExampleError extends Error {
  constructor(
    readonly code: TeacherExampleErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/** Host-owned collection operations; OCR never holds the metadata write queue. */
export class TeacherExampleCollection {
  private domain: Promise<Domain<typeof teacherExampleDomainSpec>> | undefined
  private tail: Promise<void> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private readonly recognition: Record<
    TeacherExampleDocumentKind,
    Map<TeacherExampleId, { readonly preserveText: boolean; readonly result: Promise<TeacherExampleResult<TeacherExample>> }>
  > = { question: new Map(), explanation: new Map() }

  /**
   * @param facility - configured domain facility.
   * @param maxFileBytes - live configured upload limit shared with workbench source documents.
   * @param extract - selected OCR provider with service-lifetime cancellation.
   * @param correct - visual proofreading of the complete OCR text against this source revision.
   * @param identifyHeading - independent visual identification of an exact removable Word prefix.
   */
  constructor(
    private readonly facility: DomainFacility,
    private readonly maxFileBytes: () => number,
    private readonly extract: (request: OcrExtractRequest, signal: AbortSignal) => Promise<OcrExtractResult>,
    private readonly correct: (request: TeacherExampleCorrectionSource, signal: AbortSignal) => Promise<TeacherExampleResult<string>>,
    private readonly identifyHeading: (
      request: TeacherExampleHeadingSource, signal: AbortSignal,
    ) => Promise<TeacherExampleResult<readonly ExampleHeadingRemoval[]>>,
  ) {}

  /**
   * List directory metadata without loading files into the browser.
   * @returns metadata and reusable tags, excluding all file bytes.
   */
  list(): Promise<TeacherExampleResult<TeacherExampleCatalog>> {
    return this.run(async () => {
      const domain = await this.open()
      return {
        questions: [...domain.table('questions').entries()]
          .map(([, record]) => metadata(record))
          .sort((a, b) => a.number - b.number),
        tags: [...domain.table('tags').entries()].map(([, tag]) => tag.name).sort((a, b) => a.localeCompare(b)),
      }
    })
  }

  /**
   * Create an independently saved question directory.
   * @returns a new empty question named with the next numeric directory index.
   */
  create(): Promise<TeacherExampleResult<TeacherExample>> {
    return this.enqueue(async () => {
      const table = (await this.open()).table('questions')
      const number = [...table.entries()].reduce((maximum, [, record]) => Math.max(maximum, record.number), 0) + 1
      const record: ExampleRecord = {
        id: randomUUID() as TeacherExampleId,
        number,
        name: String(number),
        tags: [],
        description: '',
        handwriting: [],
        documents: { question: emptyDocument(), explanation: emptyDocument() },
        revision: 0,
      }
      await table.put(record.id, record)
      return metadata(record)
    })
  }

  /**
   * Save only submitted fields against the current row.
   * @param request - identity and edited fields; newly selected tags must exist in the catalog.
   * @returns the committed question.
   */
  update(request: TeacherExampleUpdateRequest): Promise<TeacherExampleResult<TeacherExample>> {
    return this.enqueue(async () => {
      const parsed = parse(updateSchema, request)
      const domain = await this.open()
      const current = this.requireRecord(domain, parsed.id)
      const tags = parsed.tags === undefined ? current.tags : [...new Set(parsed.tags)]
      if (tags.some(tag => !current.tags.includes(tag) && domain.table('tags').get(tag) === undefined))
        throw new ExampleError('invalid-request', 'Unknown example tag')
      const next = recordSchema.parse({ ...current, ...parsed, tags, revision: current.revision + 1 })
      await domain.table('questions').put(next.id, next)
      return metadata(next)
    })
  }

  /**
   * Save a reusable tag in the collection catalog.
   * @param name - reusable tag name; adding an existing name is idempotent.
   * @returns the normalized tag name after persistence.
   */
  addTag(name: string): Promise<TeacherExampleResult<string>> {
    return this.enqueue(async () => {
      const normalized = parse(tagName, name)
      await (await this.open()).table('tags').put(normalized, { name: normalized })
      return normalized
    })
  }

  /**
   * Remove a reusable preset while retaining tags already assigned to questions.
   * @param name - preset name; repeated deletion is idempotent.
   * @returns the normalized name after persistence.
   */
  deleteTag(name: string): Promise<TeacherExampleResult<string>> {
    return this.enqueue(async () => {
      const normalized = parse(tagName, name)
      await (await this.open()).table('tags').delete(normalized)
      return normalized
    })
  }

  /**
   * Delete the question and its retained file payloads together.
   * @param request - question to delete, including its original and Word bytes.
   * @returns the deleted identity; repeat deletion is idempotent.
   */
  delete(request: TeacherExampleRequest): Promise<TeacherExampleResult<TeacherExampleId>> {
    return this.enqueue(async () => {
      await (await this.open()).table('questions').delete(request.id)
      return request.id
    })
  }

  /**
   * Persist one continuous original before OCR; invalid fragments leave the previous source intact.
   * @param request - ordered images/PDFs belonging to one question or explanation; multiple files become one PDF.
   * @returns the committed question awaiting recognition.
   */
  upload(request: TeacherExampleUploadRequest): Promise<TeacherExampleResult<TeacherExample>> {
    return this.enqueue(async () => {
      const parsed = parse(uploadSchema, request)
      const [first] = parsed.files
      if (first === undefined) throw new ExampleError('invalid-request', 'Upload at least one source file')
      const maxBytes = this.maxFileBytes()
      let totalBytes = 0
      for (const file of parsed.files) {
        totalBytes += validateUpload(file, maxBytes)
        if (totalBytes > maxBytes) throw new ExampleError('file-too-large', 'The complete source set exceeds the upload limit')
      }
      const domain = await this.open()
      const current = this.requireRecord(domain, parsed.id)
      const file = parsed.files.length === 1 ? first : await mergeSources(
        parsed.files, `${current.name.replace(/[\\/\u0000-\u001f]/gu, '_')}-${parsed.document === 'question' ? '原件' : '解析原件'}.pdf`, maxBytes,
      )
      const next = replaceDocument(current, parsed.document, {
        ...current.documents[parsed.document],
        source: { id: randomUUID() as TeacherExampleSourceId, name: file.name, mediaType: file.mediaType },
        sourceBase64: file.contentBase64,
        word: null,
        status: 'pending',
        ocrError: null,
      })
      await domain.table('questions').put(next.id, next)
      return metadata(next)
    })
  }

  /**
   * Recognize and visually proofread the current source before replacing its Word document.
   * @param request - question or explanation whose current source needs OCR.
   * @returns the persisted Word result; failures retain an existing Word, and late results cannot restore replaced or deleted sources.
   */
  recognize(request: TeacherExampleDocumentRequest): Promise<TeacherExampleResult<TeacherExample>> {
    return this.run(async () => {
      const parsed = parse(documentRequestSchema, request)
      return this.recognizeDocument(parsed, false)
    })
  }

  /**
   * Read one saved file, restoring missing illustrations and identifying unreviewed headings before normalizing typography.
   * @param request - selected original or generated Word file.
   * @returns file bytes only for this question, with Word filenames derived from its current directory name.
   */
  readFile(request: TeacherExampleFileRequest): Promise<TeacherExampleResult<TeacherExampleFile>> {
    return this.run(async () => {
      const parsed = parse(fileRequestSchema, request)
      if (parsed.kind === 'word') await this.prepareWord(parsed)
      const result = await this.enqueue(async () => {
        const domain = await this.open()
        const record = this.requireRecord(domain, parsed.id)
        const selected = record.documents[parsed.document]
        if (parsed.kind === 'word' && selected.word !== null) {
          const rebuilt = await normalizeExampleWord(Buffer.from(selected.word.contentBase64, 'base64'))
          const word = {
            ...selected.word,
            name: exampleWordFileName(record.name, parsed.document),
            contentBase64: rebuilt?.toString('base64') ?? selected.word.contentBase64,
          }
          if (rebuilt === undefined) return word
          await domain.table('questions').put(record.id, replaceDocument(record, parsed.document, {
            ...selected,
            word,
            wordRevision: selected.wordRevision + 1,
          }))
          return word
        }
        if (parsed.kind === 'source' && selected.source !== null && selected.sourceBase64 !== null) {
          return { name: selected.source.name, mediaType: selected.source.mediaType, contentBase64: selected.sourceBase64 }
        }
        throw new ExampleError('not-found', 'Example file is unavailable')
      })
      if (!result.ok) throw new ExampleError(result.error.code, result.error.message)
      return result.value
    })
  }

  /**
   * Load the saved Word revision for editing after its normal source repair and heading review.
   * @param request - selected question or explanation.
   * @returns editable paragraphs and object previews tied to the current source and Word revisions.
   */
  readEditor(request: TeacherExampleDocumentRequest): Promise<TeacherExampleResult<TeacherExampleWordEditor>> {
    return this.run(async () => {
      const file = await this.readFile({ ...request, kind: 'word' })
      if (!file.ok) throw new ExampleError(file.error.code, file.error.message)
      const result = await this.enqueue(async () => {
        const domain = await this.open()
        const selected = this.requireRecord(domain, request.id).documents[request.document]
        if (selected.source === null || selected.word === null) throw new ExampleError('not-found', 'Example Word is unavailable')
        return { ...readExampleWordEditor(Buffer.from(selected.word.contentBase64, 'base64')), sourceId: selected.source.id, wordRevision: selected.wordRevision }
      })
      if (!result.ok) throw new ExampleError(result.error.code, result.error.message)
      return result.value
    })
  }

  /**
   * Commit explicit Word edits while preserving other document and metadata changes.
   * @param request - structured paragraphs and the source/Word revisions loaded by the editor.
   * @returns saved question metadata and the matching editor revision, or a conflict without changing the current Word.
   */
  saveEditor(request: TeacherExampleWordSaveRequest): Promise<TeacherExampleResult<TeacherExampleWordSaved>> {
    return this.enqueue(async () => {
      if (Buffer.byteLength(JSON.stringify(request)) > this.maxFileBytes()) throw new ExampleError('file-too-large', 'Word edits exceed the document byte limit')
      const parsed = parse(z.object({ id: identity<TeacherExampleId>(), document: z.enum(['question', 'explanation']), sourceId: identity<TeacherExampleSourceId>(), wordRevision: z.number().int().nonnegative(), paragraphs: exampleWordParagraphsSchema }).strict(), request)
      const domain = await this.open()
      const record = this.requireRecord(domain, parsed.id)
      const selected = record.documents[parsed.document]
      if (selected.source?.id !== parsed.sourceId || selected.wordRevision !== parsed.wordRevision) throw new ExampleError('word-changed', 'The Word document changed after this editor was opened')
      if (selected.word === null) throw new ExampleError('not-found', 'Example Word is unavailable')
      let bytes: Buffer
      try {
        bytes = saveExampleWordEditor(Buffer.from(selected.word.contentBase64, 'base64'), parsed.paragraphs)
      } catch {
        throw new ExampleError('invalid-request', 'The Word edit contains unsupported content or an invalid formula')
      }
      if (bytes.length > this.maxFileBytes()) throw new ExampleError('file-too-large', 'Edited Word exceeds the document byte limit')
      const next = replaceDocument(record, parsed.document, { ...selected, word: { ...selected.word, contentBase64: bytes.toString('base64') }, wordRevision: selected.wordRevision + 1 })
      const editor = {
        ...readExampleWordEditor(bytes), sourceId: parsed.sourceId, wordRevision: next.documents[parsed.document].wordRevision,
      }
      await domain.table('questions').put(record.id, next)
      return { question: metadata(next), editor }
    })
  }

  /**
   * Restore illustrations and identify unreviewed headings, then compile selected questions from a committed snapshot.
   * @param request - unique question identities and explanation placement; only original question and explanation content is included.
   * @returns a Word download; missing questions or unfinished uploaded documents fail the whole export.
   */
  exportWord(request: TeacherExampleExportRequest): Promise<TeacherExampleResult<TeacherExampleFile>> {
    return this.run(async () => {
      const parsed = parse(exportSchema, request)
      for (const id of parsed.ids) {
        for (const document of ['question', 'explanation'] as const) await this.prepareWord({ id, document })
      }
      const selected = await this.enqueue(async () => {
        const domain = await this.open()
        return parsed.ids.map(id => this.requireRecord(domain, id))
      })
      if (!selected.ok) throw new ExampleError(selected.error.code, selected.error.message)
      const questions: ExampleWordBlock[] = []
      const explanations: ExampleWordBlock[] = []
      const paired: ExampleWordBlock[] = []
      for (const record of selected.value) {
        for (const documentKind of ['question', 'explanation'] as const) {
          const document = record.documents[documentKind]
          if (documentKind === 'explanation' && document.source === null) continue
          if (document.status !== 'ready' || document.word === null) {
            throw new ExampleError('export-not-ready', 'Selected question or explanation needs a completed Word document')
          }
          const block: ExampleWordBlock = {
            bytes: Buffer.from(document.word.contentBase64, 'base64'),
            blankLinesBefore: documentKind === 'question' && questions.length > 0,
          }
          paired.push(block)
          if (documentKind === 'question') questions.push(block)
          else explanations.push(block)
        }
      }
      const blocks = parsed.layout === 'paired' ? paired : [
        ...questions,
        ...explanations.map((block, index) => ({ ...block, pageBreakBefore: index === 0, blankLinesBefore: index > 0 })),
      ]
      const bytes = await compileExampleWord(blocks)
      return {
        name: 'examples.docx',
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBase64: bytes.toString('base64'),
      }
    })
  }

  /** Abort OCR, drain accepted work, and close the collection domain. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.all(Object.values(this.recognition).flatMap(operations => [...operations.values()].map(operation => operation.result)))
    await this.tail
    if (this.domain !== undefined) await (await this.domain).close()
  }

  private async recognizeDocument(request: TeacherExampleDocumentRequest, preserveText: boolean): Promise<TeacherExample> {
    const operations = this.recognition[request.document]
    let operation = operations.get(request.id)
    if (operation === undefined) {
      const result = this.run(() => this.recognizeSource(request, preserveText))
      operation = { preserveText, result }
      operations.set(request.id, operation)
      void result.finally(() => { operations.delete(request.id) })
    }
    const result = await operation.result
    if (!result.ok) throw new ExampleError(result.error.code, result.error.message)
    if (!preserveText && operation.preserveText) return this.recognizeDocument(request, false)
    return result.value
  }

  private async recognizeSource(
    { id, document: documentKind }: TeacherExampleDocumentRequest,
    preserveText: boolean,
  ): Promise<TeacherExample> {
    const domain = await this.open()
    const question = this.requireRecord(domain, id)
    const original = question.documents[documentKind]
    if (original.source === null || original.sourceBase64 === null)
      throw new ExampleError('not-found', 'Upload an example source first')
    const sourceId = original.source.id
    const savedWord = original.word === null ? undefined : Buffer.from(original.word.contentBase64, 'base64')
    if (preserveText && (savedWord === undefined || (!exampleWordNeedsImages(savedWord) && !exampleWordNeedsHeading(savedWord)))) {
      return metadata(question)
    }
    let word: TeacherExampleFile | null = null
    let failure: ExampleError | null = null
    try {
      const source: OcrExtractRequest = {
        name: original.source.name,
        mediaType: original.source.mediaType,
        contentBase64: original.sourceBase64,
        includeImages: true,
      }
      let bytes: Buffer | undefined = savedWord
      if (!preserveText || (savedWord !== undefined && exampleWordNeedsImages(savedWord))) {
        const extracted = await this.extract(source, this.lifetime.signal)
        if (!extracted.ok)
          throw new ExampleError(
            extracted.error.code === 'provider-unavailable' ? 'ocr-unavailable' : 'ocr-failed',
            extracted.error.code,
          )
        if (extracted.value.truncated) throw new ExampleError('ocr-truncated', 'OCR output was truncated')
        if (extracted.value.markdown.trim() === '') throw new ExampleError('ocr-failed', 'OCR returned no text')
        const images = extracted.value.images ?? []
        if (preserveText && savedWord !== undefined) bytes = await compileExampleWord([{ bytes: savedWord, images }])
        else {
          const corrected = await this.correct({ source, markdown: extracted.value.markdown, document: documentKind }, this.lifetime.signal)
          if (!corrected.ok) throw new ExampleError(corrected.error.code, corrected.error.message)
          bytes = await createExampleWord(corrected.value, images)
        }
      }
      if (bytes === undefined) throw new ExampleError('not-found', 'Example Word file is unavailable')
      bytes = await normalizeExampleWord(bytes) ?? bytes
      if (exampleWordNeedsHeading(bytes)) {
        const heading = await this.identifyHeading(
          { source, document: documentKind, ...exampleHeadingEvidence(bytes) }, this.lifetime.signal,
        )
        if (!heading.ok) throw new ExampleError(heading.error.code, heading.error.message)
        try {
          bytes = removeExampleHeading(bytes, heading.value)
        } catch {
          throw new ExampleError('correction-invalid', 'The identified heading does not preserve the remaining Word content')
        }
      }
      word = {
        name: exampleWordFileName(question.name, documentKind),
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBase64: bytes.toString('base64'),
      }
    } catch (error) {
      failure = error instanceof ExampleError ? error : new ExampleError('ocr-failed', 'OCR or Word conversion failed')
    }
    if (savedWord !== undefined && failure !== null) throw failure
    const result = await this.enqueue(async () => {
      const current = this.requireRecord(domain, id)
      const selected = current.documents[documentKind]
      if (selected.source?.id !== sourceId || selected.wordRevision !== original.wordRevision)
        throw new ExampleError('source-changed', 'Example source or Word revision changed during recognition')
      const next = replaceDocument(current, documentKind, {
        ...selected,
        word,
        status: word === null ? 'error' : 'ready',
        ocrError: failure?.code ?? null,
        wordRevision: selected.wordRevision + 1,
      })
      await domain.table('questions').put(id, next)
      return metadata(next)
    })
    if (!result.ok) throw new ExampleError(result.error.code, result.error.message)
    return result.value
  }

  private async prepareWord(request: TeacherExampleDocumentRequest): Promise<void> {
    const needed = await this.enqueue(async () => {
      const domain = await this.open()
      const selected = this.requireRecord(domain, request.id).documents[request.document]
      if (selected.word === null) return false
      const bytes = Buffer.from(selected.word.contentBase64, 'base64')
      return exampleWordNeedsImages(bytes) || exampleWordNeedsHeading(bytes)
    })
    if (!needed.ok) throw new ExampleError(needed.error.code, needed.error.message)
    if (!needed.value) return
    await this.recognizeDocument(request, true)
  }

  private open(): Promise<Domain<typeof teacherExampleDomainSpec>> {
    this.lifetime.signal.throwIfAborted()
    this.domain ??= this.facility.open(teacherExampleDomainSpec).catch((error: unknown) => {
      this.domain = undefined
      throw error
    })
    return this.domain
  }

  private requireRecord(domain: Domain<typeof teacherExampleDomainSpec>, id: TeacherExampleId): ExampleRecord {
    const record = domain.table('questions').get(id)
    if (record === undefined) throw new ExampleError('not-found', 'Example question does not exist')
    return record
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<TeacherExampleResult<T>> {
    const queued = this.tail.then(() => this.run(operation))
    this.tail = queued.then(() => {})
    return queued
  }

  private async run<T>(operation: () => Promise<T>): Promise<TeacherExampleResult<T>> {
    try {
      if (this.lifetime.signal.aborted) throw new ExampleError('disposed', 'Example collection is closed')
      return { ok: true, value: await operation() }
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof ExampleError
            ? { code: error.code, message: error.message }
            : { code: 'storage-failure', message: 'Example collection operation failed' },
      }
    }
  }
}

function exampleWordFileName(name: string, documentKind: TeacherExampleDocumentKind): string {
  return `${name.replace(/[\\/\u0000-\u001f]/gu, '_')}${documentKind === 'explanation' ? '-解析' : ''}.docx`
}

function emptyDocument(): ExampleDocumentRecord {
  return { source: null, sourceBase64: null, word: null, status: 'empty', ocrError: null, wordRevision: 0 }
}

function replaceDocument(
  record: ExampleRecord,
  documentKind: TeacherExampleDocumentKind,
  selected: ExampleDocumentRecord,
): ExampleRecord {
  return { ...record, documents: { ...record.documents, [documentKind]: selected }, revision: record.revision + 1 }
}

function documentMetadata({ sourceBase64: _sourceBase64, word: _word, ...record }: ExampleDocumentRecord): TeacherExampleDocument {
  return record
}

function metadata(record: ExampleRecord): TeacherExample {
  return structuredClone({
    ...record,
    documents: {
      question: documentMetadata(record.documents.question),
      explanation: documentMetadata(record.documents.explanation),
    },
  })
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new ExampleError('invalid-request', 'Invalid example collection fields')
  return parsed.data
}

function validateUpload(upload: TeacherExampleUploadRequest['files'][number], maxBytes: number): number {
  if (upload.contentBase64.length > Math.ceil(maxBytes / 3) * 4)
    throw new ExampleError('file-too-large', 'Example source exceeds the upload limit')
  const bytes = Buffer.from(upload.contentBase64, 'base64')
  if (bytes.length > maxBytes) throw new ExampleError('file-too-large', 'Example source exceeds the upload limit')
  if (bytes.length === 0 || bytes.toString('base64') !== upload.contentBase64)
    throw new ExampleError('invalid-request', 'Example source must use canonical base64')
  const valid =
    upload.mediaType === 'application/pdf'
      ? bytes.subarray(0, 5).toString() === '%PDF-'
      : upload.mediaType === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : upload.mediaType === 'image/jpeg'
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (!valid) throw new ExampleError('invalid-request', 'Example source bytes do not match the declared file type')
  return bytes.length
}

/** Copy PDF pages and embed complete image pixels in upload order without inserting headings or margins. */
async function mergeSources(
  files: TeacherExampleUploadRequest['files'],
  name: string,
  maxBytes: number,
): Promise<TeacherExampleUploadRequest['files'][number]> {
  let bytes: Uint8Array
  try {
    const merged = await PDFDocument.create()
    for (const file of files) {
      const original = Buffer.from(file.contentBase64, 'base64')
      if (file.mediaType === 'application/pdf') {
        const pdf = await PDFDocument.load(original)
        if (pdf.getPageCount() === 0) throw new Error('Source PDF has no pages')
        for (const page of await merged.copyPages(pdf, pdf.getPageIndices())) merged.addPage(page)
      } else {
        const image = await merged.embedPng(await sharp(original).rotate().png().toBuffer())
        const page = merged.addPage([image.width, image.height])
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
      }
    }
    bytes = await merged.save()
  } catch {
    throw new ExampleError('invalid-request', 'A source image or PDF could not be combined')
  }
  if (bytes.length > maxBytes) throw new ExampleError('file-too-large', 'The combined original exceeds the upload limit')
  return { name, mediaType: 'application/pdf', contentBase64: Buffer.from(bytes).toString('base64') }
}
