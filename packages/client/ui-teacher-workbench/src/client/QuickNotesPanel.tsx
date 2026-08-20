/** Independently editable quick-note panel with manual and voice entry. */

import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { TeacherQuickNote, TeacherWorkbenchState } from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import { EditorModal, IconAction, confirmDelete, type TeacherWorkbenchTranslate } from './shared.tsx'
import { VoiceInputButton } from './SpeechInput.tsx'
import css from './TeacherWorkbench.module.css'

/** Quick-notes panel props. */
export interface QuickNotesPanelProps {
  /** Complete durable workbench state. */
  state: TeacherWorkbenchState
  /** Voice-recognition settings. */
  settings: TeacherWorkbenchSettings
  /** Durable workbench commands. */
  commands: TeacherWorkbenchCommands
  /** Workbench translator. */
  t: TeacherWorkbenchTranslate
}

/**
 * Render the compact quick-notes panel.
 * @param props - durable notes, voice settings, commands, and copy.
 * @returns a note list with manual and speech-recognition entry.
 */
export function QuickNotesPanel({ state, settings, commands, t }: QuickNotesPanelProps) {
  const [editing, setEditing] = useState<TeacherQuickNote | 'new' | null>(null)
  const [voiceDraft, setVoiceDraft] = useState('')
  const notes = useMemo(
    () => [...state.quickNotes].sort((left, right) => right.updatedAt - left.updatedAt),
    [state.quickNotes],
  )
  const openVoiceDraft = (transcript: string): void => {
    setVoiceDraft(transcript)
    setEditing('new')
  }
  return (
    <section className={`${css.dailyPanel} ${css.notesPanel}`} aria-labelledby="daily-notes-title">
      <header className={css.dailyPanelHeader}>
        <div>
          <h2 id="daily-notes-title">{t('daily.notes.title')}</h2>
          <span>{t('daily.notes.count', { count: notes.length })}</span>
        </div>
        <div className={css.dailyPanelActions}>
          <VoiceInputButton language={settings.speechLanguage} onTranscript={openVoiceDraft} t={t} />
          <button
            type="button"
            className={css.dailyIconButton}
            aria-label={t('daily.notes.add')}
            title={t('daily.notes.add')}
            onClick={() => { setVoiceDraft(''); setEditing('new') }}
          >
            <Plus size={17} />
          </button>
        </div>
      </header>
      <div className={css.noteList}>
        {notes.length === 0
          ? <div className={css.dailyEmpty}>{t('daily.notes.empty')}</div>
          : notes.map(note => (
            <article key={note.id} className={css.noteItem}>
              <button type="button" className={css.noteMain} onClick={() => { setEditing(note) }}>
                <span>{note.content}</span>
                <small>{new Date(note.updatedAt).toLocaleString()}</small>
              </button>
              <div className={css.dailyRowActions}>
                <IconAction label={t('edit')} onClick={() => { setEditing(note) }}><Pencil size={15} /></IconAction>
                <IconAction
                  label={t('delete')}
                  danger
                  onClick={() => { if (confirmDelete(t)) void commands.deleteQuickNote(note.id) }}
                >
                  <Trash2 size={15} />
                </IconAction>
              </div>
            </article>
          ))}
      </div>
      {editing !== null && (
        <NoteEditor
          note={editing === 'new' ? undefined : editing}
          initialContent={editing === 'new' ? voiceDraft : editing.content}
          language={settings.speechLanguage}
          commands={commands}
          t={t}
          onClose={() => { setEditing(null) }}
        />
      )}
    </section>
  )
}

function NoteEditor(props: {
  note: TeacherQuickNote | undefined
  initialContent: string
  language: string
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onClose: () => void
}) {
  const [content, setContent] = useState(props.initialContent)
  const save = async (): Promise<void> => {
    const result = await props.commands.saveQuickNote({
      ...(props.note === undefined ? {} : { id: props.note.id }),
      content,
    })
    if (result.ok) props.onClose()
  }
  return (
    <EditorModal
      open
      title={props.note === undefined ? props.t('daily.notes.add') : props.t('daily.notes.edit')}
      closeLabel={props.t('close')}
      onClose={props.onClose}
      onSave={() => { void save() }}
      saveLabel={props.t('save')}
      cancelLabel={props.t('cancel')}
      valid={content.trim() !== ''}
    >
      <div className={css.fieldWide}>
        <span className={css.fieldLabel}>{props.t('daily.notes.content')}</span>
        <div className={css.voiceTextareaField}>
          <textarea
            aria-label={props.t('daily.notes.content')}
            autoFocus
            rows={8}
            maxLength={4000}
            value={content}
            placeholder={props.t('daily.notes.placeholder')}
            onChange={(event) => { setContent(event.target.value) }}
          />
          <VoiceInputButton
            language={props.language}
            onTranscript={(transcript) => {
              setContent(current => current.trim() === '' ? transcript : `${current.trimEnd()}\n${transcript}`)
            }}
            t={props.t}
          />
        </div>
      </div>
    </EditorModal>
  )
}
