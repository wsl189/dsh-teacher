/** Independently editable memo panel with manual and voice entry. */

import { useMemo, useState } from 'react'
import { Bell, Pencil, Plus, Trash2 } from 'lucide-react'
import type { TeacherQuickNote, TeacherWorkbenchState } from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import type { TeacherReminderInput } from './controller.ts'
import { editableReminder, ReminderFields, reminderValid } from './ReminderFields.tsx'
import { EditorModal, FormField, IconAction, confirmDelete, type TeacherWorkbenchTranslate } from './shared.tsx'
import { VoiceInputButton } from './SpeechInput.tsx'
import css from './TeacherWorkbench.module.css'

/** Quick-notes panel props. */
export interface QuickNotesPanelProps {
  /** Complete durable workbench state. */
  state: TeacherWorkbenchState
  /** Durable workbench commands. */
  commands: TeacherWorkbenchCommands
  /** Workbench translator. */
  t: TeacherWorkbenchTranslate
}

/**
 * Render the compact memos panel.
 * @param props - durable notes, commands, and copy.
 * @returns a note list with manual and speech-recognition entry.
 */
export function QuickNotesPanel({ state, commands, t }: QuickNotesPanelProps) {
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
          <VoiceInputButton transcribe={commands.transcribeVoice} onTranscript={openVoiceDraft} t={t} />
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
                <small>
                  {new Date(note.updatedAt).toLocaleString()}
                  {note.reminder !== undefined && <Bell size={11} aria-label={t('daily.reminder.enabled')} />}
                </small>
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
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onClose: () => void
}) {
  const [content, setContent] = useState(props.initialContent)
  const [remindAt, setRemindAt] = useState(props.note?.remindAt ?? '')
  const [reminder, setReminder] = useState<TeacherReminderInput | null>(() => editableReminder(props.note?.reminder))
  const save = async (): Promise<void> => {
    const result = await props.commands.saveQuickNote({
      ...(props.note === undefined ? {} : { id: props.note.id }),
      content,
      ...(remindAt === '' && reminder === null && props.note?.reminder === undefined
        ? {}
        : { remindAt, reminder }),
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
      valid={content.trim() !== '' && reminderValid(remindAt, reminder)}
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
            transcribe={props.commands.transcribeVoice}
            onTranscript={(transcript) => {
              setContent(current => current.trim() === '' ? transcript : `${current.trimEnd()}\n${transcript}`)
            }}
            t={props.t}
          />
        </div>
      </div>
      <FormField label={props.t('daily.reminder.deadline')}>
        <input type="datetime-local" value={remindAt} onChange={(event) => { setRemindAt(event.target.value) }} />
      </FormField>
      <ReminderFields deadline={remindAt} value={reminder} commands={props.commands} t={props.t} onChange={setReminder} />
    </EditorModal>
  )
}
