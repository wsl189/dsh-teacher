/** Class and student roster management with MinerU document import. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import type {
  TeacherClassId,
  TeacherStudent,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconEditOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import {
  DOCUMENT_IMPORT_ACCEPT,
  documentImportFailureText,
  shouldEnhanceDocumentImage,
  type DocumentImportState,
} from './document-import.ts'
import { parseStudentImport, type StudentImportRow } from './import-data.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { confirmDelete, EditorModal, FormField, IconAction } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Student-roster module props. */
export interface StudentRosterProps {
  /** Current durable state. */
  state: TeacherWorkbenchState
  /** Teacher-workbench settings. */
  settings: TeacherWorkbenchSettings
  /** Durable mutation commands. */
  commands: TeacherWorkbenchCommands
  /** Namespace translator. */
  t: TeacherWorkbenchTranslate
}

type ClassDraft = { id?: TeacherClassId; name: string; grade: string; subject: string }
type StudentDraft = Omit<TeacherStudent, 'id' | 'classId'> & { id?: TeacherStudent['id'] }
type RosterImportReview = {
  readonly classId: TeacherClassId
  readonly className: string
  readonly rows: readonly StudentImportRow[]
}

const EMPTY_STUDENT: StudentDraft = {
  name: '',
  studentNumber: '',
  gender: '',
  guardian: '',
  relation: '',
  phone: '',
  address: '',
  extras: {},
}

/**
 * Render class CRUD, roster CRUD/search, and reviewed MinerU document import.
 * @param props - durable state, settings, commands, and copy.
 * @returns the student-roster interface.
 */
export function StudentRoster({ state, settings, commands, t }: StudentRosterProps) {
  const classes = useMemo(() => state.classes.filter(item => item.usage === 'roster'), [state.classes])
  const [classId, setClassId] = useState<TeacherClassId | ''>(() => classes[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [classDraft, setClassDraft] = useState<ClassDraft | null>(null)
  const [studentDraft, setStudentDraft] = useState<StudentDraft | null>(null)
  const [importState, setImportState] = useState<DocumentImportState<RosterImportReview> | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (classId !== '' && classes.some(item => item.id === classId)) return
    setClassId(classes[0]?.id ?? '')
  }, [classId, classes])

  const selectedClass = classes.find(item => item.id === classId)
  const students = useMemo(() => {
    const query = search.trim().toLowerCase()
    return state.students.filter(student => student.classId === classId && (
      query === ''
      || student.name.toLowerCase().includes(query)
      || student.studentNumber.toLowerCase().includes(query)
      || student.guardian.toLowerCase().includes(query)
    ))
  }, [classId, search, state.students])

  const saveClass = (draft: ClassDraft): void => {
    void commands.saveClass({ ...draft, usage: 'roster' }).then((result) => { if (result.ok) setClassDraft(null) })
  }
  const saveStudent = (draft: StudentDraft): void => {
    if (classId === '') return
    void commands.saveStudent({ ...draft, classId }).then((result) => { if (result.ok) setStudentDraft(null) })
  }
  const recognizeRoster = async (file: File): Promise<void> => {
    if (classId === '' || selectedClass === undefined) return
    const targetClassId = classId
    const targetClassName = selectedClass.name
    setImportState({ kind: 'extracting', fileName: file.name })
    const result = await commands.extractDocument(file, {
      enhanceImageDetail: shouldEnhanceDocumentImage(file),
    })
    if (!result.ok) {
      setImportState({
        kind: 'error',
        fileName: file.name,
        message: documentImportFailureText(result.error.code, result.error.message, t),
      })
      return
    }
    const parsed = parseStudentImport(result.value.markdown)
    if (parsed.error !== null) {
      setImportState({ kind: 'error', fileName: file.name, message: rosterParseFailureText(parsed.error, t) })
      return
    }
    setImportState({
      kind: 'review',
      fileName: file.name,
      value: { classId: targetClassId, className: targetClassName, rows: parsed.rows },
      truncated: result.value.truncated,
    })
  }

  return (
    <div className={css.module}>
      <div className={css.moduleToolbar}>
        <div className={css.inlineControls}>
          <select
            className={css.select}
            aria-label={t('class.select')}
            value={classId}
            onChange={(event) => { setClassId(event.target.value as TeacherClassId) }}
          >
            {classes.length === 0 && <option value="">{t('class.select')}</option>}
            {classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button
            type="button"
            className={css.buttonSecondary}
            onClick={() => { setClassDraft({ name: '', grade: '', subject: settings.defaultSubject }) }}
          >
            <IconPlusOutline16 />
            {t('class.add')}
          </button>
          {selectedClass !== undefined && (
            <>
              <IconAction label={t('class.edit')} onClick={() => { setClassDraft({ ...selectedClass }) }}>
                <IconEditOutline16 />
              </IconAction>
              <IconAction
                label={t('delete')}
                danger
                onClick={() => { if (confirmDelete(t)) void commands.deleteClass(selectedClass.id) }}
              >
                <IconTrashOutline16 />
              </IconAction>
            </>
          )}
        </div>
        <div className={css.toolbarActions}>
          <input
            ref={importInputRef}
            className={css.calendarImportInput}
            type="file"
            accept={DOCUMENT_IMPORT_ACCEPT}
            onChange={(event) => {
              const [file] = [...(event.target.files ?? [])]
              event.target.value = ''
              if (file !== undefined) void recognizeRoster(file)
            }}
          />
          <button
            type="button"
            className={css.buttonSecondary}
            disabled={classId === ''}
            onClick={() => { importInputRef.current?.click() }}
          >
            <FileUp size={16} />
            {t('student.import')}
          </button>
          <button
            type="button"
            className={css.buttonPrimary}
            disabled={classId === ''}
            onClick={() => { setStudentDraft({ ...EMPTY_STUDENT }) }}
          >
            <IconPlusOutline16 />
            {t('student.add')}
          </button>
        </div>
      </div>

      {selectedClass === undefined
        ? <div className={css.emptyState}>{t('class.add')}</div>
        : (
          <>
            <div className={css.listHeader}>
              <div>
                <h3>{selectedClass.name}</h3>
                <span>{t('students.count', { count: state.students.filter(item => item.classId === classId).length })}</span>
              </div>
              <label className={css.searchBox}>
                <IconSearchOutline16 />
                <input
                  aria-label={t('student.search')}
                  placeholder={t('student.search')}
                  value={search}
                  onChange={(event) => { setSearch(event.target.value) }}
                />
              </label>
            </div>
            <div className={css.tableScroller}>
              <table className={css.dataTable}>
                <thead>
                  <tr>
                    <th>{t('student.number')}</th>
                    <th>{t('student.name')}</th>
                    <th>{t('student.gender')}</th>
                    <th>{t('student.guardian')}</th>
                    <th>{t('student.phone')}</th>
                    <th aria-label={t('edit')} />
                  </tr>
                </thead>
                <tbody>
                  {students.map(student => (
                    <tr key={student.id}>
                      <td>{student.studentNumber || '—'}</td>
                      <td className={css.primaryCell}>{student.name}</td>
                      <td>{student.gender || '—'}</td>
                      <td>{student.guardian || '—'}</td>
                      <td>{student.phone || '—'}</td>
                      <td>
                        <div className={css.rowActions}>
                          <IconAction label={t('edit')} onClick={() => { setStudentDraft({ ...student }) }}>
                            <IconEditOutline16 />
                          </IconAction>
                          <IconAction
                            label={t('delete')}
                            danger
                            onClick={() => { if (confirmDelete(t)) void commands.deleteStudent(student.id) }}
                          >
                            <IconTrashOutline16 />
                          </IconAction>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {students.length === 0 && <div className={css.emptyState}>{t('empty')}</div>}
            </div>
          </>
        )}

      {classDraft !== null && (
        <EditorModal
          open
          title={t(classDraft.id === undefined ? 'class.add' : 'class.edit')}
          closeLabel={t('close')}
          saveLabel={t('save')}
          cancelLabel={t('cancel')}
          onClose={() => { setClassDraft(null) }}
          onSave={() => { saveClass(classDraft) }}
          valid={classDraft.name.trim() !== ''}
        >
          <>
            <FormField label={t('class.name')} wide><input value={classDraft.name} onChange={(event) => { setClassDraft({ ...classDraft, name: event.target.value }) }} /></FormField>
            <FormField label={t('class.grade')}><input value={classDraft.grade} onChange={(event) => { setClassDraft({ ...classDraft, grade: event.target.value }) }} /></FormField>
            <FormField label={t('class.subject')}><input value={classDraft.subject} onChange={(event) => { setClassDraft({ ...classDraft, subject: event.target.value }) }} /></FormField>
          </>
        </EditorModal>
      )}

      {studentDraft !== null && (
        <EditorModal
          open
          title={t(studentDraft.id === undefined ? 'student.add' : 'student.edit')}
          closeLabel={t('close')}
          saveLabel={t('save')}
          cancelLabel={t('cancel')}
          onClose={() => { setStudentDraft(null) }}
          onSave={() => { saveStudent(studentDraft) }}
          valid={studentDraft.name.trim() !== ''}
        >
          <>
            <FormField label={t('student.name')}><input value={studentDraft.name} onChange={(event) => { setStudentDraft({ ...studentDraft, name: event.target.value }) }} /></FormField>
            <FormField label={t('student.number')}><input value={studentDraft.studentNumber} onChange={(event) => { setStudentDraft({ ...studentDraft, studentNumber: event.target.value }) }} /></FormField>
            <FormField label={t('student.gender')}><input value={studentDraft.gender} onChange={(event) => { setStudentDraft({ ...studentDraft, gender: event.target.value }) }} /></FormField>
            <FormField label={t('student.guardian')}><input value={studentDraft.guardian} onChange={(event) => { setStudentDraft({ ...studentDraft, guardian: event.target.value }) }} /></FormField>
            <FormField label={t('student.relation')}><input value={studentDraft.relation} onChange={(event) => { setStudentDraft({ ...studentDraft, relation: event.target.value }) }} /></FormField>
            <FormField label={t('student.phone')}><input value={studentDraft.phone} onChange={(event) => { setStudentDraft({ ...studentDraft, phone: event.target.value }) }} /></FormField>
            <FormField label={t('student.address')} wide><input value={studentDraft.address} onChange={(event) => { setStudentDraft({ ...studentDraft, address: event.target.value }) }} /></FormField>
          </>
        </EditorModal>
      )}

      {importState !== null && (
        <RosterImportModal
          state={importState}
          commands={commands}
          t={t}
          onClose={() => { setImportState(null) }}
        />
      )}
    </div>
  )
}

function RosterImportModal(props: {
  state: DocumentImportState<RosterImportReview>
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onClose: () => void
}) {
  const review = props.state.kind === 'review' ? props.state : null
  const importRows = async (): Promise<void> => {
    if (review === null) return
    const result = await props.commands.importStudents(review.value.classId, review.value.rows)
    if (result.ok) props.onClose()
  }
  return (
    <Modal
      open
      title={props.t('student.importTitle')}
      closeLabel={props.t('close')}
      onClose={props.onClose}
      className={`${css.editorDialog} ${css.calendarImportDialog}`}
      footer={review === null ? (
        <button type="button" className={css.buttonPrimary} onClick={props.onClose}>{props.t('close')}</button>
      ) : (
        <>
          <button type="button" className={css.buttonSecondary} onClick={props.onClose}>{props.t('cancel')}</button>
          <button type="button" className={css.buttonPrimary} onClick={() => { void importRows() }}>
            {props.t('student.importAction', { count: review.value.rows.length })}
          </button>
        </>
      )}
    >
      {props.state.kind === 'extracting' && (
        <div className={css.calendarImportStatus} role="status">
          <span className={css.calendarImportSpinner} aria-hidden />
          <div><strong>{props.t('student.importExtracting')}</strong><span>{props.state.fileName}</span></div>
        </div>
      )}
      {props.state.kind === 'error' && (
        <div className={css.calendarImportError} role="alert">
          <strong>{props.t('student.importFailed')}</strong>
          <span>{props.state.message}</span>
        </div>
      )}
      {review !== null && (
        <div className={css.calendarImportBody}>
          <div className={css.calendarImportSummary}>
            <div>
              <strong>{review.value.className}</strong>
              <span>{props.t('student.importFound', { file: review.fileName, count: review.value.rows.length })}</span>
            </div>
          </div>
          {review.truncated && <div className={css.calendarImportWarning}>{props.t('document.importTruncated')}</div>}
          <div className={css.tableScroller}>
            <table className={css.dataTable}>
              <thead><tr><th>{props.t('student.number')}</th><th>{props.t('student.name')}</th><th>{props.t('student.gender')}</th><th>{props.t('student.guardian')}</th><th>{props.t('student.phone')}</th></tr></thead>
              <tbody>{review.value.rows.map((row, index) => (
                <tr key={`${row.studentNumber}\u0000${row.name}\u0000${String(index)}`}>
                  <td>{row.studentNumber || '—'}</td>
                  <td className={css.primaryCell}>{row.name}</td>
                  <td>{row.gender || '—'}</td>
                  <td>{row.guardian || '—'}</td>
                  <td>{row.phone || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

function rosterParseFailureText(error: string, t: TeacherWorkbenchTranslate): string {
  switch (error) {
    case '名册至少需要表头和一行学生数据': return t('student.importMissingTable')
    case '未找到姓名列': return t('student.importMissingName')
    case '没有可导入的学生行': return t('student.importNoRows')
    default: return error
  }
}
