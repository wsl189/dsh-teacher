/** Export layout selection and download for checked search results. */

import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, X } from 'lucide-react'
import type { TeacherExample, TeacherExampleExportLayout } from '@deepseek-ai/dsh-api-remotes/client'
import type { ExampleCollectionCommands } from './example-collection-controller.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import css from './ExampleCollection.module.css'

/**
 * @param props - selected questions in result order, export callback, locale, and dismissal.
 * @returns a layout dialog that downloads one Word file after successful compilation.
 */
export function ExampleExportDialog({ questions, onExport, onClose, t }: {
  questions: readonly TeacherExample[]
  onExport: ExampleCollectionCommands['exportWord']
  onClose: () => void
  t: TeacherWorkbenchTranslate
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [layout, setLayout] = useState<TeacherExampleExportLayout>('paired')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const ready = questions.length > 0 && questions.every(question =>
    question.documents.question.status === 'ready' &&
    (question.documents.explanation.source === null || question.documents.explanation.status === 'ready'),
  )
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])
  const exportWord = async (): Promise<void> => {
    if (!ready || pending) return
    setPending(true)
    setFailed(false)
    try {
      const file = await onExport({
        ids: questions.map(question => question.id),
        layout,

      })
      const bytes = Uint8Array.from(atob(file.contentBase64), character => character.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }))
      const link = document.createElement('a')
      link.href = url
      link.download = t('examples.exportFilename')
      link.click()
      setTimeout(() => { URL.revokeObjectURL(url) }, 0)
      onClose()
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className={css.confirm}
      aria-label={t('examples.exportWord')}
      onCancel={(event) => {
        if (pending) event.preventDefault()
        else onClose()
      }}
    >
      <div className={css.exportDialogHeading}>
        <h2>{t('examples.exportWord')}</h2>
        <button className={css.textButton} aria-label={t('examples.closeExport')} onClick={onClose} disabled={pending}>
          <X size={18} />
        </button>
      </div>
      <p>{t('examples.exportSelection', { count: String(questions.length) })}</p>
      <fieldset className={css.exportLayouts} disabled={pending}>
        <legend>{t('examples.exportLayout')}</legend>
        <label>
          <input type="radio" name="example-export-layout" value="paired" checked={layout === 'paired'} onChange={() => { setLayout('paired') }} />
          <span><strong>{t('examples.exportPaired')}</strong><small>{t('examples.exportPairedHint')}</small></span>
        </label>
        <label>
          <input type="radio" name="example-export-layout" value="grouped" checked={layout === 'grouped'} onChange={() => { setLayout('grouped') }} />
          <span><strong>{t('examples.exportGrouped')}</strong><small>{t('examples.exportGroupedHint')}</small></span>
        </label>
      </fieldset>
      <p>{t('examples.exportMissingExplanation')}</p>
      {!ready && <p role="alert">{t('examples.exportNotReady')}</p>}
      {failed && <p role="alert">{t('examples.exportFailed')}</p>}
      <div className={css.tools}>
        <button className={css.secondary} onClick={onClose} disabled={pending}>{t('cancel')}</button>
        <button className={css.primary} onClick={() => { void exportWord() }} disabled={!ready || pending}>
          {pending ? <LoaderCircle size={16} className={css.spinner} /> : <Download size={16} />}
          {t(pending ? 'examples.exporting' : 'examples.exportDownload')}
        </button>
      </div>
    </dialog>
  )
}
