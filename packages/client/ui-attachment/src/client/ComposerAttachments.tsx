import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps, DraftDocument, DraftDocumentId,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DocumentSidebarController } from './document-sidebar.tsx'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.module.css'

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

/** Directory metadata exposed by Chromium's drag-and-drop entry API. */
interface DroppedEntry {
  readonly isDirectory: boolean
  readonly fullPath?: string
  readonly name: string
}

/** A dropped batch split without enumerating directory contents. */
interface DroppedBatch {
  readonly directories: readonly string[]
  readonly files: readonly File[]
}

/** Optional better-sidebar bridge injected by this plugin's registration. */
export interface ComposerAttachmentsInjected {
  /** Read the currently composed preview bridge without making it a hard dependency. */
  documentSidebar: () => DocumentSidebarController | undefined
}

type ComposerAttachmentsViewProps = ComposerAttachmentsProps & ComposerAttachmentsInjected

function documentStatus(document: DraftDocument, t: ComposerAttachmentsProps['t']): string {
  if (document.status === 'extracting') return t('document.extracting')
  if (document.status === 'error') return t('document.failed')
  return document.truncated === true ? t('document.readyTruncated') : t('document.ready')
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
      <path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** Resolve a directory path from native-client metadata or the browser-relative entry. */
function droppedDirectoryPath(entry: DroppedEntry, file: File | null): string | undefined {
  const nativePath: unknown = file === null ? undefined : Reflect.get(file, 'path')
  const native = typeof nativePath === 'string' && nativePath !== ''
  const raw = native ? nativePath : entry.fullPath ?? entry.name
  const normalized = raw.replaceAll('\\', '/').replace(/\/+$/u, '')
  const path = native ? normalized : normalized.replace(/^\/+/u, '')
  return path === '' ? undefined : path
}

/** Split dropped files from directory paths without traversing a directory tree. */
function droppedBatch(dataTransfer: DataTransfer): DroppedBatch {
  const items = [...dataTransfer.items]
  if (items.length === 0) return { directories: [], files: [...dataTransfer.files] }
  const directories: string[] = []
  const files: File[] = []
  for (const item of items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    const entry = item.webkitGetAsEntry() as DroppedEntry | null
    if (entry?.isDirectory === true) {
      const path = droppedDirectoryPath(entry, file)
      if (path !== undefined) directories.push(path)
    } else if (file !== null) {
      files.push(file)
    }
  }
  return { directories, files }
}

/** Draft-image rail, file/folder drop target, and original-image preview slot entry. */
export function ComposerAttachments({
  attachments, documents, canAcceptDrop, canRemoveDocuments,
  onAddImages, onAddDirectories, onRemoveImage, resolveDocumentFile, onRemoveDocument,
  dropLimits, sessionId, documentSidebar, t,
}: ComposerAttachmentsViewProps) {
  const [preview, setPreview] = useState<ComposerAttachment | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => { setPreview(null) }, [])
  const sidebar = documentSidebar()

  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => {
    if (sessionId !== undefined) sidebar?.reconcile(sessionId, documents)
  }, [documents, sessionId, sidebar])

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (!canAcceptDrop) return
      const dropped = droppedBatch(dataTransfer)
      onAddDirectories(dropped.directories)
      onAddImages(dropped.files)
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, onAddDirectories, onAddImages])

  const railItems = useMemo<ComposerRailItem[]>(() => attachments.map(attachment => ({
    id: attachment.id,
    previewUrl: attachment.previewUrl,
    alt: attachment.file.name || t('image.pending'),
    removeLabel: t('image.remove', { name: attachment.file.name }),
    attachment,
  })), [attachments, t])

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)}
        />
      )}
      {documents.length > 0 && (
        <div className={css.documentRail} aria-label={t('document.pending')}>
          {documents.map((document) => {
            const open = sessionId === undefined || sidebar === undefined
              ? undefined
              : (): void => {
                const file = resolveDocumentFile(document.id)
                if (file !== undefined) sidebar.open(sessionId, document, file, t)
              }
            const previewable = open !== undefined
            const content = (
              <>
                <DocumentIcon />
                <span className={css.documentName}>{document.name}</span>
                <span className={css.documentStatus}>{documentStatus(document, t)}</span>
              </>
            )
            const remove = (id: DraftDocumentId): void => {
              if (sessionId !== undefined) sidebar?.close(sessionId, id)
              onRemoveDocument(id)
            }
            return (
              <div
                key={document.id}
                className={css.documentChip}
                data-document-status={document.status}
                data-document-previewable={previewable || undefined}
                title={document.error}
              >
                {previewable
                  ? (
                    <button
                      type="button"
                      className={css.documentOpen}
                      aria-label={t('document.openPreview', { name: document.name })}
                      onClick={open}
                    >
                      {content}
                    </button>
                  )
                  : <div className={css.documentStatic}>{content}</div>}
                <button
                  type="button"
                  className={css.documentRemove}
                  aria-label={t('document.remove', { name: document.name })}
                  disabled={!canRemoveDocuments}
                  onClick={() => { remove(document.id) }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
      {railItems.length > 0 && (
        <div className={css.rail}>
          <AttachmentRail
            items={railItems}
            labels={attachmentRailLabels(t)}
            onOpen={(item) => { setPreview(item.attachment) }}
            onRemove={(item) => { onRemoveImage(item.attachment.id) }}
          />
        </div>
      )}
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
