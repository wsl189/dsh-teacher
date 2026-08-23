/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
// Type-only imports: a plugin-to-plugin value import is a bundle purity
// error, so scope resolution goes through the sessions service (scopeOf
// method) instead of the standalone helper.
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions, SessionFace, SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { OcrExtractResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SubmitImageAttachment, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ComposerAttachment } from './contract/slots.ts'
import type { QueueAction, QueueItemId } from './contract/queue.ts'
import type { ComposerBlocks } from './input/blocks.ts'
import type { DraftAttachmentId, SessionInputResolver } from './input/contract.ts'
import type { InputSubmitMode } from './contract/composer-submission.ts'

/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply.
 */
export interface IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /**
   * The per-session composer-block registry: how a plugin the composer
   * cannot import makes a session's input inert with its own reason.
   */
  readonly blocks: ComposerBlocks
  /**
   * Send a prompt into the caller scope's session (queued turn).
   * @param text - prompt text, sent verbatim as one text block.
   * @returns completion; business failures reject (and land in promptError).
   */
  send(text: string): Promise<void>
  /**
   * Apply one edit, remove, or strict steer operation to a pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns completion; converged strict-steer races resolve, while other failures reject.
   */
  updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void>
  /**
   * Cancel the scoped session's in-flight turn while preserving its pending Queue.
   * @returns completion; failures reject as in send.
   */
  cancel(): Promise<void>
  /**
   * Pull one older history page for the scoped session.
   * @returns completion of the page pull.
   */
  loadOlder(): Promise<void>
}

/** Create one browser-only draft descriptor; only its id enters input state. */
function browserDraftAttachment(file: File): ComposerAttachment {
  return {
    kind: 'image',
    id: crypto.randomUUID() as DraftAttachmentId,
    previewUrl: URL.createObjectURL(file),
    file,
  }
}

interface ImageUrlEntry {
  readonly sessionId: SessionId
  readonly generation: number
  readonly pending: Promise<string>
}

/** Runtime-only identity of one document attached to the unsent composer. */
export type DraftDocumentId = Branded<'DraftDocumentId'>

/** Public document row rendered above the conversation textarea. */
export interface DraftDocument {
  readonly id: DraftDocumentId
  readonly name: string
  readonly status: 'extracting' | 'ready' | 'error'
  readonly truncated?: boolean
  readonly error?: string
}

interface DraftDocumentEntry {
  sessionId: SessionId
  readonly file: File
  public: DraftDocument
  context?: PromptDocumentContext
}

interface PromptDocumentContext {
  readonly name: string
  readonly markdown: string
  readonly truncated: boolean
  readonly sourceId?: string
  readonly sourceMediaType?: string
}

/** Generated OCR Remote subset consumed by conversation uploads. */
export interface ConversationOcrRemote {
  extract(request: {
    name: string
    mediaType: string
    contentBase64: string
  }): Promise<RemoteResult<OcrExtractResult>>
}

/** Generated teacher-workbench Remote subset used to retain source PDFs. */
export interface ConversationWorkbenchRemote {
  stageSource(request: {
    name: string
    mediaType: string
    contentBase64: string
  }): Promise<RemoteResult<{
    ok: true
    value: { id: string; name: string; mediaType: string; bytes: number }
  } | {
    ok: false
    error: { code: string; message: string }
  }>>
}

/** Unsupported browser-declared image type, localized by the UI boundary. */
export class UnsupportedImageMediaTypeError extends Error {
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /** @param mediaType - Browser-declared MIME value, possibly empty. */
  constructor(mediaType: string) {
    super(`unsupported image media type: ${mediaType || '(empty)'}`)
    this.name = 'UnsupportedImageMediaTypeError'
    this.mediaType = mediaType
  }
}

/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export class ConversationController extends Service implements IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /** The per-session composer-block registry. */
  readonly blocks: ComposerBlocks
  private readonly draftAttachments = new Map<DraftAttachmentId, ComposerAttachment>()
  private readonly imageUrls = new Map<string, ImageUrlEntry>()
  private readonly imageGenerations = new Map<SessionId, number>()
  private readonly createdImageUrls = new Set<string>()
  private readonly draftDocuments = new Map<DraftDocumentId, DraftDocumentEntry>()
  private readonly documentStores = new Map<SessionId, SnapshotStore<readonly DraftDocument[]>>()
  private disposed = false

  /**
   * @param ctx - owning root context (the plugin apply context; the service
   * registers itself and follows that fiber's lifetime).
   * @param config - carries the SessionInputResolver and composer-block registry
   * constructed by the plugin apply (the same instances the slot inject
   * factories close over).
   */
  constructor(ctx: Context, private readonly config: {
    input: SessionInputResolver
    blocks: ComposerBlocks
    ocr: ConversationOcrRemote
    workbench: ConversationWorkbenchRemote
  }) {
    super(ctx, 'conversation')
    this.input = config.input
    this.blocks = config.blocks
    ctx.effect(() => () => {
      this.disposed = true
      for (const url of this.createdImageUrls) revokePreview(url)
      this.createdImageUrls.clear()
      this.draftAttachments.clear()
      this.imageUrls.clear()
      this.imageGenerations.clear()
      this.draftDocuments.clear()
      this.documentStores.clear()
    }, 'conversation attachment URL cache')
  }

  /**
   * Send a prompt into the scoped session. Business failures also land in the
   * session snapshot's promptError (object-layer state); the rejection here
   * exists for caller choreography (the composer restores the draft on it).
   * @param text - prompt text, sent verbatim as one text block.
   */
  async send(text: string): Promise<void> {
    const session = this.scopedSession('send')
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Submit ordered draft images with text through one host admission.
   * @param session - target session.
   * @param text - serialized prompt text.
   * @param imageIds - ordered draft-local attachment ids.
   * @param mode - queue or steer delivery selected by composer policy.
   * @param signal - optional cancellation for the complete Host admission.
   * @returns the Host admission outcome; local attachment preparation failures reject.
   */
  async sendSession(
    session: SessionFace,
    text: string,
    imageIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal?: AbortSignal,
  ): Promise<SubmitOutcome> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.sendSession: one or more draft images are no longer available')
    }
    const uploaded = await this.serializeImages(attachments.map(attachment => attachment.file))
    const documents = this.documentEntries(session.sessionId)
    const unavailable = documents.find(document => document.public.status !== 'ready' || document.context === undefined)
    if (unavailable !== undefined) {
      throw new Error(unavailable.public.status === 'error'
        ? unavailable.public.error ?? 'document OCR failed'
        : 'document OCR is still running')
    }
    const contexts = documents.map(document => document.context as PromptDocumentContext)
    const fallback = text === '' && uploaded.length === 0 && contexts.length > 0
      ? `Uploaded documents: ${contexts.map(context => context.name).join(', ')}`
      : text
    const content = [...uploaded, ...(fallback === '' ? [] : [{ type: 'text' as const, text: fallback }])]
    const result = await session.prompt(content, mode, signal, contexts)
    if (!result.ok) return { kind: 'error' }
    this.releaseDraftImages(attachments)
    this.releaseSessionDocuments(session.sessionId)
    return { kind: 'success' }
  }

  /**
   * Observable document rows for one session composer.
   * @param sessionId - session whose unsent document rows are observed.
   * @returns stable store updated as OCR requests settle or rows are removed.
   */
  documentStore(sessionId: SessionId): SnapshotStore<readonly DraftDocument[]> {
    let store = this.documentStores.get(sessionId)
    if (store === undefined) {
      store = createSnapshotStore<readonly DraftDocument[]>(
        this.documentEntries(sessionId).map(entry => entry.public),
      )
      this.documentStores.set(sessionId, store)
    }
    return store
  }

  /**
   * Whether a session has at least one unsent OCR document.
   * @param sessionId - session to inspect.
   * @returns true while any document row belongs to the session.
   */
  hasDraftDocuments(sessionId: SessionId): boolean {
    return this.documentEntries(sessionId).length > 0
  }

  /**
   * Register files immediately, then extract them through the configured MinerU OCR Remote.
   * @param sessionId - session that owns the unsent documents.
   * @param files - browser files to extract in selection order.
   */
  addDraftDocuments(sessionId: SessionId, files: readonly File[]): void {
    for (const file of files) {
      const id = crypto.randomUUID() as DraftDocumentId
      const entry: DraftDocumentEntry = {
        sessionId,
        file,
        public: { id, name: file.name || 'document', status: 'extracting' },
      }
      this.draftDocuments.set(id, entry)
      void this.extractDocument(id, entry)
    }
    this.publishDocuments(sessionId)
  }

  /**
   * Remove one unsent document; a late OCR settlement is ignored.
   * @param id - draft document identity to remove.
   */
  removeDraftDocument(id: DraftDocumentId): void {
    const entry = this.draftDocuments.get(id)
    if (entry === undefined) return
    this.draftDocuments.delete(id)
    this.publishDocuments(entry.sessionId)
  }

  /**
   * Resolve the immutable browser file retained for an unsent document row.
   * @param id - draft document identity to resolve.
   * @returns the file until the row is removed, admitted, or the service is disposed.
   */
  draftDocumentFile(id: DraftDocumentId): File | undefined {
    return this.draftDocuments.get(id)?.file
  }

  /**
   * Move unsent documents with their draft when the user switches workspace.
   * @param from - source session.
   * @param to - destination session when it has no document rows of its own.
   */
  moveDraftDocuments(from: SessionId, to: SessionId): void {
    if (from === to || this.hasDraftDocuments(to)) return
    let changed = false
    for (const entry of this.draftDocuments.values()) {
      if (entry.sessionId !== from) continue
      entry.sessionId = to
      changed = true
    }
    if (!changed) return
    this.publishDocuments(from)
    this.publishDocuments(to)
  }

  /**
   * Drop every unsent document owned by one session.
   * @param sessionId - session whose runtime-only files and rows are released.
   */
  releaseSessionDocuments(sessionId: SessionId): void {
    for (const [id, entry] of this.draftDocuments) {
      if (entry.sessionId === sessionId) this.draftDocuments.delete(id)
    }
    this.publishDocuments(sessionId)
  }

  /**
   * Create runtime-only draft images and their object URLs.
   * @param files - browser files to register after MIME validation.
   * @returns ordered draft descriptors.
   */
  createDraftImages(files: readonly File[]): readonly ComposerAttachment[] {
    for (const file of files) imageMediaType(file.type)
    return files.map((file) => {
      const attachment = browserDraftAttachment(file)
      this.draftAttachments.set(attachment.id, attachment)
      this.createdImageUrls.add(attachment.previewUrl)
      return attachment
    })
  }

  /**
   * Resolve ordered input-state ids to runtime-owned draft images.
   * @param ids - draft attachment ids.
   * @returns descriptors that remain live, in requested order.
   */
  draftImages(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[] {
    const attachments: ComposerAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment !== undefined) attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Serialize ordered draft images to command-submit wire payloads without
   * sending or releasing them (the composer releases only after the command
   * settles successfully).
   * @param imageIds - ordered draft-local attachment ids.
   * @returns base64 payloads in id order.
   */
  async serializeDraftImages(imageIds: readonly DraftAttachmentId[]): Promise<readonly SubmitImageAttachment[]> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.serializeDraftImages: one or more draft images are no longer available')
    }
    return Promise.all(attachments.map(attachment => this.encodeImage(attachment.file)))
  }

  /**
   * Release one browser-owned draft image and preview URL.
   * @param id - draft attachment id.
   */
  releaseDraftImage(id: DraftAttachmentId): void {
    const attachment = this.draftAttachments.get(id)
    if (attachment === undefined) return
    this.draftAttachments.delete(id)
    this.createdImageUrls.delete(attachment.previewUrl)
    revokePreview(attachment.previewUrl)
  }

  /**
   * Release a set of browser-owned draft images.
   * @param attachments - descriptors to release.
   */
  releaseDraftImages(attachments: readonly ComposerAttachment[]): void {
    for (const attachment of attachments) this.releaseDraftImage(attachment.id)
  }

  /**
   * Resolve and cache one session-authorized historical image URL.
   * @param sessionId - owning session authorization scope.
   * @param attachment - durable image reference.
   * @returns browser URL valid until its rendered session is released.
   */
  resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('conversation.resolveImage: service is disposed'))
    const key = `${sessionId}:${attachment.attachmentId}`
    const cached = this.imageUrls.get(key)
    if (cached !== undefined) return cached.pending
    const generation = this.imageGenerations.get(sessionId) ?? 0
    const session = this.requireSessions().binding(sessionId)?.session
    if (session === undefined) {
      return Promise.reject(new Error(`conversation.resolveImage: unknown session "${sessionId}"`))
    }
    const pending = session.readAttachment(attachment.attachmentId)
      .then((result) => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        if (this.disposed) throw new Error('conversation.resolveImage: service was disposed before loading completed')
        if ((this.imageGenerations.get(sessionId) ?? 0) !== generation) {
          throw new Error('historical image scope was released before loading completed')
        }
        if (typeof URL.createObjectURL !== 'function') {
          return `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`
        }
        const bytes = Uint8Array.from(result.value.data)
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }))
        this.createdImageUrls.add(url)
        return url
      })
      .catch((error: unknown) => {
        if (this.imageUrls.get(key)?.generation === generation) this.imageUrls.delete(key)
        throw error
      })
    this.imageUrls.set(key, { sessionId, generation, pending })
    return pending
  }

  /**
   * Release every historical image URL owned by one rendered session.
   * @param sessionId - rendered session scope.
   */
  releaseSessionImages(sessionId: SessionId): void {
    this.imageGenerations.set(sessionId, (this.imageGenerations.get(sessionId) ?? 0) + 1)
    for (const [key, entry] of this.imageUrls) {
      if (entry.sessionId !== sessionId) continue
      this.imageUrls.delete(key)
      void entry.pending.then((url) => {
        if (!this.createdImageUrls.delete(url)) return
        revokePreview(url)
      }, () => {
        // A failed or invalidated load owns no object URL.
      })
    }
  }

  /** Apply one operation to a pending queue occurrence. */
  async updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void> {
    const session = this.scopedSession('updateQueue')
    const result = await session.updateQueue(itemId, action)
    if (!result.ok) {
      if (
        action.kind === 'steer'
        && (result.error.code === 'steer-unavailable' || result.error.code === 'queue-item-not-found')
      ) return
      throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
    }
  }

  /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
  async cancel(): Promise<void> {
    const session = this.scopedSession('cancel')
    const result = await session.cancel()
    if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`)
  }

  /** Pull one older history page for the scoped Session. */
  async loadOlder(): Promise<void> {
    await this.scopedSession('loadOlder').loadOlder()
  }

  /** Resolve the caller scope's session face or throw on root contexts. */
  private scopedSession(op: string): SessionFace {
    const id = this.scopeId(op)
    const binding = this.requireSessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.${op}: session "${id}" resolved no binding`)
    return binding.session
  }

  /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
  private scopeId(op: string): SessionId {
    const id = this.requireSessions().scopeOf(this.ctx)
    if (id === undefined) {
      throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`)
    }
    return id
  }

  private requireSessions(): ISessions {
    // Strict ctx.get, not the injection proxy: the scope-addressed pattern
    // reads the service off whatever context the tracker rebound.
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('conversation: sessions service unavailable')
    return sessions
  }

  /** Convert browser files to canonical base64 prompt parts. */
  private serializeImages(images: readonly File[]): Promise<Parameters<SessionFace['prompt']>[0]> {
    return Promise.all(images.map(async file => ({ type: 'image' as const, ...await this.encodeImage(file) })))
  }

  /** Canonical base64 wire form of one browser image file. */
  private async encodeImage(file: File): Promise<SubmitImageAttachment> {
    return {
      mediaType: imageMediaType(file.type),
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(file.name === '' ? {} : { name: file.name }),
    }
  }

  private documentEntries(sessionId: SessionId): DraftDocumentEntry[] {
    return [...this.draftDocuments.values()].filter(entry => entry.sessionId === sessionId)
  }

  private publishDocuments(sessionId: SessionId): void {
    const store = this.documentStores.get(sessionId)
    if (store !== undefined) store.set(this.documentEntries(sessionId).map(entry => entry.public))
  }

  private async extractDocument(id: DraftDocumentId, entry: DraftDocumentEntry): Promise<void> {
    try {
      const contentBase64 = bytesToBase64(new Uint8Array(await entry.file.arrayBuffer()))
      const [carried, staged] = await Promise.all([
        this.config.ocr.extract({
          name: entry.file.name,
          mediaType: entry.file.type,
          contentBase64,
        }),
        isPdf(entry.file)
          ? this.config.workbench.stageSource({
            name: entry.file.name,
            mediaType: entry.file.type || 'application/pdf',
            contentBase64,
          })
          : Promise.resolve(undefined),
      ])
      const result = carried.ok
        ? carried.value
        : { ok: false as const, error: { message: carried.error.message } }
      if (!this.draftDocuments.has(id)) return
      if (!result.ok) {
        entry.public = { ...entry.public, status: 'error', error: result.error.message }
      } else {
        const { name, markdown, truncated } = result.value
        let source: { id: string; name: string; mediaType: string; bytes: number } | undefined
        if (staged !== undefined) {
          if (!staged.ok) {
            entry.public = { ...entry.public, status: 'error', error: staged.error.message }
            this.publishDocuments(entry.sessionId)
            return
          }
          const stagedResult = staged.value
          if (!stagedResult.ok) {
            entry.public = { ...entry.public, status: 'error', error: stagedResult.error.message }
            this.publishDocuments(entry.sessionId)
            return
          }
          source = stagedResult.value
        }
        entry.context = {
          name,
          markdown,
          truncated,
          ...(source === undefined ? {} : { sourceId: source.id, sourceMediaType: source.mediaType }),
        }
        entry.public = { ...entry.public, name, status: 'ready', truncated }
      }
    } catch (error) {
      if (!this.draftDocuments.has(id)) return
      entry.public = {
        ...entry.public,
        status: 'error',
        error: error instanceof Error ? error.message : 'document OCR failed',
      }
    }
    this.publishDocuments(entry.sessionId)
  }
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLocaleLowerCase().endsWith('.pdf')
}

function imageMediaType(value: string): ImageMediaType {
  switch (value) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return value
    default:
      throw new UnsupportedImageMediaTypeError(value)
  }
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
