/** MinerU exam import, class diagnosis, multi-exam tracking, and personal growth. */

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { FileUp } from 'lucide-react'
import type {
  TeacherClassId,
  TeacherExam,
  TeacherExamEntry,
  TeacherExamId,
  TeacherStudentId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import { IconTrashOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import {
  DOCUMENT_IMPORT_ACCEPT,
  documentImportFailureText,
  documentTitleFromFileName,
  shouldEnhanceDocumentImage,
  type DocumentImportState,
} from './document-import.ts'
import { parseScoreImport, summarizeExam } from './import-data.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { confirmDelete, FormField, formatMetric, IconAction } from './shared.tsx'
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
type ScoreImportReview = {
  readonly classId: TeacherClassId
  readonly className: string
  readonly name: string
  readonly date: string
  readonly subjects: readonly string[]
  readonly entries: readonly TeacherExamEntry[]
  readonly unmatched: number
  readonly studentNames: ReadonlyMap<TeacherStudentId, string>
}

/**
 * Render reviewed roster-matched document import and the three analysis views.
 * @param props - durable state, settings, commands, and copy.
 * @returns score-analysis interface.
 */
export function ScoreAnalysis({ state, settings, commands, t }: ScoreAnalysisProps) {
  const classes = useMemo(() => state.classes.filter(item => item.usage === 'roster'), [state.classes])
  const [classId, setClassId] = useState<TeacherClassId | ''>(() => classes[0]?.id ?? '')
  const [examId, setExamId] = useState<TeacherExamId | ''>('')
  const [view, setView] = useState<AnalysisView>('single')
  const [studentId, setStudentId] = useState<TeacherStudentId | ''>('')
  const [importState, setImportState] = useState<DocumentImportState<ScoreImportReview> | null>(null)
  const [unmatched, setUnmatched] = useState(0)
  const importInputRef = useRef<HTMLInputElement | null>(null)

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

  const recognizeScores = async (file: File): Promise<void> => {
    if (classId === '') return
    const targetClass = classes.find(item => item.id === classId)
    if (targetClass === undefined) return
    const targetClassId = classId
    const targetStudents = [...classStudents]
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
    const parsed = parseScoreImport(result.value.markdown, targetStudents)
    if (parsed.error !== null) {
      setImportState({ kind: 'error', fileName: file.name, message: scoreParseFailureText(parsed.error, t) })
      return
    }
    setImportState({
      kind: 'review',
      fileName: file.name,
      value: {
        classId: targetClassId,
        className: targetClass.name,
        name: documentTitleFromFileName(file.name),
        date: new Date().toISOString().slice(0, 10),
        subjects: parsed.subjects,
        entries: parsed.entries,
        unmatched: parsed.unmatched,
        studentNames: new Map(targetStudents.map(student => [student.id, student.name])),
      },
      truncated: result.value.truncated,
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
        <div className={css.toolbarActions}>
          <input
            ref={importInputRef}
            className={css.calendarImportInput}
            type="file"
            accept={DOCUMENT_IMPORT_ACCEPT}
            onChange={(event) => {
              const [file] = [...(event.target.files ?? [])]
              event.target.value = ''
              if (file !== undefined) void recognizeScores(file)
            }}
          />
          <button
            type="button"
            className={css.buttonPrimary}
            disabled={classId === '' || classStudents.length === 0}
            onClick={() => { setUnmatched(0); importInputRef.current?.click() }}
          >
            <FileUp size={16} />
            {t('score.import')}
          </button>
        </div>
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

      {importState !== null && (
        <ScoreImportModal
          state={importState}
          commands={commands}
          t={t}
          onChange={setImportState}
          onImported={(count) => { setUnmatched(count); setImportState(null) }}
          onClose={() => { setImportState(null) }}
        />
      )}
    </div>
  )
}

function ScoreImportModal(props: {
  state: DocumentImportState<ScoreImportReview>
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onChange: (state: DocumentImportState<ScoreImportReview>) => void
  onImported: (unmatched: number) => void
  onClose: () => void
}) {
  const review = props.state.kind === 'review' ? props.state : null
  const update = (change: Pick<Partial<ScoreImportReview>, 'name' | 'date'>): void => {
    if (review === null) return
    props.onChange({ ...review, value: { ...review.value, ...change } })
  }
  const importScores = async (): Promise<void> => {
    if (review === null) return
    const result = await props.commands.saveExam({
      classId: review.value.classId,
      name: review.value.name,
      date: review.value.date,
      entries: [...review.value.entries],
    })
    if (result.ok) props.onImported(review.value.unmatched)
  }
  return (
    <Modal
      open
      title={props.t('score.importTitle')}
      closeLabel={props.t('close')}
      onClose={props.onClose}
      className={`${css.editorDialog} ${css.calendarImportDialog}`}
      footer={review === null ? (
        <button type="button" className={css.buttonPrimary} onClick={props.onClose}>{props.t('close')}</button>
      ) : (
        <>
          <button type="button" className={css.buttonSecondary} onClick={props.onClose}>{props.t('cancel')}</button>
          <button type="button" className={css.buttonPrimary} disabled={review.value.name.trim() === ''} onClick={() => { void importScores() }}>
            {props.t('score.importAction', { count: review.value.entries.length })}
          </button>
        </>
      )}
    >
      {props.state.kind === 'extracting' && (
        <div className={css.calendarImportStatus} role="status">
          <span className={css.calendarImportSpinner} aria-hidden />
          <div><strong>{props.t('score.importExtracting')}</strong><span>{props.state.fileName}</span></div>
        </div>
      )}
      {props.state.kind === 'error' && (
        <div className={css.calendarImportError} role="alert">
          <strong>{props.t('score.importFailed')}</strong>
          <span>{props.state.message}</span>
        </div>
      )}
      {review !== null && (
        <div className={css.calendarImportBody}>
          <div className={css.formGrid}>
            <FormField label={props.t('score.examName')}><input value={review.value.name} onChange={(event) => { update({ name: event.target.value }) }} /></FormField>
            <FormField label={props.t('score.examDate')}><input type="date" value={review.value.date} onChange={(event) => { update({ date: event.target.value }) }} /></FormField>
          </div>
          <div className={css.calendarImportSummary}>
            <div>
              <strong>{review.value.className}</strong>
              <span>{props.t('score.importFound', { file: review.fileName, count: review.value.entries.length })}</span>
            </div>
          </div>
          {review.value.unmatched > 0 && <div className={css.calendarImportWarning}>{props.t('score.unmatched', { count: review.value.unmatched })}</div>}
          {review.truncated && <div className={css.calendarImportWarning}>{props.t('document.importTruncated')}</div>}
          <div className={css.tableScroller}>
            <table className={css.dataTable}>
              <thead><tr><th>{props.t('student.name')}</th>{review.value.subjects.map(subject => <th key={subject}>{subject}</th>)}</tr></thead>
              <tbody>{review.value.entries.map((entry, index) => (
                <tr key={`${entry.studentId}\u0000${String(index)}`}>
                  <td className={css.primaryCell}>{review.value.studentNames.get(entry.studentId) ?? '—'}</td>
                  {review.value.subjects.map(subject => <td key={subject}>{entry.scores[subject] ?? '—'}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

function scoreParseFailureText(error: string, t: TeacherWorkbenchTranslate): string {
  switch (error) {
    case '成绩表至少需要表头和一行成绩数据': return t('score.importMissingTable')
    case '未找到姓名或学号列': return t('score.importMissingIdentity')
    case '没有可导入的成绩行': return t('score.importNoRows')
    default: return error
  }
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
