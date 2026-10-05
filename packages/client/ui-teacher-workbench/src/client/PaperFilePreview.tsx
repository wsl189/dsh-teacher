/** Paper previews retain original downloads and automatically render unsupported Word media through the Host. */

import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, Maximize2, X } from 'lucide-react'
import { renderAsync } from 'docx-preview'
import { unzipSync } from 'fflate/browser'
import type { TeacherPaperId, TeacherPaperSource } from '@deepseek-ai/dsh-api-remotes/client'
import type { PaperCollectionCommands } from './paper-collection-controller.ts'
import { PaperCollectionFailure } from './paper-collection-controller.ts'
import { ExamplePdfPreview } from './ExamplePdfPreview.tsx'
import { renderExampleWordEquations } from './example-word-preview.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import css from './ExampleCollection.module.css'
import paperCss from './PaperCollection.module.css'

/**
 * @param props - immutable original identity, on-demand file reader, and locale.
 * @returns readable pages plus an original download that remains available after a preview failure.
 */
export function PaperFilePreview({ paperId, source, readFile, t }: {
  paperId: TeacherPaperId
  source: TeacherPaperSource
  readFile: PaperCollectionCommands['readFile']
  t: TeacherWorkbenchTranslate
}) {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(source.format === 'doc' || source.format === 'caj')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const word = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    const isActive = (): boolean => active
    const urls: string[] = []
    const host = word.current
    const container = document.createElement('div')
    host?.replaceChildren(container)
    setOriginalUrl(null)
    setPreview(null)
    setError(null)
    setLoading(true)
    setGenerating(source.format === 'doc' || source.format === 'caj')
    void (async () => {
      const original = await readFile({ id: paperId, sourceId: source.id, kind: 'source' })
      if (!isActive()) return
      const bytes = Uint8Array.from(atob(original.contentBase64), character => character.charCodeAt(0))
      const file = new File([bytes], original.name, { type: original.mediaType })
      const originalObjectUrl = URL.createObjectURL(file)
      urls.push(originalObjectUrl)
      setOriginalUrl(originalObjectUrl)
      const needsPdf = source.format === 'doc' || source.format === 'caj'
        || (source.format === 'docx' && wordNeedsPdfPreview(bytes))
      if (source.format === 'docx' && !needsPdf) {
        await renderAsync(file, container, container, {
          className: 'paper-word', inWrapper: false, ignoreWidth: true, ignoreHeight: true,
          breakPages: true, useBase64URL: true,
        })
        if (isActive()) renderExampleWordEquations(bytes, container)
      } else if (needsPdf) {
        setGenerating(true)
        const rendered = await readFile({ id: paperId, sourceId: source.id, kind: 'preview' })
        if (!isActive()) return
        const previewBytes = Uint8Array.from(atob(rendered.contentBase64), character => character.charCodeAt(0))
        const previewFile = new File([previewBytes], rendered.name, { type: rendered.mediaType })
        const url = URL.createObjectURL(previewFile)
        urls.push(url)
        setPreview({ file: previewFile, url })
      } else setPreview({ file, url: originalObjectUrl })
    })().catch((failure: unknown) => {
      if (isActive()) setError(failure instanceof PaperCollectionFailure ? failure.code : 'preview-failed')
    }).finally(() => { if (isActive()) setLoading(false) })
    return () => {
      active = false
      for (const url of urls) URL.revokeObjectURL(url)
      host?.replaceChildren()
    }
  }, [paperId, source.id, source.format, readFile, attempt])
  useEffect(() => {
    if (!expanded) return
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setExpanded(false) }
    document.addEventListener('keydown', escape)
    frame.current?.focus()
    return () => { document.removeEventListener('keydown', escape) }
  }, [expanded])

  return <div ref={frame} className={expanded ? paperCss.expanded : paperCss.preview} tabIndex={expanded ? -1 : undefined}
    role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label={t('papers.content')}>
    <div className={paperCss.previewToolbar}>
      <span className={paperCss.fileName} title={source.name}>{source.name}</span>
      {originalUrl !== null && <a className={css.textButton} href={originalUrl} download={source.name} aria-label={t('papers.download')}>
        <Download size={15} />{t('papers.download')}
      </a>}
      <button type="button" className={css.textButton} aria-label={t(expanded ? 'papers.collapse' : 'papers.expand')}
        onClick={() => { setExpanded(value => !value) }}>{expanded ? <X size={16} /> : <Maximize2 size={16} />}</button>
    </div>
    <div className={paperCss.previewContent}>
      {loading && <div className={css.previewLoading} role="status"><LoaderCircle size={18} className={css.spinner} />
        {t(generating ? 'papers.generatingPreview' : 'examples.previewLoading')}
      </div>}
      {error !== null && <p role="alert" className={css.previewError}>
        {t(error === 'preview-unavailable' ? 'papers.previewUnavailable' : 'papers.previewFailed')}
        <button type="button" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button>
      </p>}
      {source.format === 'docx' && preview === null
        && <div ref={word} className={paperCss.wordContent} aria-label={t('papers.wordContent')} />}
      {preview !== null && (preview.file.type === 'application/pdf' ? <ExamplePdfPreview file={preview.file} renderScale={2} t={t} />
        : <img className={css.sourceImage} src={preview.url} alt={source.name} />)}
    </div>
  </div>
}

/** Browser image decoders cannot display TIFF, Windows metafiles, or EPS embedded in Word. */
function wordNeedsPdfPreview(bytes: Uint8Array): boolean {
  let needed = false
  unzipSync(bytes, { filter: (entry) => {
    if (/^word\/media\/.*\.(?:tiff?|emf|wmf|eps)$/iu.test(entry.name)) needed = true
    return false
  } })
  return needed
}
