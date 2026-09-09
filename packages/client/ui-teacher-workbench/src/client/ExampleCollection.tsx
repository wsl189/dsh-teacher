/** Collected-question directories, original/Word previews, annotation, and search drawer. */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  BookOpen,
  Check,
  Download,
  FileText,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  PenLine,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { renderAsync } from 'docx-preview'
import type {
  TeacherExample,
  TeacherExampleDocumentKind,
  TeacherExampleFile,
  TeacherExampleId,
  TeacherExampleStroke,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ExampleCollectionCommands, ExampleCollectionSnapshot } from './example-collection-controller.ts'
import type { TeacherWorkbenchKey } from './locales.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { VoiceInputButton } from './SpeechInput.tsx'
import { ExampleExportDialog } from './ExampleExportDialog.tsx'
import { ExampleTag, ExampleTags } from './ExampleTags.tsx'
import { renderExampleWordEquations, renderExampleWordOptionRows } from './example-word-preview.ts'
import css from './ExampleCollection.module.css'

/** Collection presentation receives Host-backed data and plain callbacks. */
export interface ExampleCollectionProps {
  snapshot: ExampleCollectionSnapshot
  commands: ExampleCollectionCommands
  transcribeVoice: (audio: Blob) => Promise<string>
  t: TeacherWorkbenchTranslate
}

const ERRORS: Readonly<Record<string, TeacherWorkbenchKey>> = {
  'invalid-request': 'examples.invalid',
  'file-too-large': 'examples.tooLarge',
  'ocr-unavailable': 'examples.ocrUnavailable',
  'ocr-truncated': 'examples.ocrTruncated',
  'ocr-failed': 'examples.ocrFailed',
  'correction-unavailable': 'examples.correctionUnavailable',
  'correction-failed': 'examples.correctionFailed',
  'correction-invalid': 'examples.correctionInvalid',
  'correction-too-large': 'examples.correctionTooLarge',
  'not-found': 'examples.notFound',
  'source-changed': 'examples.sourceChanged',
}

const DOCUMENT_LABELS = {
  question: {
    source: 'examples.source',
    word: 'examples.word',
    upload: 'examples.upload',
    replace: 'examples.replace',
    uploadPrompt: 'examples.uploadPrompt',
    wordHint: 'examples.wordHint',
    wordContent: 'examples.wordContent',
    downloadWord: 'examples.downloadWord',
    downloadSource: 'examples.downloadSource',
  },
  explanation: {
    source: 'examples.explanationSource',
    word: 'examples.explanationWord',
    upload: 'examples.uploadExplanation',
    replace: 'examples.replaceExplanation',
    uploadPrompt: 'examples.explanationUploadPrompt',
    wordHint: 'examples.explanationWordHint',
    wordContent: 'examples.explanationWordContent',
    downloadWord: 'examples.downloadExplanationWord',
    downloadSource: 'examples.downloadExplanationSource',
  },
} as const satisfies Record<TeacherExampleDocumentKind, Readonly<Record<string, TeacherWorkbenchKey>>>

/**
 * @param props - collection snapshot, commands, shared speech transcription, and locale.
 * @returns the directory editor and optional search drawer.
 */
export function ExampleCollection({ snapshot, commands, transcribeVoice, t }: ExampleCollectionProps) {
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [renaming, setRenaming] = useState<TeacherExampleId | null>(null)
  const [rename, setRename] = useState('')
  const [menu, setMenu] = useState<{ id: TeacherExampleId; x: number; y: number } | null>(null)
  const [deleting, setDeleting] = useState<TeacherExampleId | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = snapshot.questions.find(question => question.id === snapshot.selectedId)
  const results = snapshot.questions.filter(question => matchesExample(question, query))
  useEffect(() => {
    void commands.refresh()
  }, [commands])
  useEffect(() => {
    if (menu === null) return
    const dismiss = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    menuRef.current?.querySelector('button')?.focus()
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [menu])
  const beginRename = (id: TeacherExampleId): void => {
    const question = snapshot.questions.find(row => row.id === id)
    if (question === undefined) return
    setRename(question.name)
    setRenaming(id)
    setMenu(null)
  }
  const commitRename = async (): Promise<void> => {
    if (renaming === null) return
    const id = renaming
    setRenaming(null)
    if (rename.trim() !== '') await commands.update({ id, name: rename.trim() })
  }

  return (
    <div className={css.collection}>
      <header className={css.header}>
        <div className={css.title}>
          <BookOpen size={22} />
          <div>
            <h1>{t('module.examples')}</h1>
            <p>{t('examples.subtitle')}</p>
          </div>
        </div>
        <form
          className={css.search}
          onSubmit={(event) => {
            event.preventDefault()
            setSearchOpen(true)
          }}
          role="search"
        >
          <Search size={18} />
          <input
            ref={searchRef}
            value={query}
            aria-label={t('examples.search')}
            placeholder={t('examples.searchPlaceholder')}
            title={t('voice.holdSpace')}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          <VoiceInputButton
            transcribe={transcribeVoice}
            onTranscript={setQuery}
            keyboardInput={{ ref: searchRef, onChange: setQuery }}
            t={t}
          />
          <button type="submit">{t('search')}</button>
        </form>
        <span className={css.saveStatus} role="status">
          {snapshot.pending > 0 ? <LoaderCircle size={14} className={css.spinner} /> : <Check size={14} />}
          {snapshot.pending > 0
            ? t('saving')
            : Object.keys(snapshot.drafts).length > 0
              ? t('examples.unsaved')
              : t('examples.saved')}
        </span>
      </header>
      {snapshot.error !== null && (
        <div className={css.error} role="alert">
          {t(ERRORS[snapshot.error] ?? 'examples.failed')}
          <button
            onClick={() => {
              const drafts = snapshot.questions.filter(question => snapshot.drafts[question.id] !== undefined)
              if (drafts.length > 0) void Promise.all(drafts.map(question => commands.saveDraft(question.id)))
              else void commands.refresh()
            }}
          >
            {t('retry')}
          </button>
        </div>
      )}
      <div className={css.body}>
        <aside className={css.directory} aria-label={t('examples.directory')}>
          <div className={css.directoryHeading}>
            <span>{t('examples.directory')}</span>
            <span>{snapshot.questions.length}</span>
          </div>
          <p className={css.directoryHint}>{t('examples.renameHint')}</p>
          <div className={css.directoryList}>
            {snapshot.questions.map(question => (
              <div
                key={question.id}
                className={clsx(css.directoryRow, question.id === snapshot.selectedId && css.selected)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu({ id: question.id, x: event.clientX, y: event.clientY })
                }}
              >
                {renaming === question.id ? (
                  <input
                    autoFocus
                    value={rename}
                    maxLength={120}
                    aria-label={t('examples.rename')}
                    onFocus={(event) => {
                      event.target.select()
                    }}
                    onChange={(event) => {
                      setRename(event.target.value)
                    }}
                    onBlur={() => {
                      void commitRename()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void commitRename()
                      }
                      if (event.key === 'Escape') {
                        setRenaming(null)
                      }
                    }}
                  />
                ) : (
                  <button
                    className={css.directoryButton}
                    aria-label={question.name}
                    aria-current={question.id === snapshot.selectedId ? 'page' : undefined}
                    onClick={() => {
                      commands.select(question.id)
                    }}
                    onDoubleClick={() => {
                      beginRename(question.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'F2') {
                        event.preventDefault()
                        beginRename(question.id)
                      }
                    }}
                  >
                    <FolderOpen size={17} />
                    <span>{question.name}</span>
                    {(snapshot.busy.question[question.id] ?? snapshot.busy.explanation[question.id]) !== undefined && (
                      <LoaderCircle size={14} className={css.spinner} />
                    )}
                    {Object.values(question.documents).some(selected => selected.status === 'ready') &&
                      (snapshot.busy.question[question.id] ?? snapshot.busy.explanation[question.id]) === undefined && (
                      <span className={css.readyDot} aria-label={t('examples.ready')} />
                    )}
                  </button>
                )}
                <button
                  className={css.more}
                  aria-label={t('examples.menu', { name: question.name })}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setMenu({ id: question.id, x: rect.right, y: rect.bottom })
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            ))}
            {snapshot.loaded && snapshot.questions.length === 0 && (
              <p className={css.directoryHint}>{t('examples.noQuestions')}</p>
            )}
          </div>
          <button
            className={css.addQuestion}
            onClick={() => {
              void commands.create()
            }}
            disabled={snapshot.pending > 0}
          >
            <Plus size={18} />
            {t('examples.add')}
          </button>
        </aside>
        <main className={css.editor}>
          {!snapshot.loaded ? (
            <div className={css.empty}>{t('loading')}</div>
          ) : selected === undefined ? (
            <div className={css.empty}>
              <BookOpen size={44} />
              <h2>{t('examples.emptyTitle')}</h2>
              <p>{t('examples.emptyHint')}</p>
              <button
                className={css.primary}
                onClick={() => {
                  void commands.create()
                }}
              >
                <Plus size={16} />
                {t('examples.add')}
              </button>
            </div>
          ) : (
            <ExampleEditor
              key={selected.id}
              question={selected}
              snapshot={snapshot}
              commands={commands}
              transcribeVoice={transcribeVoice}
              t={t}
            />
          )}
        </main>
      </div>
      {menu !== null && (
        <div
          ref={menuRef}
          role="menu"
          className={css.menu}
          style={
            {
              '--menu-x': `${Math.min(menu.x, window.innerWidth - 180)}px`,
              '--menu-y': `${Math.min(menu.y, window.innerHeight - 110)}px`,
            } as CSSProperties
          }
        >
          <button
            role="menuitem"
            onClick={() => {
              beginRename(menu.id)
            }}
          >
            <PenLine size={15} />
            {t('examples.rename')}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setDeleting(menu.id)
              setMenu(null)
            }}
          >
            <Trash2 size={15} />
            {t('examples.delete')}
          </button>
        </div>
      )}
      {deleting !== null && (
        <DeleteExampleDialog
          onClose={() => {
            setDeleting(null)
          }}
          onDelete={() => {
            void commands.delete(deleting).then(() => {
              setDeleting(null)
            })
          }}
          t={t}
        />
      )}
      {searchOpen && (
        <SearchDrawer
          questions={results}
          query={query}
          commands={commands}
          onClose={() => {
            setSearchOpen(false)
          }}
          t={t}
        />
      )}
    </div>
  )
}

function ExampleEditor({
  question,
  snapshot,
  commands,
  transcribeVoice,
  t,
}: ExampleCollectionProps & { question: TeacherExample }) {
  const draft = snapshot.drafts[question.id] ?? question
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  return (
    <div className={css.detail}>
      <div className={css.documents}>
        <ExampleDocumentPanels
          question={question}
          documentKind="question"
          busy={snapshot.busy.question[question.id]}
          commands={commands}
          t={t}
        />
        <ExampleDocumentPanels
          question={question}
          documentKind="explanation"
          busy={snapshot.busy.explanation[question.id]}
          commands={commands}
          t={t}
        />
      </div>
      <section className={clsx(css.panel, css.tagPanel)} aria-label={t('examples.tags')}>
        <div className={css.panelHeading}>
          <h3>
            <Tag size={16} />
            {t('examples.tags')}
          </h3>
          <span className={css.muted}>{t('examples.tagsHint')}</span>
        </div>
        <ExampleTags
          presets={snapshot.tags}
          selected={question.tags}
          pending={snapshot.pending > 0}
          onSelect={tags => commands.update({ id: question.id, tags })}
          onAddPreset={commands.addTag}
          t={t}
        />
      </section>
      <section className={css.panel} aria-label={t('examples.description')}>
        <div className={css.panelHeading}>
          <h3>
            <PenLine size={16} />
            {t('examples.description')}
          </h3>
          <div className={css.tools}>
            <VoiceInputButton
              key={question.id}
              transcribe={transcribeVoice}
              keyboardInput={{
                ref: descriptionRef,
                onChange: (description) => { commands.editDraft(question.id, { description }) },
              }}
              onTranscript={(text) => {
                commands.editDraft(question.id, {
                  description: `${draft.description}${draft.description === '' ? '' : '\n'}${text}`,
                })
              }}
              t={t}
            />
          </div>
        </div>
        <textarea
          ref={descriptionRef}
          className={css.description}
          aria-label={t('examples.description')}
          placeholder={t('examples.descriptionHint')}
          title={t('voice.holdSpace')}
          value={draft.description}
          maxLength={50_000}
          onChange={(event) => {
            commands.editDraft(question.id, { description: event.target.value })
          }}
          onBlur={() => {
            void commands.saveDraft(question.id)
          }}
        />
        {draft.handwriting.length > 0 && <Handwriting strokes={draft.handwriting} t={t} />}
      </section>
    </div>
  )
}

function ExampleDocumentPanels({
  question,
  documentKind,
  busy,
  commands,
  t,
}: {
  question: TeacherExample
  documentKind: TeacherExampleDocumentKind
  busy: 'upload' | 'ocr' | undefined
  commands: ExampleCollectionCommands
  t: TeacherWorkbenchTranslate
}) {
  const input = useRef<HTMLInputElement>(null)
  const selected = question.documents[documentKind]
  const labels = DOCUMENT_LABELS[documentKind]
  return (
    <>
      <section
        className={css.panel}
        aria-label={t(labels.source)}
        onDragOver={(event) => {
          event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file !== undefined && busy === undefined) void commands.upload(question.id, documentKind, file)
        }}
      >
        <div className={css.panelHeading}>
          <h3>
            <ImagePlus size={16} />
            {t(labels.source)}
          </h3>
          <button
            className={css.textButton}
            disabled={busy !== undefined}
            onClick={() => {
              input.current?.click()
            }}
          >
            {t(selected.source === null ? labels.upload : labels.replace)}
          </button>
        </div>
        <input
          ref={input}
          type="file"
          hidden
          aria-label={t(labels.upload)}
          accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.png,.jpg,.jpeg,.webp"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined) void commands.upload(question.id, documentKind, file)
          }}
        />
        {selected.source === null ? (
          <button
            className={css.uploadArea}
            disabled={busy !== undefined}
            onClick={() => {
              input.current?.click()
            }}
          >
            <span className={css.uploadIcon}>
              <Plus size={28} />
            </span>
            <strong>{t(labels.uploadPrompt)}</strong>
            <span>{t('examples.uploadHint')}</span>
          </button>
        ) : (
          <ExampleFilePreview question={question} documentKind={documentKind} kind="source" commands={commands} t={t} />
        )}
      </section>
      <section className={css.panel} aria-label={t(labels.word)}>
        <div className={css.panelHeading}>
          <h3>
            <FileText size={16} />
            {t(labels.word)}
          </h3>
          <div className={css.wordActions}>
            {selected.status === 'ready' && (
              <button
                className={css.textButton}
                disabled={busy !== undefined}
                title={t('examples.proofreadHint')}
                onClick={() => { void commands.recognize(question.id, documentKind) }}
              >
                {t('examples.proofread')}
              </button>
            )}
            <span className={css.badge}>{t('examples.mineru')}</span>
          </div>
        </div>
        {busy !== undefined ? (
          <div className={css.emptyPreview} role="status">
            <LoaderCircle size={30} className={css.spinner} />
            <strong>{t(busy === 'upload' ? 'examples.uploading' : 'examples.recognizing')}</strong>
            <span>{t('examples.backgroundHint')}</span>
          </div>
        ) : selected.status === 'ready' ? (
          <ExampleFilePreview question={question} documentKind={documentKind} kind="word" commands={commands} t={t} />
        ) : (
          <div className={css.emptyPreview}>
            <FileText size={34} />
            <strong>
              {t(
                selected.status === 'error'
                  ? (ERRORS[selected.ocrError ?? ''] ?? 'examples.ocrFailed')
                  : 'examples.wordEmpty',
              )}
            </strong>
            <span>{t(selected.source === null ? labels.wordHint : 'examples.retryHint')}</span>
            {selected.source !== null && (
              <button
                className={css.secondary}
                onClick={() => {
                  void commands.recognize(question.id, documentKind)
                }}
              >
                {t('examples.recognize')}
              </button>
            )}
          </div>
        )}
      </section>
    </>
  )
}

interface ExampleFileHeadingContent {
  readonly title: ReactNode
  readonly action: ReactNode
}

function ExampleFileHeading({ heading, download }: { heading: ExampleFileHeadingContent; download?: ReactNode }) {
  return (
    <div className={css.panelHeading}>
      {heading.title}
      <div className={css.wordActions}>
        {download}
        {heading.action}
      </div>
    </div>
  )
}

function ExampleFilePreview({
  question,
  documentKind,
  kind,
  commands,
  t,
  heading,
}: {
  question: TeacherExample
  documentKind: TeacherExampleDocumentKind
  kind: 'source' | 'word'
  commands: ExampleCollectionCommands
  t: TeacherWorkbenchTranslate
  heading?: ExampleFileHeadingContent
}) {
  const [file, setFile] = useState<{ data: TeacherExampleFile; url: string } | null>(null)
  const [error, setError] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [readAttempt, setReadAttempt] = useState(0)
  const body = useRef<HTMLDivElement>(null)
  const selected = question.documents[documentKind]
  const labels = DOCUMENT_LABELS[documentKind]
  const sourceId = selected.source?.id
  const wordRevision = kind === 'word' ? selected.wordRevision : 0
  useEffect(() => {
    let active = true
    const isActive = (): boolean => active
    let url: string | undefined
    let disposeWordLayout: (() => void) | undefined
    const host = body.current
    const container = document.createElement('div')
    host?.replaceChildren(container)
    setFile(null)
    setError(false)
    setRendered(false)
    void commands
      .readFile({ id: question.id, document: documentKind, kind })
      .then(async (data) => {
        if (!active) return
        const bytes = Uint8Array.from(atob(data.contentBase64), character => character.charCodeAt(0))
        const blob = new Blob([bytes], { type: data.mediaType })
        url = URL.createObjectURL(blob)
        setFile({ data, url })
        if (kind === 'word') {
          await renderAsync(blob, container, container, {
            className: 'example-word',
            inWrapper: false,
            ignoreWidth: true,
            ignoreHeight: true,
            breakPages: false,
            useBase64URL: true,
          })
          renderExampleWordEquations(bytes, container)
          if (isActive()) disposeWordLayout = renderExampleWordOptionRows(container)
        }
      })
      .then(() => {
        if (active) setRendered(true)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
      disposeWordLayout?.()
      if (url !== undefined) URL.revokeObjectURL(url)
      host?.replaceChildren()
    }
  }, [commands, question.id, sourceId, wordRevision, kind, documentKind, readAttempt])
  const download = file === null ? null : (
    <a
      className={heading === undefined ? undefined : css.textButton}
      href={file.url}
      download={file.data.name}
      aria-label={t(kind === 'word' ? labels.downloadWord : labels.downloadSource)}
    >
      <Download size={15} />
      {t('examples.download')}
    </a>
  )
  return (
    <>
      {heading !== undefined && <ExampleFileHeading heading={heading} download={download} />}
      <div className={css.filePreview}>
        {error && (
          <p role="alert" className={css.previewError}>
            {t('examples.previewFailed')}
            <button type="button" onClick={() =>{  setReadAttempt(attempt => attempt + 1) }}>{t('retry')}</button>
          </p>
        )}
        {!rendered && !error && (
          <div className={css.previewLoading} role="status">
            <LoaderCircle size={18} className={css.spinner} />
            {t('examples.previewLoading')}
          </div>
        )}
        {kind === 'word' && <div ref={body} className={css.wordPage} aria-label={t(labels.wordContent)} />}
        {file !== null &&
          kind === 'source' &&
          (file.data.mediaType === 'application/pdf' ? (
            <iframe src={file.url} title={file.data.name} className={css.pdf} />
          ) : (
            <img src={file.url} alt={file.data.name} className={css.sourceImage} />
          ))}
        {file !== null && heading === undefined && (
          <div className={css.fileFooter}>
            <span title={file.data.name}>{file.data.name}</span>
            {download}
          </div>
        )}
      </div>
    </>
  )
}

function Handwriting({
  strokes,
  t,
}: {
  strokes: readonly TeacherExampleStroke[]
  t: TeacherWorkbenchTranslate
}) {
  return (
    <div className={css.handwriting}>
      <svg
        className={css.writingArea}
        viewBox="0 0 1000 220"
        preserveAspectRatio="none"
        role="img"
        aria-label={t('examples.handwritingArea')}
      >
        {strokes.map((stroke, index) => (
          <polyline key={index} points={stroke.points.map(point => `${point.x * 1000},${point.y * 220}`).join(' ')} />
        ))}
      </svg>
    </div>
  )
}

function SearchDrawer({
  questions,
  query,
  commands,
  onClose,
  t,
}: {
  questions: readonly TeacherExample[]
  query: string
  commands: ExampleCollectionCommands
  onClose: () => void
  t: TeacherWorkbenchTranslate
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<ReadonlySet<TeacherExampleId>>(new Set())
  const [exportOpen, setExportOpen] = useState(false)
  const selectedQuestions = questions.filter(question => selected.has(question.id))
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => {
      element?.close()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className={css.drawer}
      aria-label={t('examples.searchResults')}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={css.drawerInner}>
        <header className={css.drawerHeading}>
          <div className={css.drawerSummary}>
            <h2>{t('examples.resultCount', { count: String(questions.length) })}</h2>
            <p title={query || t('examples.allQuestions')}>{query || t('examples.allQuestions')}</p>
          </div>
          <div className={css.drawerActions}>
            <span className={css.muted}>{t('examples.exportSelected', { count: String(selectedQuestions.length) })}</span>
            <button className={css.primary} disabled={selectedQuestions.length === 0} onClick={() => { setExportOpen(true) }}>
              <Download size={16} />
              {t('examples.exportWord')}
            </button>
            <button className={css.closeDrawer} aria-label={t('examples.closeSearch')} onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </header>
        <div className={css.results}>
          {questions.length === 0 && (
            <div className={css.empty}>
              <Search size={36} />
              <h3>{t('examples.noResults')}</h3>
              <p>{t('examples.noResultsHint')}</p>
            </div>
          )}
          {questions.map((question) => {
            const heading: ExampleFileHeadingContent = {
              title: (
                <div className={css.resultTitle}>
                  <input
                    type="checkbox"
                    aria-label={t('examples.selectQuestion', { name: question.name })}
                    checked={selected.has(question.id)}
                    disabled={question.documents.question.status !== 'ready'}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setSelected((current) => {
                        const next = new Set(current)
                        if (checked) next.add(question.id)
                        else next.delete(question.id)
                        return next
                      })
                    }}
                  />
                  <h3>
                    <FolderOpen size={16} />
                    {question.name}
                  </h3>
                </div>
              ),
              action: (
                <button
                  className={css.textButton}
                  onClick={() => {
                    commands.select(question.id)
                    onClose()
                  }}
                >
                  {t('examples.openQuestion')}
                </button>
              ),
            }
            return (
              <article key={question.id} className={clsx(css.result, selected.has(question.id) && css.resultSelected)}>
                <div className={css.resultPreview}>
                  {question.documents.question.status === 'ready' ? (
                    <ExampleFilePreview heading={heading} question={question} documentKind="question" kind="word" commands={commands} t={t} />
                  ) : (
                    <>
                      <ExampleFileHeading heading={heading} />
                      <div className={css.emptyPreview}>
                        <FileText size={26} />
                        {t('examples.wordEmpty')}
                      </div>
                    </>
                  )}
                </div>
                <div className={css.resultMetadata}>
                  <div className={css.tagList}>
                    {question.tags.length === 0 ? (
                      <span className={css.muted}>{t('examples.noSelectedTags')}</span>
                    ) : (
                      question.tags.map(tag => <ExampleTag key={tag} tag={tag} />)
                    )}
                  </div>
                  <p className={css.resultDescription}>{question.description || t('examples.noDescription')}</p>
                  {question.handwriting.length > 0 && (
                    <Handwriting strokes={question.handwriting} t={t} />
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </div>
      {exportOpen && <ExampleExportDialog
        questions={selectedQuestions}
        onExport={commands.exportWord}
        onClose={() => { setExportOpen(false) }}
        t={t}
      />}
    </dialog>
  )
}

function DeleteExampleDialog({
  onClose,
  onDelete,
  t,
}: {
  onClose: () => void
  onDelete: () => void
  t: TeacherWorkbenchTranslate
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => {
      element?.close()
    }
  }, [])
  return (
    <dialog ref={dialog} className={css.confirm} aria-label={t('examples.delete')} onCancel={onClose}>
      <h2>{t('examples.delete')}</h2>
      <p>{t('examples.deleteHint')}</p>
      <div className={css.tools}>
        <button className={css.secondary} autoFocus onClick={onClose}>
          {t('cancel')}
        </button>
        <button className={css.primary} onClick={onDelete}>
          {t('delete')}
        </button>
      </div>
    </dialog>
  )
}

/**
 * @param question - persisted tags and text description.
 * @param query - whitespace-separated keywords; each must match a tag or description.
 * @returns whether the question belongs in the search drawer.
 */
export function matchesExample(question: TeacherExample, query: string): boolean {
  const haystack = [...question.tags, question.description].join('\n').normalize('NFKC').toLocaleLowerCase()
  return query
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .every(word => haystack.includes(word))
}
