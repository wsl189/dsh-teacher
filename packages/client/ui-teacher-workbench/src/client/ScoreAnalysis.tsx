/** Exam import, class diagnosis, multi-exam tracking, and personal growth. */

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type {
  TeacherClassId,
  TeacherExam,
  TeacherExamId,
  TeacherStudentId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import { IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import { parseScoreImport, summarizeExam } from './import-data.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { confirmDelete, EditorModal, FormField, formatMetric, IconAction } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Score-analysis module props. */
export interface ScoreAnalysisProps {
  /** Current durable state. */
  state: TeacherWorkbenchState
  /** Score thresholds and full mark. */
  settings: TeacherWorkbenchSettings
  /** Durable mutation commands. */
  commands: TeacherWorkbenchCommands
  /** Namespace translator. */
  t: TeacherWorkbenchTranslate
}

type AnalysisView = 'single' | 'multiple' | 'personal'
type ExamDraft = { name: string; date: string; text: string }

/**
 * Render roster-matched exam import and the three migrated analysis views.
 * @param props - durable state, settings, commands, and copy.
 * @returns score-analysis interface.
 */
export function ScoreAnalysis({ state, settings, commands, t }: ScoreAnalysisProps) {
  const classes = useMemo(() => state.classes.filter(item => item.usage === 'roster'), [state.classes])
  const [classId, setClassId] = useState<TeacherClassId | ''>(() => classes[0]?.id ?? '')
  const [examId, setExamId] = useState<TeacherExamId | ''>('')
  const [view, setView] = useState<AnalysisView>('single')
  const [studentId, setStudentId] = useState<TeacherStudentId | ''>('')
  const [examDraft, setExamDraft] = useState<ExamDraft | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [unmatched, setUnmatched] = useState(0)

  const classExams = useMemo(
    () => state.exams.filter(exam => exam.classId === classId),
    [classId, state.exams],
  )
  const classStudents = useMemo(
    () => state.students.filter(student => student.classId === classId),
    [classId, state.students],
  )

  useEffect(() => {
    if (classId !== '' && classes.some(item => item.id === classId)) return
    setClassId(classes[0]?.id ?? '')
  }, [classId, classes])
  useEffect(() => {
    if (examId !== '' && classExams.some(item => item.id === examId)) return
    setExamId(classExams[classExams.length - 1]?.id ?? '')
  }, [classExams, examId])
  useEffect(() => {
    if (studentId !== '' && classStudents.some(item => item.id === studentId)) return
    setStudentId(classStudents[0]?.id ?? '')
  }, [classStudents, studentId])

  const exam = classExams.find(item => item.id === examId)
  const summary = exam === undefined ? undefined : summarizeExam(exam, settings.passScore, settings.excellentScore)
  const studentName = new Map(state.students.map(item => [item.id, item.name]))

  const importExam = (draft: ExamDraft): void => {
    if (classId === '') return
    const parsed = parseScoreImport(draft.text, classStudents)
    if (parsed.error !== null) {
      setImportError(parsed.error)
      return
    }
    setUnmatched(parsed.unmatched)
    void commands.saveExam({
      classId,
      name: draft.name,
      date: draft.date,
      entries: parsed.entries,
    }).then((result) => {
      if (result.ok) {
        setExamDraft(null)
        setImportError(null)
      }
    })
  }

  return (
    <div className={css.module}>
      <div className={css.moduleToolbar}>
        <div className={css.inlineControls}>
          <select className={css.select} aria-label={t('class.select')} value={classId} onChange={(event) => { setClassId(event.target.value as TeacherClassId) }}>
            {classes.length === 0 && <option value="">{t('class.select')}</option>}
            {classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className={css.select} aria-label={t('score.exam')} value={examId} onChange={(event) => { setExamId(event.target.value as TeacherExamId) }}>
            {classExams.length === 0 && <option value="">{t('score.noExam')}</option>}
            {classExams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {exam !== undefined && (
            <IconAction
              label={t('delete')}
              danger
              onClick={() => { if (confirmDelete(t)) void commands.deleteExam(exam.id) }}
            >
              <IconTrashOutline16 />
            </IconAction>
          )}
        </div>
        <button
          type="button"
          className={css.buttonPrimary}
          disabled={classId === '' || classStudents.length === 0}
          onClick={() => { setExamDraft({ name: '', date: new Date().toISOString().slice(0, 10), text: '' }); setImportError(null); setUnmatched(0) }}
        >
          <IconPlusOutline16 />
          {t('score.import')}
        </button>
      </div>

      <div className={css.segmented} role="tablist" aria-label={t('module.scores')}>
        {(['single', 'multiple', 'personal'] as const).map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={clsx(css.segment, view === id && css.segmentActive)}
            onClick={() => { setView(id) }}
          >
            {t(`score.${id}`)}
          </button>
        ))}
      </div>

      {classExams.length === 0
        ? <div className={css.emptyState}>{t('score.noExam')}</div>
        : view === 'single' && exam !== undefined && summary !== undefined
          ? <SingleExam exam={exam} summary={summary} studentName={studentName} t={t} />
          : view === 'multiple'
            ? <ExamTracking exams={classExams} settings={settings} t={t} />
            : (
              <PersonalGrowth
                exams={classExams}
                students={classStudents}
                studentId={studentId}
                onStudent={setStudentId}
                settings={settings}
                t={t}
              />
            )}

      {unmatched > 0 && <div className={css.notice}>{t('score.unmatched', { count: unmatched })}</div>}

      {examDraft !== null && (
        <EditorModal
          open
          title={t('score.importTitle')}
          closeLabel={t('close')}
          saveLabel={t('score.import')}
          cancelLabel={t('cancel')}
          onClose={() => { setExamDraft(null); setImportError(null) }}
          onSave={() => { importExam(examDraft) }}
          valid={examDraft.name.trim() !== '' && examDraft.text.trim() !== ''}
        >
          <>
            <FormField label={t('score.examName')}><input value={examDraft.name} onChange={(event) => { setExamDraft({ ...examDraft, name: event.target.value }) }} /></FormField>
            <FormField label={t('score.examDate')}><input type="date" value={examDraft.date} onChange={(event) => { setExamDraft({ ...examDraft, date: event.target.value }) }} /></FormField>
            <FormField label={t('score.import')} wide><textarea rows={10} value={examDraft.text} onChange={(event) => { setExamDraft({ ...examDraft, text: event.target.value }); setImportError(null) }} /></FormField>
            {importError !== null && <div className={css.formError} role="alert">{importError}</div>}
          </>
        </EditorModal>
      )}
    </div>
  )
}

function SingleExam({ exam, summary, studentName, t }: {
  exam: TeacherExam
  summary: ReturnType<typeof summarizeExam>
  studentName: ReadonlyMap<TeacherStudentId, string>
  t: TeacherWorkbenchTranslate
}) {
  const entryByStudent = new Map(exam.entries.map(entry => [entry.studentId, entry]))
  return (
    <>
      <div className={css.metricGrid}>
        <Metric label={t('score.average')} value={formatMetric(summary.average)} />
        <Metric label={t('score.highest')} value={formatMetric(summary.highest)} />
        <Metric label={t('score.lowest')} value={formatMetric(summary.lowest)} />
        <Metric label={t('score.passRate')} value={formatMetric(summary.passRate, '%')} />
        <Metric label={t('score.excellentRate')} value={formatMetric(summary.excellentRate, '%')} />
      </div>
      <div className={css.tableScroller}>
        <table className={css.dataTable}>
          <thead><tr><th>{t('student.name')}</th>{summary.subjects.map(subject => <th key={subject}>{subject}</th>)}<th>{t('score.total')}</th><th>{t('score.rank')}</th></tr></thead>
          <tbody>
            {[...summary.students].sort((left, right) => left.rank - right.rank).map(row => (
              <tr key={row.studentId}>
                <td className={css.primaryCell}>{studentName.get(row.studentId) ?? '—'}</td>
                {summary.subjects.map(subject => <td key={subject}>{entryByStudent.get(row.studentId)?.scores[subject] ?? '—'}</td>)}
                <td>{formatMetric(row.total)}</td>
                <td>{row.rank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ExamTracking({ exams, settings, t }: {
  exams: readonly TeacherExam[]
  settings: TeacherWorkbenchSettings
  t: TeacherWorkbenchTranslate
}) {
  return (
    <div className={css.trendList}>
      {exams.map((exam) => {
        const summary = summarizeExam(exam, settings.passScore, settings.excellentScore)
        const subjects = Math.max(1, summary.subjects.length)
        const width = Math.min(100, summary.average / (settings.scoreFullMark * subjects) * 100)
        return (
          <div key={exam.id} className={css.trendRow}>
            <div className={css.trendMeta}><strong>{exam.name}</strong><span>{exam.date || '—'}</span></div>
            <div className={css.trendTrack}><span style={{ width: `${width}%` }} /></div>
            <div className={css.trendValue}>{t('score.average')} {formatMetric(summary.average)}</div>
          </div>
        )
      })}
    </div>
  )
}

function PersonalGrowth({ exams, students, studentId, onStudent, settings, t }: {
  exams: readonly TeacherExam[]
  students: readonly { id: TeacherStudentId; name: string }[]
  studentId: TeacherStudentId | ''
  onStudent: (id: TeacherStudentId) => void
  settings: TeacherWorkbenchSettings
  t: TeacherWorkbenchTranslate
}) {
  return (
    <div className={css.personalPane}>
      <select className={css.select} aria-label={t('score.selectStudent')} value={studentId} onChange={(event) => { onStudent(event.target.value as TeacherStudentId) }}>
        {students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}
      </select>
      <div className={css.trendList}>
        {exams.map((exam) => {
          const entry = exam.entries.find(item => item.studentId === studentId)
          const subjects = entry === undefined ? [] : Object.values(entry.scores)
          const total = subjects.reduce((sum, value) => sum + value, 0)
          const width = subjects.length === 0 ? 0 : Math.min(100, total / (settings.scoreFullMark * subjects.length) * 100)
          return (
            <div key={exam.id} className={css.trendRow}>
              <div className={css.trendMeta}><strong>{exam.name}</strong><span>{exam.date || '—'}</span></div>
              <div className={css.trendTrack}><span style={{ width: `${width}%` }} /></div>
              <div className={css.trendValue}>{entry === undefined ? '—' : formatMetric(total)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className={css.metric}><span>{label}</span><strong>{value}</strong></div>
}
