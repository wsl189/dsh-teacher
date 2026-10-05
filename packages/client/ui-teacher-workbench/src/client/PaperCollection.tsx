/** Paper directories, original-file previews, tags, descriptions, and search. */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import { BookOpen, FileText, FolderOpen, LoaderCircle, MoreHorizontal, Plus, Search, Tag, Trash2, X } from 'lucide-react'
import { useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherPaper, TeacherPaperId, TeacherPaperSourceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { PaperCollectionCommands, PaperCollectionSnapshot } from './paper-collection-controller.ts'
import { matchesPaper } from './paper-collection-controller.ts'
import { ExampleTag, ExampleTags } from './ExampleTags.tsx'
import { PaperFilePreview } from './PaperFilePreview.tsx'
import { VoiceInputButton } from './SpeechInput.tsx'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import css from './ExampleCollection.module.css'
import paperCss from './PaperCollection.module.css'

/** Host-backed data and stable callbacks for the paper collection. */
export interface PaperCollectionProps {
  snapshot: PaperCollectionSnapshot
  commands: PaperCollectionCommands
  transcribeVoice: (audio: Blob) => Promise<string>
  t: TeacherWorkbenchTranslate
}

/**
 * @param props - observable metadata, commands, voice transcription, and locale.
 * @returns paper directory navigation and its preview editor.
 */
export function PaperCollection({ snapshot, commands, transcribeVoice, t }: PaperCollectionProps) {
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [renaming, setRenaming] = useState<TeacherPaperId | null>(null)
  const [name, setName] = useState('')
  const [menu, setMenu] = useState<{ id: TeacherPaperId; x: number; y: number } | null>(null)
  const [deleting, setDeleting] = useState<TeacherPaperId | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useDismissOnOutsidePointer(menuRef, menu !== null, (open) => { if (!open) setMenu(null) })
  const selected = snapshot.papers.find(row => row.id === snapshot.selectedId)
  const searchable = snapshot.papers.map(row => ({ ...row, description: snapshot.drafts[row.id] ?? row.description }))
  const results = searchable.filter(row => matchesPaper(row, query))
  useEffect(() => { void commands.refresh() }, [commands])

  const beginRename = (id: TeacherPaperId): void => {
    const row = snapshot.papers.find(paper => paper.id === id)
    if (row === undefined) return
    setName(row.name)
    setRenaming(id)
    setMenu(null)
  }
  const commitRename = (): void => {
    if (renaming === null) return
    const id = renaming
    setRenaming(null)
    if (name.trim() !== '') void commands.update({ id, name: name.trim() })
  }
  const retry = (): void => {
    const drafts = Object.keys(snapshot.drafts)
    if (drafts.length > 0) void Promise.all(drafts.map(id => commands.saveDraft(id as TeacherPaperId)))
    else void commands.refresh()
  }

  return (
    <div className={css.collection} data-paper-collection>
      <header className={css.header}>
        <div className={css.title}>
          <BookOpen size={22} />
          <div><h1>{t('module.papers')}</h1><p>{t('papers.subtitle')}</p></div>
        </div>
        <form className={css.search} role="search" onSubmit={(event) => { event.preventDefault(); setSearchOpen(true) }}>
          <Search size={18} />
          <input ref={searchRef} value={query} aria-label={t('papers.search')} placeholder={t('papers.searchPlaceholder')}
            onChange={(event) => { setQuery(event.target.value) }} />
          <VoiceInputButton transcribe={transcribeVoice} onTranscript={setQuery}
            keyboardInput={{ ref: searchRef, onChange: setQuery }} t={t} />
          <button type="submit">{t('search')}</button>
        </form>
        {(snapshot.pending > 0 || Object.keys(snapshot.drafts).length > 0) && (
          <span className={css.saveStatus} role="status">
            {snapshot.pending > 0 && <LoaderCircle size={14} className={css.spinner} />}
            {t(snapshot.pending > 0 ? 'saving' : 'examples.unsaved')}
          </span>
        )}
      </header>
      {snapshot.error !== null && <div className={css.error} role="alert">
        {t(snapshot.error === 'file-too-large' ? 'papers.tooLarge' : snapshot.error === 'invalid-request' ? 'papers.invalid' : 'papers.failed')}
        <button type="button" onClick={retry}>{t('retry')}</button>
      </div>}
      <div className={css.body}>
        <aside className={css.directory} aria-label={t('papers.directory')}>
          <div className={css.directoryHeading}><span>{t('papers.directory')}</span><span>{snapshot.papers.length}</span></div>
          <p className={css.directoryHint}>{t('papers.renameHint')}</p>
          <div className={css.directoryList}>
            {snapshot.papers.map(row => <div key={row.id} className={clsx(css.directoryRow, row.id === snapshot.selectedId && css.selected)}
              onContextMenu={(event) => { event.preventDefault(); setMenu({ id: row.id, x: event.clientX, y: event.clientY }) }}>
              {renaming === row.id ? <input autoFocus value={name} maxLength={120} aria-label={t('papers.rename')}
                onFocus={(event) => { event.target.select() }} onChange={(event) => { setName(event.target.value) }}
                onBlur={commitRename} onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); commitRename() }
                  if (event.key === 'Escape') setRenaming(null)
                }} /> : <button className={css.directoryButton} aria-label={row.name}
                aria-current={row.id === snapshot.selectedId ? 'page' : undefined}
                onClick={() => { commands.select(row.id) }} onDoubleClick={() => { beginRename(row.id) }}
                onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); beginRename(row.id) } }}>
                <FolderOpen size={17} /><span>{row.name}</span>
                {row.files.length > 0 && <span className={css.readyDot} aria-label={t('papers.uploaded')} />}
              </button>}
              <button type="button" className={css.more} aria-label={t('papers.menu', { name: row.name })} onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setMenu({ id: row.id, x: rect.right, y: rect.bottom })
              }}><MoreHorizontal size={16} /></button>
            </div>)}
            {snapshot.loaded && snapshot.papers.length === 0 && <p className={css.directoryHint}>{t('papers.noPapers')}</p>}
          </div>
          <button type="button" className={css.addQuestion} onClick={() => { void commands.create() }} disabled={snapshot.pending > 0}>
            <Plus size={18} />{t('papers.add')}
          </button>
        </aside>
        <main className={css.editor}>
          {!snapshot.loaded ? <div className={css.empty}>{t('loading')}</div> : selected === undefined ? <div className={css.empty}>
            <BookOpen size={44} /><h2>{t('papers.emptyTitle')}</h2><p>{t('papers.emptyHint')}</p>
            <button type="button" className={css.primary} onClick={() => { void commands.create() }}>
              <Plus size={16} />{t('papers.add')}
            </button>
          </div> : <PaperEditor key={selected.id} paper={selected} snapshot={snapshot} commands={commands}
            transcribeVoice={transcribeVoice} t={t} />}
        </main>
      </div>
      {menu !== null && <div ref={menuRef} role="menu" className={css.menu}
        style={{ '--menu-x': `${Math.min(menu.x, window.innerWidth - 180)}px`, '--menu-y': `${Math.min(menu.y, window.innerHeight - 110)}px` } as CSSProperties}
        onKeyDown={(event) => { if (event.key === 'Escape') setMenu(null) }}>
        <button type="button" role="menuitem" onClick={() => { beginRename(menu.id) }}>{t('papers.rename')}</button>
        <button type="button" role="menuitem" onClick={() => { setDeleting(menu.id); setMenu(null) }}><Trash2 size={15} />{t('delete')}</button>
      </div>}
      {deleting !== null && <PaperDeleteDialog name={snapshot.papers.find(row => row.id === deleting)?.name ?? ''}
        pending={snapshot.pending > 0} onClose={() => { setDeleting(null) }}
        onDelete={() => { void commands.delete(deleting).then(() => { setDeleting(null) }) }} t={t} />}
      {searchOpen && <PaperSearchResults papers={results} query={query}
        onSelect={(id) => { commands.select(id); setSearchOpen(false) }} onClose={() => { setSearchOpen(false) }} t={t} />}
    </div>
  )
}

function PaperEditor({ paper, snapshot, commands, transcribeVoice, t }: PaperCollectionProps & { paper: TeacherPaper }) {
  const upload = useRef<HTMLInputElement>(null)
  const description = useRef<HTMLTextAreaElement>(null)
  const [selectedFile, setSelectedFile] = useState<TeacherPaperSourceId | null>(null)
  const file = paper.files.find(source => source.id === selectedFile) ?? paper.files[0]
  return <div className={css.detail}>
    <section className={clsx(css.panel, paperCss.previewPanel)}>
      <div className={css.panelHeading}><h3><BookOpen size={16} />{t('papers.content')}</h3>
        <button type="button" className={css.textButton} disabled={snapshot.pending > 0} onClick={() => { upload.current?.click() }}>
          <Plus size={16} />{t(paper.files.length > 0 ? 'papers.replace' : 'papers.upload')}
        </button>
      </div>
      <input ref={upload} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.doc,.docx,.caj"
        aria-label={t('papers.upload')} onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) void commands.upload(paper.id, files)
        }} />
      {paper.files.length > 1 && <div className={paperCss.fileTabs} role="tablist" aria-label={t('papers.files')}>
        {paper.files.map(source => <button type="button" key={source.id} role="tab" aria-selected={file?.id === source.id}
          onClick={() => { setSelectedFile(source.id) }}>{source.name}</button>)}
      </div>}
      {file === undefined ? <button type="button" className={css.uploadArea} disabled={snapshot.pending > 0}
        onClick={() => { upload.current?.click() }}><Plus size={32} /><strong>{t('papers.uploadPrompt')}</strong><span>{t('papers.formats')}</span></button>
        : <PaperFilePreview key={file.id} paperId={paper.id} source={file} readFile={commands.readFile} t={t} />}
    </section>
    <section className={clsx(css.panel, css.tagPanel)}>
      <div className={css.panelHeading}><h3><Tag size={16} />{t('papers.tags')}</h3></div>
      <ExampleTags presets={snapshot.tags} selected={paper.tags} pending={snapshot.pending > 0}
        onSelect={tags => commands.update({ id: paper.id, tags })} onAddPreset={commands.addTag} onDeletePreset={commands.deleteTag}
        t={(key, variables) => t(key === 'examples.presetHint' ? 'papers.presetHint' : key, variables)} />
    </section>
    <section className={css.panel}>
      <div className={css.panelHeading}><h3><FileText size={16} />{t('papers.description')}</h3>
        <VoiceInputButton transcribe={transcribeVoice} onTranscript={(text) => { commands.editDraft(paper.id, text) }}
          keyboardInput={{ ref: description, onChange: (text) => { commands.editDraft(paper.id, text) } }} t={t} />
      </div>
      <textarea ref={description} className={css.description} aria-label={t('papers.description')}
        placeholder={t('papers.descriptionPlaceholder')} maxLength={50_000} value={snapshot.drafts[paper.id] ?? paper.description}
        onChange={(event) => { commands.editDraft(paper.id, event.target.value) }} onBlur={() => { void commands.saveDraft(paper.id) }} />
    </section>
  </div>
}

function PaperSearchResults({ papers, query, onSelect, onClose, t }: {
  papers: readonly TeacherPaper[]
  query: string
  onSelect: (id: TeacherPaperId) => void
  onClose: () => void
  t: TeacherWorkbenchTranslate
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close() } }, [])
  return <dialog ref={dialog} className={css.drawer} aria-label={t('papers.searchResults')} onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className={css.drawerInner}>
      <header className={css.drawerHeading}><div className={css.drawerSummary}>
        <h2>{t('papers.searchResults')}</h2><p>{t('papers.searchCount', { count: String(papers.length), query })}</p>
      </div><button type="button" className={css.closeDrawer} aria-label={t('papers.closeSearch')} onClick={onClose}><X size={20} /></button></header>
      <div className={paperCss.results}>
        {papers.length === 0 ? <p className={css.muted}>{t('papers.noResults')}</p> : papers.map(paper => <button type="button"
          key={paper.id} className={paperCss.result} onClick={() => { onSelect(paper.id) }}>
          <strong><FolderOpen size={18} />{paper.name}</strong>
          <span className={css.tagList}>{paper.tags.map(tag => <ExampleTag key={tag} tag={tag} />)}</span>
          <span className={paperCss.resultDescription}>{paper.description || t('papers.noDescription')}</span>
          <span className={css.muted}>{t('papers.fileCount', { count: String(paper.files.length) })}</span>
        </button>)}
      </div>
    </div>
  </dialog>
}

function PaperDeleteDialog({ name, pending, onClose, onDelete, t }: {
  name: string
  pending: boolean
  onClose: () => void
  onDelete: () => void
  t: TeacherWorkbenchTranslate
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close() } }, [])
  return <dialog ref={dialog} className={css.confirm} aria-label={t('papers.deleteTitle')} onCancel={onClose}>
    <h2>{t('papers.deleteTitle')}</h2><p>{t('papers.deleteHint', { name })}</p>
    <div className={paperCss.confirmActions}><button type="button" onClick={onClose}>{t('cancel')}</button>
      <button type="button" className={css.primary} disabled={pending} onClick={onDelete}>{t('delete')}</button></div>
  </dialog>
}
