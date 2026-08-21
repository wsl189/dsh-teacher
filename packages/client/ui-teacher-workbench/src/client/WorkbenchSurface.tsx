/** Teacher-workbench surface mounted directly in the application main area. */

import { useEffect } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { DEFAULT_TEACHER_WORKBENCH_SETTINGS } from '../settings.ts'
import type { TeacherWorkbenchInjected, TeacherWorkbenchCommands } from './contracts.ts'
import type { createTeacherWorkbenchViewStore, TeacherWorkbenchModule } from './view-store.ts'
import type { TeacherWorkbenchKey } from './locales.ts'
import { LessonPreparation } from './LessonPreparation.tsx'
import { DailyManagement } from './DailyManagement.tsx'
import { StudentRoster } from './StudentRoster.tsx'
import { ScoreAnalysis } from './ScoreAnalysis.tsx'
import { TeachingRecords } from './TeachingRecords.tsx'
import { Timetable } from './Timetable.tsx'
import { QuestionWorkbench } from './QuestionWorkbench.tsx'
import css from './TeacherWorkbench.module.css'

/** Full main-surface component props. */
export type WorkbenchSurfaceProps =
  PropsRuntime<'shell.main'>
  & PropsStore<ReturnType<typeof createTeacherWorkbenchViewStore>>
  & PropsLocale<'teacherWorkbench'>
  & InjectFace<TeacherWorkbenchInjected>

const MODULE_LABELS: Record<TeacherWorkbenchModule, TeacherWorkbenchKey> = {
  daily: 'module.daily',
  timetable: 'module.timetable',
  questions: 'module.questions',
  lesson: 'module.lesson',
  students: 'module.students',
  scores: 'module.scores',
  records: 'module.records',
}

/**
 * Render daily management, timetable, and the four teaching modules in the main column.
 * @param props - composed slot props, object-layer hooks, and commands.
 * @returns the active workbench module, or nothing while the workbench is closed.
 */
export function WorkbenchSurface(props: WorkbenchSurfaceProps) {
  const open = props.useStore(state => state.open)
  const active = props.useStore(state => state.active)
  const snapshot = props.useWorkbench(state => state)
  const settings = props.useTeacherSettings(state => state.value ?? DEFAULT_TEACHER_WORKBENCH_SETTINGS)
  useEffect(() => {
    if (open) void props.ensure()
  }, [open, props.ensure])
  useEffect(
    () => props.subscribeSessionNavigation(() => { props.actions.close() }),
    [props.actions, props.subscribeSessionNavigation],
  )

  if (!open) return null

  const commands: TeacherWorkbenchCommands = {
    saveDailyTodo: props.saveDailyTodo,
    toggleDailyTodo: props.toggleDailyTodo,
    deleteDailyTodo: props.deleteDailyTodo,
    saveQuickNote: props.saveQuickNote,
    deleteQuickNote: props.deleteQuickNote,
    saveLedgerCategory: props.saveLedgerCategory,
    deleteLedgerCategory: props.deleteLedgerCategory,
    saveLedgerEntry: props.saveLedgerEntry,
    deleteLedgerEntry: props.deleteLedgerEntry,
    saveCalendarItem: props.saveCalendarItem,
    deleteCalendarItem: props.deleteCalendarItem,
    extractDocument: props.extractDocument,
    normalizeTimetable: props.normalizeTimetable,
    extractQuestionLayout: props.extractQuestionLayout,
    importCalendarItems: props.importCalendarItems,
    saveTimetableEntry: props.saveTimetableEntry,
    deleteTimetableEntry: props.deleteTimetableEntry,
    importTimetableEntries: props.importTimetableEntries,
    saveClass: props.saveClass,
    deleteClass: props.deleteClass,
    saveStudent: props.saveStudent,
    importStudents: props.importStudents,
    deleteStudent: props.deleteStudent,
    createQuestionFolder: props.createQuestionFolder,
    deleteQuestionFolder: props.deleteQuestionFolder,
    saveResource: props.saveResource,
    deleteResource: props.deleteResource,
    saveTemplate: props.saveTemplate,
    deleteTemplate: props.deleteTemplate,
    saveRecord: props.saveRecord,
    toggleRecord: props.toggleRecord,
    deleteRecord: props.deleteRecord,
    saveExam: props.saveExam,
    deleteExam: props.deleteExam,
    saveQuestionBatch: props.saveQuestionBatch,
    readQuestionImage: props.readQuestionImage,
    replaceQuestionImage: props.replaceQuestionImage,
    deleteQuestionImage: props.deleteQuestionImage,
    deleteQuestionBatch: props.deleteQuestionBatch,
    assignQuestions: props.assignQuestions,
    saveTemporaryQuestionSelection: props.saveTemporaryQuestionSelection,
    listTemporaryQuestionSelections: props.listTemporaryQuestionSelections,
    generateQuestionDocument: props.generateQuestionDocument,
    generateUploadedQuestionDocument: props.generateUploadedQuestionDocument,
    generateStudentDocuments: props.generateStudentDocuments,
  }
  const errorKey = snapshot.error?.code === 'revision-conflict'
    ? 'error.revision-conflict'
    : snapshot.error?.code === 'invalid-state'
      ? 'error.invalid-state'
      : 'error.transport'

  return (
    <section className={css.workbenchSurface} role="region" aria-label={props.t('title')} data-workbench-surface>
      <div className={css.workbenchShell}>
        <div className={css.workbenchBody}>
          <main className={clsx(css.workbenchContent, active === 'questions' && css.workbenchContentQuestion)}>
            {active !== 'questions' && active !== 'daily' && (
              <div className={css.contentHeading}>
                <h1>{props.t(MODULE_LABELS[active])}</h1>
                {snapshot.status === 'saving' && <span className={css.savingText}>{props.t('saving')}</span>}
              </div>
            )}
            {snapshot.document === null && snapshot.status !== 'error' && (
              <div className={css.centerState}>{props.t('loading')}</div>
            )}
            {snapshot.error !== null && (
              <div className={css.errorBanner} role="alert">
                <span>{props.t(errorKey)}</span>
                <button type="button" className={css.buttonSecondary} onClick={() => { void props.ensure() }}>
                  <IconRefreshOutline16 />
                  {props.t('retry')}
                </button>
              </div>
            )}
            {snapshot.document !== null && (
              active === 'daily'
                ? <DailyManagement
                  title={props.t(MODULE_LABELS.daily)}
                  savingLabel={snapshot.status === 'saving' ? props.t('saving') : null}
                  state={snapshot.document.state}
                  settings={settings}
                  commands={commands}
                  setWeatherLocation={props.setWeatherLocation}
                  loadWeather={props.loadWeather}
                  t={props.t}
                />
                : active === 'timetable'
                  ? <Timetable
                    state={snapshot.document.state}
                    settings={settings}
                    commands={commands}
                    setTeacherName={props.setTeacherName}
                    t={props.t}
                  />
                  : active === 'questions'
                    ? <QuestionWorkbench state={snapshot.document.state} settings={settings} commands={commands} t={props.t} />
                    : active === 'lesson'
                      ? <LessonPreparation state={snapshot.document.state} commands={commands} t={props.t} />
                      : active === 'students'
                        ? <StudentRoster state={snapshot.document.state} settings={settings} commands={commands} t={props.t} />
                        : active === 'scores'
                          ? <ScoreAnalysis state={snapshot.document.state} settings={settings} commands={commands} t={props.t} />
                          : <TeachingRecords state={snapshot.document.state} commands={commands} t={props.t} />
            )}
          </main>
        </div>
      </div>
    </section>
  )
}
