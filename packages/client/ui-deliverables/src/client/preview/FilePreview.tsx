import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import {
  decodePreviewBytes, DocxPreview, ImagePreview, MarkdownPreview, PdfPreview,
  PptxPreview, previewKind, XlsxPreview,
} from './renderers.tsx'
import css from './FilePreview.module.css'

/** JSON-compatible bytes returned by the bounded preview RPC. */
export interface PreviewFilePayload {
  dataBase64: string
  size: number
}

/** Registration-private file loader bound to the current session. */
export interface FilePreviewInjected {
  /** Read a complete workspace-contained file; rejects on policy, I/O, or size failure. */
  loadPreview: (path: string, signal: AbortSignal) => Promise<PreviewFilePayload>
}

/** Full props of the produced-file details renderer. */
export type FilePreviewProps = PropsRuntime<'conversation.details.file'>
  & PropsLocale<typeof NS> & InjectFace<FilePreviewInjected>

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; bytes: Uint8Array }

/** Load and render one selected produced file inside the right details panel. */
export function FilePreview({ path, openFile, loadPreview, t }: FilePreviewProps) {
  const kind = previewKind(path)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [openError, setOpenError] = useState<string>()

  useEffect(() => {
    if (kind === 'unsupported') return
    const abort = new AbortController()
    setState({ kind: 'loading' })
    void loadPreview(path, abort.signal).then(
      (payload) => {
        if (!abort.signal.aborted) {
          setState({ kind: 'ready', bytes: decodePreviewBytes(payload.dataBase64) })
        }
      },
      (reason: unknown) => {
        if (!abort.signal.aborted) {
          setState({ kind: 'failed', message: reason instanceof Error ? reason.message : String(reason) })
        }
      },
    )
    return () => { abort.abort() }
  }, [kind, loadPreview, path, revision])

  const openExternal = (): void => {
    setOpenError(undefined)
    void openFile(path).catch((reason: unknown) => {
      setOpenError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  let body: ReactNode
  if (kind === 'unsupported') body = <div className={css.status}>{t('preview.unsupported')}</div>
  else if (state.kind === 'loading') body = <div className={css.status}>{t('preview.loading')}</div>
  else if (state.kind === 'failed') {
    body = (
      <div className={css.failure}>
        <div className={css.error}>{state.message}</div>
        <button type="button" onClick={() => { setRevision(value => value + 1) }}>{t('preview.retry')}</button>
      </div>
    )
  } else {
    switch (kind) {
      case 'pdf': body = <PdfPreview bytes={state.bytes} t={t} />; break
      case 'pptx': body = <PptxPreview bytes={state.bytes} t={t} />; break
      case 'docx': body = <DocxPreview bytes={state.bytes} t={t} />; break
      case 'xlsx': body = <XlsxPreview bytes={state.bytes} t={t} />; break
      case 'markdown': body = <MarkdownPreview bytes={state.bytes} />; break
      case 'image': body = <ImagePreview bytes={state.bytes} path={path} />; break
      default: {
        const unreachable: never = kind
        body = unreachable
      }
    }
  }

  return (
    <div className={css.root} data-file-preview={path}>
      <div className={css.toolbar}>
        {kind !== 'unsupported' && (
          <button type="button" onClick={() => { setRevision(value => value + 1) }}>{t('preview.refresh')}</button>
        )}
        <button type="button" onClick={openExternal}>{t('preview.openExternal')}</button>
      </div>
      {openError !== undefined && <div className={css.error}>{openError}</div>}
      <div className={css.body}>{body}</div>
    </div>
  )
}
