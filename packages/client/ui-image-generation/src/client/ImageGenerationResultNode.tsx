import { memo, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ImageGenerationResultNode.module.css'

type ImageGenerationResultNodeProps =
  PropsRuntime<'conversation.chat.node', 'image-generation-result'>
  & PropsLocale<'conversation'>

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly url: string }
  | { readonly kind: 'failed' }

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
  const style = useMemo(() => frameStyle(image, variant), [image, variant])
  const label = image.name ?? t('image.label')

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
        setState({ kind: 'loaded', url: objectUrl })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'failed' })
      })
    return () => {
      controller.abort()
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [attempt, image])

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
    <a
      className={`${css.card} ${css.link}`}
      data-variant={variant}
      style={style}
      href={state.url}
      target="_blank"
      rel="noreferrer"
      title={t('image.openOriginal')}
      aria-label={t('image.openOriginalLabel', { label })}
    >
      <img className={css.image} src={state.url} alt={label} />
    </a>
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
