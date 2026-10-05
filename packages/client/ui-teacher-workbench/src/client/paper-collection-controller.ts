/** React-free paper catalog, commands, and descriptions retained across navigation. */

import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TeacherPaper, TeacherPaperCatalog, TeacherPaperFile, TeacherPaperFileRequest, TeacherPaperFormat,
  TeacherPaperId, TeacherPaperRequest, TeacherPaperResult, TeacherPaperUpdateRequest, TeacherPaperUploadRequest,
} from '@deepseek-ai/dsh-api-remotes/client'
import { bytesToBase64 } from './document-bytes.ts'

/** Generated Remote methods consumed by the paper collection. */
export interface PaperCollectionRemote {
  listPapers: (request: Record<never, never>) => Promise<RemoteResult<TeacherPaperResult<TeacherPaperCatalog>>>
  createPaper: (request: Record<never, never>) => Promise<RemoteResult<TeacherPaperResult<TeacherPaper>>>
  updatePaper: (request: TeacherPaperUpdateRequest) => Promise<RemoteResult<TeacherPaperResult<TeacherPaper>>>
  addPaperTag: (request: { name: string }) => Promise<RemoteResult<TeacherPaperResult<string>>>
  deletePaperTag: (request: { name: string }) => Promise<RemoteResult<TeacherPaperResult<string>>>
  deletePaper: (request: TeacherPaperRequest) => Promise<RemoteResult<TeacherPaperResult<TeacherPaperId>>>
  uploadPaper: (request: TeacherPaperUploadRequest) => Promise<RemoteResult<TeacherPaperResult<TeacherPaper>>>
  readPaperFile: (request: TeacherPaperFileRequest) => Promise<RemoteResult<TeacherPaperResult<TeacherPaperFile>>>
}

/** Stable metadata-only snapshot shared by the directory, editor, and search results. */
export interface PaperCollectionSnapshot {
  readonly loaded: boolean
  readonly papers: readonly TeacherPaper[]
  readonly tags: readonly string[]
  readonly selectedId: TeacherPaperId | null
  readonly drafts: Readonly<Record<string, string>>
  readonly pending: number
  readonly error: string | null
}

/** Stable plain callbacks for collection presentation. */
export interface PaperCollectionCommands {
  refresh: () => Promise<void>
  create: () => Promise<void>
  select: (id: TeacherPaperId) => void
  update: (request: TeacherPaperUpdateRequest) => Promise<boolean>
  addTag: (name: string) => Promise<string | null>
  deleteTag: (name: string) => Promise<void>
  delete: (id: TeacherPaperId) => Promise<void>
  upload: (id: TeacherPaperId, files: readonly File[]) => Promise<void>
  readFile: (request: TeacherPaperFileRequest) => Promise<TeacherPaperFile>
  editDraft: (id: TeacherPaperId, description: string) => void
  saveDraft: (id: TeacherPaperId) => Promise<void>
}

/** Writes settle in order; file reads and preview generation do not block description saves. */
export class PaperCollectionController implements HostObservable<PaperCollectionSnapshot> {
  private snapshot: PaperCollectionSnapshot = {
    loaded: false, papers: [], tags: [], selectedId: null, drafts: {}, pending: 0, error: null,
  }
  private readonly listeners = new Set<() => void>()
  private readonly timers = new Map<TeacherPaperId, ReturnType<typeof setTimeout>>()
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  /** @param remote - generated paper collection methods. */
  constructor(private readonly remote: PaperCollectionRemote) {}

  /** @returns the current immutable catalog and drafts. */
  getSnapshot = (): PaperCollectionSnapshot => this.snapshot

  /**
   * @param listener - observer called after snapshot replacement.
   * @returns observer disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Stable callbacks retain unsaved descriptions until their matching write succeeds. */
  readonly commands: PaperCollectionCommands = {
    refresh: () => this.enqueue(async () => {
      const catalog = await unwrap(this.remote.listPapers({}))
      this.publish({
        ...catalog, loaded: true,
        selectedId: catalog.papers.some(row => row.id === this.snapshot.selectedId)
          ? this.snapshot.selectedId : (catalog.papers[0]?.id ?? null),
      })
    }),
    create: () => this.enqueue(async () => {
      const row = await unwrap(this.remote.createPaper({}))
      this.publish({ papers: [...this.snapshot.papers, row], selectedId: row.id })
    }),
    select: (id) => {
      const previous = this.snapshot.selectedId
      if (previous !== null && previous !== id) void this.commands.saveDraft(previous)
      this.publish({ selectedId: id })
    },
    update: async request => (await this.enqueue(async () => {
      this.accept(await unwrap(this.remote.updatePaper(request)))
      return true
    })) === true,
    addTag: async name => (await this.enqueue(async () => {
      const tag = await unwrap(this.remote.addPaperTag({ name }))
      this.publish({ tags: [...new Set([...this.snapshot.tags, tag])].sort((a, b) => a.localeCompare(b)) })
      return tag
    })) ?? null,
    deleteTag: name => this.enqueue(async () => {
      const deleted = await unwrap(this.remote.deletePaperTag({ name }))
      this.publish({ tags: this.snapshot.tags.filter(tag => tag !== deleted) })
    }),
    delete: id => this.enqueue(async () => {
      await unwrap(this.remote.deletePaper({ id }))
      this.clearTimer(id)
      const papers = this.snapshot.papers.filter(row => row.id !== id)
      const drafts = { ...this.snapshot.drafts }
      Reflect.deleteProperty(drafts, id)
      this.publish({
        papers, drafts, selectedId: this.snapshot.selectedId === id ? (papers[0]?.id ?? null) : this.snapshot.selectedId,
      })
    }),
    upload: (id, files) => this.enqueue(async () => {
      if (files.length === 0) throw new PaperCollectionFailure('invalid-request')
      const originals = await Promise.all(files.map(async (file) => {
        const format = paperFormat(file.name)
        if (format === null) throw new PaperCollectionFailure('invalid-request')
        return { name: file.name, format, contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }
      }))
      this.accept(await unwrap(this.remote.uploadPaper({ id, files: originals })))
    }),
    readFile: request => unwrap(this.remote.readPaperFile(request)),
    editDraft: (id, description) => {
      if (this.disposed || !this.snapshot.papers.some(row => row.id === id)) return
      this.publish({ drafts: { ...this.snapshot.drafts, [id]: description } })
      this.clearTimer(id)
      this.timers.set(id, setTimeout(() => { void this.commands.saveDraft(id) }, 500))
    },
    saveDraft: (id) => {
      this.clearTimer(id)
      return this.enqueue(async () => {
        const description = this.snapshot.drafts[id]
        if (description === undefined) return
        this.accept(await unwrap(this.remote.updatePaper({ id, description })))
        if (this.snapshot.drafts[id] === description) {
          const drafts = { ...this.snapshot.drafts }
          Reflect.deleteProperty(drafts, id)
          this.publish({ drafts })
        }
      })
    },
  }

  /** Flush drafts before releasing observers and queued operations. */
  async dispose(): Promise<void> {
    await Promise.all(Object.keys(this.snapshot.drafts).map(id => this.commands.saveDraft(id as TeacherPaperId)))
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
    await this.tail
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (this.disposed) return Promise.resolve(undefined)
    this.publish({ pending: this.snapshot.pending + 1, error: null })
    const queued = this.tail.then(operation).catch((error: unknown) => {
      this.publish({ error: error instanceof PaperCollectionFailure ? error.code : 'transport' })
      return undefined
    }).finally(() => { this.publish({ pending: this.snapshot.pending - 1 }) })
    this.tail = queued.then(() => {})
    return queued
  }

  private accept(row: TeacherPaper): void {
    this.publish({ papers: this.snapshot.papers.map(current =>
      current.id === row.id && current.revision <= row.revision ? row : current) })
  }

  private clearTimer(id: TeacherPaperId): void {
    const timer = this.timers.get(id)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(id)
  }

  private publish(patch: Partial<PaperCollectionSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    notifySubscribers(this.listeners, 'paper-collection')
  }
}

/** Preview failures expose a stable code while keeping original downloads available. */
export class PaperCollectionFailure extends Error {
  /** Stable host or transport error code used by localized preview feedback. */
  readonly code: string
  /** @param code - host failure code or transport failure. */
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

async function unwrap<T>(pending: Promise<RemoteResult<TeacherPaperResult<T>>>): Promise<T> {
  const carried = await pending
  if (!carried.ok) throw new PaperCollectionFailure('transport')
  if (!carried.value.ok) throw new PaperCollectionFailure(carried.value.error.code)
  return carried.value.value
}

/**
 * Determine the original file format from its extension.
 * @param name - uploaded original filename, including its extension.
 * @returns the supported format or null; browser MIME values are unreliable for Word and CAJ.
 */
export function paperFormat(name: string): TeacherPaperFormat | null {
  const extension = name.split('.').at(-1)?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg'
  if (extension === 'pdf' || extension === 'png' || extension === 'webp' || extension === 'gif'
    || extension === 'bmp' || extension === 'docx' || extension === 'doc' || extension === 'caj') return extension
  return null
}

/**
 * Match every search term against paper metadata.
 * @param paper - searchable metadata; original bytes are not searched.
 * @param query - whitespace-separated terms; every term must match the directory, tags, or description.
 * @returns whether the paper matches all search terms.
 */
export function matchesPaper(paper: TeacherPaper, query: string): boolean {
  const text = [paper.name, ...paper.tags, paper.description].join('\n').toLocaleLowerCase()
  return query.trim().toLocaleLowerCase().split(/\s+/u).every(term => text.includes(term))
}
