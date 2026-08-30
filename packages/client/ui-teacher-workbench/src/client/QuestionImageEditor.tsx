/** Browser image editor matching the reference question-cutting workbench. */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { RotateCw, X } from 'lucide-react'
import type {
  TeacherQuestionImageMediaType,
  TeacherQuestionImagePayload,
  TeacherQuestionImageTarget,
  TeacherQuestionImageUpload,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { rotateQuestionCrop } from './question-segmentation.ts'
import { sampleBorderColor } from './question-image-background.ts'
import css from './TeacherWorkbench.module.css'

interface SelectionRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Reference-style image-editor props. */
export interface QuestionImageEditorProps {
  /** Stored raster being edited. */
  readonly target: TeacherQuestionImageTarget
  /** One-based number retained when rotation produces a fresh upload payload. */
  readonly questionNo: number
  /** Image display name used by Save As. */
  readonly fileName: string
  /** Current-root image commands. */
  readonly commands: Pick<TeacherWorkbenchCommands, 'readQuestionImage' | 'replaceQuestionImage'>
  /** Namespace translator. */
  readonly t: TeacherWorkbenchTranslate
  /** Close the modal without changing the stored raster. */
  readonly onClose: () => void
  /** Report a successful overwrite to the parent workspace. */
  readonly onSaved: () => void
}

/** Render crop, erase, rotate, Save As, and overwrite actions over one stored question image. */
export function QuestionImageEditor(props: QuestionImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [payload, setPayload] = useState<TeacherQuestionImagePayload | null>(null)
  const [storedMediaType, setStoredMediaType] = useState<TeacherQuestionImageMediaType | null>(null)
  const [selection, setSelection] = useState<SelectionRect | null>(null)
  const [saving, setSaving] = useState(false)
  const [erased, setErased] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void props.commands.readQuestionImage({ target: props.target }).then((result) => {
      if (!active) return
      if (result.ok) {
        setPayload(result.value)
        setStoredMediaType(result.value.mediaType)
      }
      else setError(result.error.message)
    })
    return () => { active = false }
  }, [props.commands, props.target.id, props.target.kind])

  useEffect(() => {
    if (payload === null) return
    let active = true
    const image = new Image()
    image.onload = () => {
      if (!active) return
      const canvas = canvasRef.current
      if (canvas === null) return
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { alpha: false })
      if (context === null) {
        setError(props.t('questions.editorCanvasError'))
        return
      }
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      setSelection({ x: 0, y: 0, width: canvas.width, height: canvas.height })
      setErased(false)
    }
    image.onerror = () => { if (active) setError(props.t('questions.editorLoadError')) }
    image.src = `data:${payload.mediaType};base64,${payload.contentBase64}`
    return () => { active = false }
  }, [payload, props.t])

  const pointerPosition = (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    if (canvas === null) return null
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    return {
      x: clamp((event.clientX - bounds.left) * canvas.width / bounds.width, 0, canvas.width),
      y: clamp((event.clientY - bounds.top) * canvas.height / bounds.height, 0, canvas.height),
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const point = pointerPosition(event)
    if (point === null) return
    dragStartRef.current = point
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelection({ x: point.x, y: point.y, width: 1, height: 1 })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = dragStartRef.current
    const point = pointerPosition(event)
    if (start === null || point === null) return
    setSelection({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.max(1, Math.abs(point.x - start.x)),
      height: Math.max(1, Math.abs(point.y - start.y)),
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    dragStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const eraseSelection = (): void => {
    const canvas = canvasRef.current
    if (canvas === null || selection === null) return
    const context = canvas.getContext('2d', { alpha: false })
    if (context === null) return
    const rect = normalizedRect(selection, canvas.width, canvas.height)
    context.fillStyle = sampleBorderColor(context, rect, canvas.width, canvas.height)
    context.fillRect(rect.x, rect.y, rect.width, rect.height)
    setErased(true)
    setError(null)
  }

  const rotate = async (): Promise<void> => {
    const canvas = canvasRef.current
    if (canvas === null || payload === null || saving) return
    setSaving(true)
    setError(null)
    try {
      const blob = await canvasToBlob(canvas)
      const upload: TeacherQuestionImageUpload = {
        questionNo: props.questionNo,
        fileName: props.fileName,
        mediaType: 'image/png',
        width: canvas.width,
        height: canvas.height,
        contentBase64: await blobBase64(blob),
      }
      const rotated = await rotateQuestionCrop(upload)
      setPayload({
        fileName: props.fileName,
        mediaType: rotated.mediaType,
        width: rotated.width,
        height: rotated.height,
        contentBase64: rotated.contentBase64,
      })
    } catch (cause) {
      setError(errorMessage(cause, props.t('questions.editorSaveError')))
    } finally {
      setSaving(false)
    }
  }

  const buildOutput = async (): Promise<{
    blob: Blob
    width: number
    height: number
    mediaType: TeacherQuestionImageMediaType
  }> => {
    const canvas = canvasRef.current
    if (canvas === null) throw new Error(props.t('questions.editorCanvasError'))
    const rect = erased || selection === null
      ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
      : normalizedRect(selection, canvas.width, canvas.height)
    const output = document.createElement('canvas')
    output.width = rect.width
    output.height = rect.height
    const context = output.getContext('2d', { alpha: false })
    if (context === null) throw new Error(props.t('questions.editorCanvasError'))
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, output.width, output.height)
    context.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height)
    const mediaType = storedMediaType ?? 'image/png'
    return { blob: await canvasToBlob(output, mediaType), width: output.width, height: output.height, mediaType }
  }

  const saveCopy = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const output = await buildOutput()
      const url = URL.createObjectURL(output.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = editedFileName(props.fileName, output.mediaType)
      anchor.click()
      setTimeout(() => { URL.revokeObjectURL(url) }, 0)
    } catch (cause) {
      setError(errorMessage(cause, props.t('questions.editorSaveError')))
    } finally {
      setSaving(false)
    }
  }

  const overwrite = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const output = await buildOutput()
      const result = await props.commands.replaceQuestionImage({
        target: props.target,
        fileName: props.fileName,
        mediaType: output.mediaType,
        width: output.width,
        height: output.height,
        contentBase64: await blobBase64(output.blob),
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      props.onSaved()
      props.onClose()
    } catch (cause) {
      setError(errorMessage(cause, props.t('questions.editorSaveError')))
    } finally {
      setSaving(false)
    }
  }

  const overlayStyle = (): CSSProperties => {
    const canvas = canvasRef.current
    if (canvas === null || selection === null || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return { display: 'none' }
    return {
      left: selection.x * canvas.clientWidth / canvas.width,
      top: selection.y * canvas.clientHeight / canvas.height,
      width: selection.width * canvas.clientWidth / canvas.width,
      height: selection.height * canvas.clientHeight / canvas.height,
    }
  }

  return (
    <div className={css.legacyEditorLayer} role="dialog" aria-modal="true" aria-label={props.t('questions.editorTitle')}>
      <button type="button" className={css.legacyEditorMask} aria-label={props.t('close')} onClick={props.onClose} />
      <section className={css.legacyEditorModal}>
        <header className={css.legacyEditorHeader}>
          <h2>{props.t('questions.editorTitle')}</h2>
          <div className={css.legacyEditorActions}>
            <button type="button" disabled={saving || selection === null} onClick={eraseSelection}>{props.t('questions.eraseText')}</button>
            <button type="button" disabled={saving || payload === null} onClick={() => { void rotate() }}><RotateCw size={15} />{props.t('questions.rotate')}</button>
            <button type="button" disabled={saving || payload === null} onClick={() => { void saveCopy() }}>{props.t('questions.saveCopy')}</button>
            <button type="button" disabled={saving || payload === null} onClick={() => { void overwrite() }}>{props.t('questions.overwrite')}</button>
            <button type="button" className={css.legacyEditorClose} aria-label={props.t('close')} onClick={props.onClose}><X size={16} /></button>
          </div>
        </header>
        <div
          className={css.legacyEditorStage}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {payload === null && error === null && <span>{props.t('loading')}</span>}
          <div className={css.legacyEditorCanvasWrap}>
            <canvas ref={canvasRef} className={css.legacyEditorCanvas} />
            <div className={css.legacyCropOverlay} style={overlayStyle()} />
          </div>
        </div>
        {error !== null && <p className={css.legacyDrawerError} role="alert">{error}</p>}
      </section>
    </div>
  )
}

function normalizedRect(rect: SelectionRect, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(Math.floor(rect.x), width - 1))
  const y = Math.max(0, Math.min(Math.floor(rect.y), height - 1))
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(rect.width), width - x)),
    height: Math.max(1, Math.min(Math.round(rect.height), height - y)),
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mediaType: TeacherQuestionImageMediaType = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('图片编码失败'))
      else resolve(blob)
    }, mediaType, mediaType === 'image/jpeg' ? 0.92 : undefined)
  })
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function editedFileName(fileName: string, mediaType: TeacherQuestionImageMediaType): string {
  const index = fileName.lastIndexOf('.')
  const extension = mediaType === 'image/jpeg' ? '.jpg' : mediaType === 'image/webp' ? '.webp' : '.png'
  return index > 0 ? `${fileName.slice(0, index)}_edited${extension}` : `${fileName}_edited${extension}`
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
