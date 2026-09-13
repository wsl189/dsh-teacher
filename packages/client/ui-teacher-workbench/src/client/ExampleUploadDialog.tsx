/** Upload ordering for consecutive fragments of one question or explanation. */

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, FileText, Plus, Upload, X } from 'lucide-react'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import css from './ExampleCollection.module.css'

/**
 * @param props - selected fragments, document title, upload callback, dismissal, and locale.
 * @returns an editable reading-order list; nothing is uploaded until the user submits it.
 */
export function ExampleUploadDialog({ files, title, onUpload, onClose, t }: {
  files: readonly File[]
  title: string
  onUpload: (files: readonly File[]) => void
  onClose: () => void
  t: TeacherWorkbenchTranslate
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const nextId = useRef(files.length)
  const [items, setItems] = useState(() => files.map((file, id) => ({ id, file })))
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    element?.showModal()
    return () => {
      element?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  const move = (index: number, offset: number): void => {
    setItems((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      if (item === undefined) return current
      next.splice(index + offset, 0, item)
      return next
    })
  }
  return (
    <dialog
      ref={dialog}
      className={css.uploadDialog}
      aria-label={t('examples.arrangeSources')}
      onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className={css.uploadWindow}>
        <header className={css.previewHeading}>
          <h2>{title}</h2>
          <button className={css.closeDrawer} aria-label={t('examples.closeUpload')} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <p className={css.uploadOrderHint}>{t('examples.sourceOrderHint')}</p>
        <ol className={css.uploadList} aria-label={t('examples.sourceOrder')}>
          {items.map(({ id, file }, index) => (
            <li key={id}>
              <span className={css.uploadNumber}>{index + 1}</span>
              <SourceThumbnail file={file} />
              <span className={css.uploadName} title={file.name}>{file.name}</span>
              <div className={css.uploadItemActions}>
                <button className={css.expandPreview} disabled={index === 0} aria-label={t('examples.moveSourceUp', { name: file.name })} onClick={() => { move(index, -1) }}>
                  <ArrowUp size={16} />
                </button>
                <button className={css.expandPreview} disabled={index === items.length - 1} aria-label={t('examples.moveSourceDown', { name: file.name })} onClick={() => { move(index, 1) }}>
                  <ArrowDown size={16} />
                </button>
                <button className={css.expandPreview} aria-label={t('examples.removeSource', { name: file.name })} onClick={() => { setItems(current => current.filter(item => item.id !== id)) }}>
                  <X size={16} />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          aria-label={t('examples.addSources')}
          accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.png,.jpg,.jpeg,.webp"
          onChange={(event) => {
            const added = Array.from(event.target.files ?? []).map(file => ({ file, id: nextId.current++ }))
            event.target.value = ''
            setItems(current => [...current, ...added])
          }}
        />
        <footer className={css.uploadFooter}>
          <button className={css.textButton} onClick={() => { input.current?.click() }}><Plus size={16} />{t('examples.addSources')}</button>
          <div className={css.tools}>
            <button className={css.secondary} onClick={onClose}>{t('cancel')}</button>
            <button className={css.primary} disabled={items.length === 0} onClick={() => { onUpload(items.map(item => item.file)) }}>
              <Upload size={16} />{t('examples.uploadSources')}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  )
}

function SourceThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file.type.startsWith('image/') && !/\.(?:png|jpe?g|webp)$/iu.test(file.name)) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => { URL.revokeObjectURL(objectUrl) }
  }, [file])
  return <span className={css.uploadThumbnail}>{url === null ? <FileText size={22} /> : <img src={url} alt="" />}</span>
}
