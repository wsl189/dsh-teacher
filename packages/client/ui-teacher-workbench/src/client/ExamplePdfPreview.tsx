/** Ordered PDF page images for collected originals in browser and desktop webviews. */

import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { TeacherQuestionPagePreview } from '@deepseek-ai/dsh-api-remotes/client'
import { openQuestionPdfRasterizer } from './question-segmentation.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import css from './ExampleCollection.module.css'

/**
 * @param props - saved PDF bytes and localized preview labels.
 * @returns every source page in reading order, with loading and retry states.
 */
export function ExamplePdfPreview({ file, t }: { file: File; t: TeacherWorkbenchTranslate }) {
  const [pages, setPages] = useState<readonly TeacherQuestionPagePreview[]>([])
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const isActive = (): boolean => active
    setPages([])
    setComplete(false)
    setError(false)
    void (async () => {
      const reader = await openQuestionPdfRasterizer(file)
      try {
        for (let index = 0; index < reader.pageCount; index++) {
          if (!isActive()) return
          const rendered = await reader.renderPagePreviews([index], window.devicePixelRatio)
          if (isActive()) setPages(current => [...current, ...rendered])
        }
      } finally {
        await reader.dispose()
      }
    })().then(() => {
      if (isActive()) setComplete(true)
    }).catch(() => {
      if (!isActive()) return
      setPages([])
      setError(true)
    })
    return () => { active = false }
  }, [file, attempt])
  return (
    <div className={css.pdfPages}>
      {pages.map(page => (
        <img
          key={page.pageIndex}
          className={css.pdfPage}
          src={`data:${page.mediaType};base64,${page.contentBase64}`}
          width={page.width}
          height={page.height}
          alt={t('examples.pdfPage', { name: file.name, page: String(page.pageIndex + 1) })}
        />
      ))}
      {!complete && !error && (
        <div className={css.previewLoading} role="status">
          <LoaderCircle size={18} className={css.spinner} />
          {t('examples.previewLoading')}
        </div>
      )}
      {error && (
        <p role="alert" className={css.previewError}>
          {t('examples.previewFailed')}
          <button type="button" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button>
        </p>
      )}
    </div>
  )
}
