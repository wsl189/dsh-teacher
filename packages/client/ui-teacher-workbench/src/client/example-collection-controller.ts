/** React-free collection catalog, durable commands, and drafts retained across module navigation. */

import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TeacherExample,
  TeacherExampleCatalog,
  TeacherExampleDocumentKind,
  TeacherExampleDocumentRequest,
  TeacherExampleExportRequest,
  TeacherExampleFile,
  TeacherExampleFileRequest,
  TeacherExampleId,
  TeacherExampleRequest,
  TeacherExampleResult,
  TeacherExampleStroke,
  TeacherExampleUpdateRequest,
  TeacherExampleUploadRequest,
  TeacherExampleWordEditor,
  TeacherExampleWordSaveRequest,
  TeacherExampleWordSaved,
} from '@deepseek-ai/dsh-api-remotes/client'
import { bytesToBase64 } from './document-bytes.ts'

/** Generated Remote methods consumed by the collection. */
export interface ExampleCollectionRemote {
  readExampleWordEditor: (request: TeacherExampleDocumentRequest) => Promise<RemoteResult<TeacherExampleResult<TeacherExampleWordEditor>>>
  saveExampleWordEditor: (request: TeacherExampleWordSaveRequest) => Promise<RemoteResult<TeacherExampleResult<TeacherExampleWordSaved>>>
  listExamples: (request: Record<never, never>) => Promise<RemoteResult<TeacherExampleResult<TeacherExampleCatalog>>>
  createExample: (request: Record<never, never>) => Promise<RemoteResult<TeacherExampleResult<TeacherExample>>>
  updateExample: (request: TeacherExampleUpdateRequest) => Promise<RemoteResult<TeacherExampleResult<TeacherExample>>>
  addExampleTag: (request: { name: string }) => Promise<RemoteResult<TeacherExampleResult<string>>>
  deleteExampleTag: (request: { name: string }) => Promise<RemoteResult<TeacherExampleResult<string>>>
  deleteExample: (request: TeacherExampleRequest) => Promise<RemoteResult<TeacherExampleResult<TeacherExampleId>>>
  uploadExample: (request: TeacherExampleUploadRequest) => Promise<RemoteResult<TeacherExampleResult<TeacherExample>>>
  recognizeExample: (request: TeacherExampleDocumentRequest) => Promise<RemoteResult<TeacherExampleResult<TeacherExample>>>
  exportExamplesWord: (request: TeacherExampleExportRequest) => Promise<RemoteResult<TeacherExampleResult<TeacherExampleFile>>>
  readExampleFile: (
    request: TeacherExampleFileRequest,
  ) => Promise<RemoteResult<TeacherExampleResult<TeacherExampleFile>>>
}

/** Unsaved description fields, kept until their matching write succeeds. */
export interface ExampleDraft {
  readonly description: string
  readonly handwriting: readonly TeacherExampleStroke[]
}

/** Stable observable snapshot shared by the module and its search drawer. */
export interface ExampleCollectionSnapshot {
  readonly loaded: boolean
  readonly questions: readonly TeacherExample[]
  readonly tags: readonly string[]
  readonly selectedId: TeacherExampleId | null
  readonly drafts: Readonly<Record<string, ExampleDraft>>
  readonly busy: Readonly<Record<TeacherExampleDocumentKind, Readonly<Record<string, 'upload' | 'ocr'>>>>
  readonly pending: number
  readonly error: string | null
}

/** Plain callbacks injected into the collection's presentation. */
export interface ExampleCollectionCommands {
  readEditor: (request: TeacherExampleDocumentRequest) => Promise<TeacherExampleWordEditor>
  saveEditor: (request: TeacherExampleWordSaveRequest) => Promise<TeacherExampleWordEditor>
  refresh: () => Promise<void>
  create: () => Promise<void>
  select: (id: TeacherExampleId) => void
  update: (request: TeacherExampleUpdateRequest) => Promise<boolean>
  addTag: (name: string) => Promise<string | null>
  deleteTag: (name: string) => Promise<void>
  delete: (id: TeacherExampleId) => Promise<void>
  upload: (id: TeacherExampleId, documentKind: TeacherExampleDocumentKind, files: readonly File[]) => Promise<void>
  recognize: (id: TeacherExampleId, documentKind: TeacherExampleDocumentKind) => Promise<void>
  exportWord: (request: TeacherExampleExportRequest) => Promise<TeacherExampleFile>
  readFile: (request: TeacherExampleFileRequest) => Promise<TeacherExampleFile>
  editDraft: (id: TeacherExampleId, patch: Partial<ExampleDraft>) => void
  saveDraft: (id: TeacherExampleId) => Promise<void>
}

/** Host-backed object layer; OCR continues while another directory or module is visible. */
export class ExampleCollectionController implements HostObservable<ExampleCollectionSnapshot> {
  private snapshot: ExampleCollectionSnapshot = {
    loaded: false,
    questions: [],
    tags: [],
    selectedId: null,
    drafts: {},
    busy: { question: {}, explanation: {} },
    pending: 0,
    error: null,
  }
  private readonly listeners = new Set<() => void>()
  private readonly draftTimers = new Map<TeacherExampleId, ReturnType<typeof setTimeout>>()
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  /** @param remote - generated teacher workbench namespace. */
  constructor(private readonly remote: ExampleCollectionRemote) {}

  /** @returns the current immutable collection snapshot. */
  getSnapshot = (): ExampleCollectionSnapshot => this.snapshot

  /**
   * @param listener - observer called after snapshot replacement.
   * @returns observer disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Callbacks stay stable for the plugin's lifetime. */
  readonly commands: ExampleCollectionCommands = {
    refresh: () =>
      this.enqueue(async () => {
        const catalog = await unwrap(this.remote.listExamples({}))
        this.publish({
          ...catalog,
          loaded: true,
          selectedId: catalog.questions.some(row => row.id === this.snapshot.selectedId)
            ? this.snapshot.selectedId
            : (catalog.questions[0]?.id ?? null),
        })
      }),
    create: () =>
      this.enqueue(async () => {
        const record = await unwrap(this.remote.createExample({}))
        this.publish({ questions: [...this.snapshot.questions, record], selectedId: record.id })
      }),
    select: (id) => {
      const previous = this.snapshot.selectedId
      if (previous !== null && previous !== id) void this.commands.saveDraft(previous)
      this.publish({ selectedId: id })
    },
    update: async (request) => {
      const saved = await this.enqueue(async () => {
        this.accept(await unwrap(this.remote.updateExample(request)))
        return true
      })
      return saved === true
    },
    addTag: async (name) => {
      const tag = await this.enqueue(async () => {
        const tag = await unwrap(this.remote.addExampleTag({ name }))
        this.publish({ tags: [...new Set([...this.snapshot.tags, tag])].sort((a, b) => a.localeCompare(b)) })
        return tag
      })
      return tag ?? null
    },
    deleteTag: name =>
      this.enqueue(async () => {
        const deleted = await unwrap(this.remote.deleteExampleTag({ name }))
        this.publish({ tags: this.snapshot.tags.filter(tag => tag !== deleted) })
      }),
    delete: id =>
      this.enqueue(async () => {
        await unwrap(this.remote.deleteExample({ id }))
        this.clearDraftTimer(id)
        const questions = this.snapshot.questions.filter(row => row.id !== id)
        const drafts = { ...this.snapshot.drafts }
        Reflect.deleteProperty(drafts, id)
        this.publish({
          questions,
          drafts,
          selectedId: this.snapshot.selectedId === id ? (questions[0]?.id ?? null) : this.snapshot.selectedId,
        })
      }),
    upload: async (id, documentKind, files) => {
      if (this.snapshot.busy[documentKind][id] !== undefined) return
      this.setBusy(id, documentKind, 'upload')
      const saved = await this.enqueue(async () => {
        if (files.length === 0) throw new CollectionFailure('invalid-request')
        const sources = await Promise.all(files.map(async (file) => {
          const mediaType = file.type || mediaTypeFromName(file.name)
          if (!isMediaType(mediaType)) throw new CollectionFailure('invalid-request')
          return { name: file.name, mediaType, contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }
        }))
        const record = await unwrap(
          this.remote.uploadExample({
            id,
            document: documentKind,
            files: sources,
          }),
        )
        this.accept(record)
        return true
      })
      this.setBusy(id, documentKind, undefined)
      if (saved) await this.commands.recognize(id, documentKind)
    },
    recognize: async (id, documentKind) => {
      if (this.snapshot.busy[documentKind][id] !== undefined) return
      this.setBusy(id, documentKind, 'ocr')
      try {
        this.accept(await unwrap(this.remote.recognizeExample({ id, document: documentKind })))
      } catch (error) {
        if (this.snapshot.questions.some(row => row.id === id)) this.publish({ error: failureCode(error) })
      } finally {
        this.setBusy(id, documentKind, undefined)
      }
    },
    exportWord: request => unwrap(this.remote.exportExamplesWord(request)),
    readFile: request => unwrap(this.remote.readExampleFile(request)),
    readEditor: request => unwrap(this.remote.readExampleWordEditor(request)),
    saveEditor: async (request) => {
      const record = await unwrap(this.remote.saveExampleWordEditor(request))
      this.accept(record.question)
      return record.editor
    },
    editDraft: (id, patch) => {
      const question = this.snapshot.questions.find(row => row.id === id)
      if (question === undefined) return
      const previous = this.snapshot.drafts[id] ?? {
        description: question.description,
        handwriting: question.handwriting,
      }
      this.publish({ drafts: { ...this.snapshot.drafts, [id]: { ...previous, ...patch } } })
      this.clearDraftTimer(id)
      this.draftTimers.set(
        id,
        setTimeout(() => {
          void this.commands.saveDraft(id)
        }, 500),
      )
    },
    saveDraft: (id) => {
      this.clearDraftTimer(id)
      return this.enqueue(async () => {
        const draft = this.snapshot.drafts[id]
        if (draft === undefined) return
        this.accept(await unwrap(this.remote.updateExample({ id, ...draft })))
        if (this.snapshot.drafts[id] === draft) {
          const drafts = { ...this.snapshot.drafts }
          Reflect.deleteProperty(drafts, id)
          this.publish({ drafts })
        }
      })
    },
  }

  /** Flush description drafts before releasing observers and queued operations. */
  async dispose(): Promise<void> {
    await Promise.all(Object.keys(this.snapshot.drafts).map(id => this.commands.saveDraft(id as TeacherExampleId)))
    this.disposed = true
    for (const timer of this.draftTimers.values()) clearTimeout(timer)
    this.draftTimers.clear()
    this.listeners.clear()
    await this.tail
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (this.disposed) return Promise.resolve(undefined)
    this.publish({ pending: this.snapshot.pending + 1, error: null })
    const queued = this.tail
      .then(operation)
      .catch((error: unknown) => {
        this.publish({ error: failureCode(error) })
        return undefined
      })
      .finally(() => {
        this.publish({ pending: this.snapshot.pending - 1 })
      })
    this.tail = queued.then(() => {})
    return queued
  }

  private accept(record: TeacherExample): void {
    this.publish({
      questions: this.snapshot.questions.map(current =>
        current.id === record.id && current.revision <= record.revision ? record : current,
      ),
    })
  }

  private clearDraftTimer(id: TeacherExampleId): void {
    const timer = this.draftTimers.get(id)
    if (timer !== undefined) clearTimeout(timer)
    this.draftTimers.delete(id)
  }

  private setBusy(id: TeacherExampleId, documentKind: TeacherExampleDocumentKind, status: 'upload' | 'ocr' | undefined): void {
    const busy = { ...this.snapshot.busy[documentKind] }
    if (status === undefined) Reflect.deleteProperty(busy, id)
    else busy[id] = status
    this.publish({ busy: { ...this.snapshot.busy, [documentKind]: busy } })
  }

  private publish(patch: Partial<ExampleCollectionSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    notifySubscribers(this.listeners, 'example-collection')
  }
}

class CollectionFailure extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

async function unwrap<T>(promise: Promise<RemoteResult<TeacherExampleResult<T>>>): Promise<T> {
  const carried = await promise
  if (!carried.ok) throw new CollectionFailure('transport')
  if (!carried.value.ok) throw new CollectionFailure(carried.value.error.code)
  return carried.value.value
}

function failureCode(error: unknown): string {
  return error instanceof CollectionFailure ? error.code : 'transport'
}

function isMediaType(value: string): value is TeacherExampleUploadRequest['files'][number]['mediaType'] {
  return ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(value)
}

function mediaTypeFromName(name: string): string {
  const extension = name.split('.').at(-1)?.toLowerCase()
  return extension === 'pdf'
    ? 'application/pdf'
    : extension === 'png'
      ? 'image/png'
      : extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : extension === 'webp'
          ? 'image/webp'
          : ''
}
