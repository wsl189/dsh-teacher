/** Generated-image cards, native save controls, and magnified previews. */
import {
  memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import {
  IconCloseOutline16, IconDownloadOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ImageGenerationResultNode.module.css'

type ImageGenerationResultNodeProps =
  PropsRuntime<'conversation.chat.node', 'image-generation-result'>
  & PropsLocale<'conversation'>

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly url: string; readonly blob: Blob }
  | { readonly kind: 'failed' }

interface ImageWritable {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

interface ImageFileHandle {
  createWritable(): Promise<ImageWritable>
}

type ImageSavePickerGlobal = typeof globalThis & {
  showSaveFilePicker?: (options: { readonly suggestedName: string }) => Promise<ImageFileHandle>
}

const IMAGE_EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} satisfies Record<ImageMediaType, string>

const MIN_ZOOM = 1
const MAX_ZOOM = 8
const ZOOM_STEP = 1.25
const PREVIEW_INSET = 80
const PREVIEW_MAX_WIDTH = 1600

/** Build the loopback-only reader URL owned by the bundled image-generation plugin. */
export function generatedImageUrl(image: ImageAttachmentRef): string {
  const query = new URLSearchParams({
    attachment_id: String(image.attachmentId),
    media_type: image.mediaType,
    bytes: String(image.bytes),
    width: String(image.width),
    height: String(image.height),
  })
  return `/api/dsh-imagegen/agent-image?${query.toString()}`
}

function frameStyle(image: ImageAttachmentRef, variant: 'single' | 'tile'): CSSProperties | undefined {
  if (variant === 'tile') return undefined
  const longEdge = Math.max(image.width, image.height)
  const scale = Math.max(160 / longEdge, Math.min(1, 520 / longEdge))
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  }
}

function generatedImageFileName(image: ImageAttachmentRef): string {
  const extension = IMAGE_EXTENSION[image.mediaType]
  const leaf = image.name?.trim().split(/[\\/]/u).at(-1)
  const safe = leaf?.replace(/[\u0000-\u001F<>:"|?*]/gu, '_').replace(/^\.+/u, '').trim() ?? ''
  if (safe === '') return `generated-image.${extension}`
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  return `${stem}.${extension}`
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

async function saveGeneratedImage(blob: Blob, url: string, fileName: string): Promise<void> {
  const picker = (globalThis as ImageSavePickerGlobal).showSaveFilePicker
  if (globalThis.isSecureContext && picker !== undefined) {
    try {
      const handle = await picker({ suggestedName: fileName })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (cause) {
      if (isAbortError(cause)) return
      throw cause
    }
  }
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
}

function previewBounds(): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(1, Math.min(PREVIEW_MAX_WIDTH, window.innerWidth - PREVIEW_INSET)),
    height: Math.max(1, window.innerHeight - PREVIEW_INSET),
  }
}

function previewImageStyle(
  image: ImageAttachmentRef,
  zoom: number,
  bounds: { readonly width: number; readonly height: number },
): CSSProperties {
  const fit = Math.min(1, bounds.width / image.width, bounds.height / image.height)
  return {
    width: Math.max(1, Math.round(image.width * fit * zoom)),
    height: Math.max(1, Math.round(image.height * fit * zoom)),
  }
}

function GeneratedImagePreview({
  image,
  src,
  alt,
  saving,
  saveError,
  onDownload,
  onClose,
  t,
}: {
  readonly image: ImageAttachmentRef
  readonly src: string
  readonly alt: string
  readonly saving: boolean
  readonly saveError: boolean
  readonly onDownload: () => Promise<void>
  readonly onClose: () => void
  readonly t: ImageGenerationResultNodeProps['t']
}) {
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [bounds, setBounds] = useState(previewBounds)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const descriptionId = useId()
  const downloadLabel = t('image.downloadNamed', { label: alt })
  const style = useMemo(() => previewImageStyle(image, zoom, bounds), [bounds, image, zoom])

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement
    closeRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreRef.current?.focus()
    }
  }, [onClose])

  useEffect(() => {
    const onResize = (): void => { setBounds(previewBounds()) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current as HTMLDivElement
    const onWheel = (event: globalThis.WheelEvent): void => {
      if (event.deltaY === 0) return
      event.preventDefault()
      setZoom(current => event.deltaY < 0
        ? Math.min(MAX_ZOOM, current * ZOOM_STEP)
        : Math.max(MIN_ZOOM, current / ZOOM_STEP))
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => { viewport.removeEventListener('wheel', onWheel) }
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current as HTMLDivElement
    viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
    viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
  }, [bounds, zoom])

  return createPortal(
    <div
      className={css.previewRoot}
      role="dialog"
      aria-modal="true"
      aria-label={t('image.preview')}
      aria-describedby={descriptionId}
      data-zoom={String(zoom)}
    >
      <div className={css.previewMask} aria-hidden="true" onMouseDown={onClose} />
      <span id={descriptionId} className={css.srOnly}>{t('image.zoomHelp')}</span>
      <div
        ref={viewportRef}
        className={css.previewViewport}
        data-generated-image-preview-viewport=""
        title={t('image.zoomHelp')}
      >
        <div className={css.previewStage}>
          <img className={css.previewImage} src={src} alt={alt} style={style} />
        </div>
      </div>
      <div className={css.previewControls}>
        <span className={css.zoomValue} aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className={css.previewControl}
          aria-label={downloadLabel}
          title={downloadLabel}
          disabled={saving}
          onClick={() => { void onDownload() }}
        >
          <IconDownloadOutline16 size={16} />
        </button>
        <button
          ref={closeRef}
          type="button"
          className={css.previewControl}
          aria-label={t('image.closePreview')}
          onClick={onClose}
        >
          <IconCloseOutline16 size={16} />
        </button>
      </div>
      {saveError && <div className={css.previewError} role="alert">{t('image.downloadFailed')}</div>}
    </div>,
    document.body,
  )
}

function GeneratedImage({
  image,
  variant,
  t,
}: {
  readonly image: ImageAttachmentRef
  readonly variant: 'single' | 'tile'
  readonly t: ImageGenerationResultNodeProps['t']
}) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const liveRef = useRef(true)
  const style = useMemo(() => frameStyle(image, variant), [image, variant])
  const label = image.name ?? t('image.label')
  const fileName = useMemo(() => generatedImageFileName(image), [image])
  const downloadLabel = t('image.downloadNamed', { label })

  useEffect(() => {
    liveRef.current = true
    return () => { liveRef.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setState({ kind: 'loading' })
    void fetch(generatedImageUrl(image), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
        const blob = await response.blob()
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setState({ kind: 'loaded', url: objectUrl, blob })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'failed' })
      })
    return () => {
      controller.abort()
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [attempt, image])

  const requestSave = useCallback(async (blob: Blob, url: string): Promise<void> => {
    setSaving(true)
    setSaveError(false)
    try {
      await saveGeneratedImage(blob, url, fileName)
    } catch {
      if (liveRef.current) setSaveError(true)
    } finally {
      if (liveRef.current) setSaving(false)
    }
  }, [fileName])

  if (state.kind === 'failed') {
    return (
      <button
        type="button"
        className={`${css.card} ${css.retry}`}
        data-variant={variant}
        style={style}
        onClick={() => { setAttempt(value => value + 1) }}
      >
        {t('image.loadFailed')}
      </button>
    )
  }
  if (state.kind === 'loading') {
    return <div className={`${css.card} ${css.status}`} data-variant={variant} style={style}>{t('image.loading')}</div>
  }
  return (
    <>
      <div
        className={`${css.card} ${css.loaded}`}
        data-variant={variant}
        data-generated-image-card=""
        style={style}
      >
        <button
          type="button"
          className={css.open}
          title={t('image.openOriginal')}
          aria-label={t('image.openOriginalLabel', { label })}
          onClick={() => { setOpen(true) }}
        >
          <img className={css.image} src={state.url} alt={label} />
        </button>
        <button
          type="button"
          className={css.download}
          aria-label={downloadLabel}
          title={downloadLabel}
          disabled={saving}
          onClick={() => { void requestSave(state.blob, state.url) }}
        >
          <IconDownloadOutline16 size={16} />
        </button>
        {saveError && !open && <span className={css.saveError} role="alert">{t('image.downloadFailed')}</span>}
      </div>
      {open && (
        <GeneratedImagePreview
          image={image}
          src={state.url}
          alt={label}
          saving={saving}
          saveError={saveError}
          onDownload={() => requestSave(state.blob, state.url)}
          onClose={() => { setOpen(false) }}
          t={t}
        />
      )}
    </>
  )
}

/** Independent Chat node containing every distinct generated image in one Turn. */
export const ImageGenerationResultNode = memo(function ImageGenerationResultNode({
  node,
  t,
}: ImageGenerationResultNodeProps) {
  const variant = node.data.images.length === 1 ? 'single' : 'tile'
  return (
    <section
      className={css.gallery}
      data-image-generation-results=""
      data-count={node.data.images.length}
      aria-label={t('image.label')}
    >
      {node.data.images.map(image => (
        <GeneratedImage key={image.attachmentId} image={image} variant={variant} t={t} />
      ))}
    </section>
  )
})
