/** Timetable views with a shared normal catalog and an independent grade catalog. */

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, FileUp, Plus } from 'lucide-react'
import { IconTrashOutline16, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  TeacherClass,
  TeacherClassId,
  TeacherTimetableEntry,
  TeacherTimetableClassUsage,
  TeacherTimetableEntryKind,
  TeacherWeekday,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import {
  isPlausibleClassName,
  parseTimetable,
  type TimetableImportDefaults,
  type TimetableImportDraft,
} from './timetable-import.ts'
import { EditorModal, FormField, IconAction, type TeacherWorkbenchTranslate } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

type TimetableView = 'today' | 'week' | 'grade' | 'study'

const CLASS_NAME_COLLATOR = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

type TimetableImportState =
  | { readonly kind: 'extracting'; readonly fileName: string; readonly context: TimetableImportContext }
  | { readonly kind: 'normalizing'; readonly fileName: string; readonly context: TimetableImportContext }
  | { readonly kind: 'review'; readonly fileName: string; readonly context: TimetableImportContext; readonly items: readonly TimetableImportDraft[]; readonly truncated: boolean }
  | { readonly kind: 'error'; readonly fileName: string; readonly context: TimetableImportContext; readonly message: string }

interface TimetableImportContext {
  readonly classes: readonly TeacherClass[]
  readonly defaults: TimetableRecognitionDefaults
  readonly usage: TeacherTimetableClassUsage
}

type TimetableRecognitionDefaults = TimetableImportDefaults & {
  readonly target: 'class' | 'grade' | 'study'
}

interface EditorRequest {
  readonly entry?: TeacherTimetableEntry
  readonly className: string
  readonly grade: string
  readonly kind: TeacherTimetableEntryKind
  readonly weekday: TeacherWeekday
  readonly period: number
}

type ClassDraft = Pick<TeacherClass, 'name' | 'grade'>

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const satisfies readonly TeacherWeekday[]
const VIEWS = ['today', 'week', 'grade', 'study'] as const satisfies readonly TimetableView[]
const VIEW_KEYS = {
  today: 'timetable.view.today',
  week: 'timetable.view.week',
  grade: 'timetable.view.grade',
  study: 'timetable.view.study',
} as const
const KIND_KEYS = {
  lesson: 'timetable.kind.lesson',
  morningStudy: 'timetable.kind.morningStudy',
  eveningStudy: 'timetable.kind.eveningStudy',
} as const

/** Course-table module props. */
export interface TimetableProps {
  /** Complete durable workbench state. */
  state: TeacherWorkbenchState
  /** Durable teacher identity settings. */
  settings: TeacherWorkbenchSettings
  /** Durable workbench commands. */
  commands: TeacherWorkbenchCommands
  /** Persist the editable teacher filter in dsh settings. */
  setTeacherName: (name: string) => Promise<void>
  /** Workbench translator. */
  t: TeacherWorkbenchTranslate
}

/**
 * Render Today, Week, and Study over one catalog plus an independent Grade catalog.
 * @param props - durable data, teacher identity, commands, and copy.
 * @returns scoped schedule views with editing and OCR review.
 */
export function Timetable(props: TimetableProps) {
  const [view, setView] = useState<TimetableView>('today')
  const [selectedClassId, setSelectedClassId] = useState<TeacherClassId | ''>('')
  const [selectedGrade, setSelectedGrade] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [teacherFilterName, setTeacherFilterName] = useState(props.settings.teacherName)
  const [editing, setEditing] = useState<EditorRequest | null>(null)
  const [classDraft, setClassDraft] = useState<ClassDraft | null>(null)
  const [importState, setImportState] = useState<TimetableImportState | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    setTeacherFilterName(props.settings.teacherName)
  }, [props.settings.teacherName])
  const today = useMemo(() => new Date(), [])
  const currentWeekday = browserWeekday(today)
  const usage = timetableClassUsage(view)
  const classes = useMemo(
    () => props.state.classes
      .filter(item => item.usage === usage)
      .sort((left, right) => (
        CLASS_NAME_COLLATOR.compare(left.grade, right.grade) || CLASS_NAME_COLLATOR.compare(left.name, right.name)
      )),
    [props.state.classes, usage],
  )
  const selectedClass = classes.find(item => item.id === selectedClassId) ?? classes[0]
  const grades = useMemo(() => [...new Set(classes.map(item => item.grade))], [classes])
  const activeGrade = grades.includes(selectedGrade) ? selectedGrade : grades[0] ?? ''
  const gradeClasses = classes.filter(item => item.grade === activeGrade)
  const classMap = useMemo(() => new Map(classes.map(item => [item.id, item])), [classes])
  const areaEntries = props.state.timetableEntries.filter(item => classMap.has(item.classId))
  const lessons = areaEntries.filter(item => item.kind === 'lesson')
  const teacherName = normalizeTeacherName(teacherFilterName)
  const personal = (entry: TeacherTimetableEntry): boolean => (
    teacherName !== '' && normalizeTeacherName(entry.teacherName) === teacherName
  )
  const todayEntries = lessons
    .filter(item => item.weekday === currentWeekday)
    .filter(item => onlyMine ? personal(item) : item.classId === selectedClass?.id)
    .sort(entryOrder)
  const weekEntries = lessons
    .filter(item => onlyMine ? personal(item) : item.classId === selectedClass?.id)
    .sort(entryOrder)
  const gradeEntries = lessons
    .filter(item => gradeClasses.some(candidate => candidate.id === item.classId))
    .sort(entryOrder)
  const studyEntries = areaEntries
    .filter(item => item.kind !== 'lesson' && item.classId === selectedClass?.id)
    .sort(entryOrder)
  const openEditor = (entry?: TeacherTimetableEntry, overrides: Partial<EditorRequest> = {}): void => {
    const owner = entry === undefined ? selectedClass ?? gradeClasses[0] : classMap.get(entry.classId)
    setEditing({
      ...(entry === undefined ? {} : { entry }),
      className: owner?.name ?? '',
      grade: owner?.grade ?? activeGrade,
      kind: entry?.kind ?? (view === 'study' ? 'morningStudy' : 'lesson'),
      weekday: entry?.weekday ?? (view === 'today' ? currentWeekday : 1),
      period: entry?.period ?? 1,
      ...overrides,
    })
  }
  const importDefaults = (): TimetableRecognitionDefaults => ({
    className: view === 'grade' || (onlyMine && (view === 'today' || view === 'week')) ? '' : selectedClass?.name ?? '',
    classNames: classes
      .filter(item => item.grade === (view === 'grade' ? activeGrade : selectedClass?.grade))
      .map(item => item.name),
    grade: view === 'grade' ? activeGrade : selectedClass?.grade ?? '',
    kind: view === 'study' ? 'morningStudy' : 'lesson',
    target: view === 'grade' ? 'grade' : view === 'study' ? 'study' : 'class',
    teacherName: view === 'grade' || view === 'study' ? '' : props.settings.teacherName,
  })
  const recognizeTimetable = async (file: File): Promise<void> => {
    const context: TimetableImportContext = { classes, defaults: importDefaults(), usage }
    const directImage = file.type === 'image/png'
      || file.type === 'image/jpeg'
      || file.type === 'image/webp'
      || file.type === 'image/gif'
    setImportState({ kind: 'extracting', fileName: file.name, context })
    const result = await props.commands.extractDocument(file, {
      includeDiscardedText: true,
      enhanceImageDetail: directImage,
    })
    if (!result.ok) {
      setImportState({
        kind: 'error',
        fileName: file.name,
        context,
        message: importFailureText(result.error.code, result.error.message, props.t),
      })
      return
    }
    const ruleItems = parseTimetable(result.value.markdown, context.defaults)
    if (ruleItems.length > 0) {
      setImportState({
        kind: 'review',
        fileName: file.name,
        context,
        items: ruleItems,
        truncated: result.value.truncated,
      })
      return
    }
    setImportState({ kind: 'normalizing', fileName: file.name, context })
    const normalized = await props.commands.normalizeTimetable(
      file.name,
      result.value.markdown,
      context.defaults,
    )
    if (!normalized.ok) {
      setImportState({
        kind: 'error',
        fileName: file.name,
        context,
        message: normalizeFailureText(normalized.error.code, normalized.error.message, props.t),
      })
      return
    }
    const items: TimetableImportDraft[] = normalized.value.items.map((item, index) => ({
      ...item,
      id: `agent-${String(index)}`,
      selected: isPlausibleClassName(item.className) && item.subject.trim() !== '',
    }))
    if (items.length === 0) {
      setImportState({ kind: 'error', fileName: file.name, context, message: props.t('timetable.importNoItems') })
      return
    }
    setImportState({
      kind: 'review',
      fileName: file.name,
      context,
      items,
      truncated: result.value.truncated,
    })
  }
  const deleteClass = (owner: TeacherClass): void => {
    if (!window.confirm(props.t('timetable.confirmDeleteClass', { name: owner.name }))) return
    void props.commands.deleteClass(owner.id).then((result) => {
      if (!result.ok) return
      if (selectedClassId === owner.id || selectedClass?.id === owner.id) {
        setSelectedClassId(classes.find(item => item.id !== owner.id)?.id ?? '')
      }
      if (owner.usage === 'gradeTimetable' && activeGrade === owner.grade && gradeClasses.length === 1) {
        setSelectedGrade('')
      }
    })
  }

  return (
    <section className={css.module} aria-label={props.t('module.timetable')}>
      <div className={css.moduleToolbar}>
        <div className={clsx(css.segmented, css.timetableViewTabs)} role="tablist" aria-label={props.t('module.timetable')}>
          {VIEWS.map(item => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={view === item}
              className={clsx(css.segment, view === item && css.segmentActive)}
              onClick={() => { setView(item) }}
            >
              {props.t(VIEW_KEYS[item])}
            </button>
          ))}
        </div>
        <div className={css.toolbarActions}>
          <TimetableFilters
            view={view}
            classes={classes}
            selectedClass={selectedClass}
            grades={grades}
            activeGrade={activeGrade}
            onlyMine={onlyMine}
            teacherName={teacherFilterName}
            onClassChange={setSelectedClassId}
            onGradeChange={setSelectedGrade}
            onOnlyMineChange={setOnlyMine}
            onTeacherNameChange={setTeacherFilterName}
            onTeacherNameCommit={() => {
              if (teacherFilterName !== props.settings.teacherName) void props.setTeacherName(teacherFilterName)
            }}
            onAddClass={() => {
              setClassDraft({ name: '', grade: activeGrade })
            }}
            onDeleteClass={deleteClass}
            t={props.t}
          />
          {view !== 'today' && (
            <>
              <input
                ref={importInputRef}
                className={css.calendarImportInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff,.pdf,.docx,.pptx,.xlsx"
                onChange={(event) => {
                  const [file] = [...(event.target.files ?? [])]
                  event.target.value = ''
                  if (file !== undefined) void recognizeTimetable(file)
                }}
              />
              <div className={css.timetableCourseActions}>
                <button type="button" className={css.buttonSecondary} onClick={() => { importInputRef.current?.click() }}>
                  <FileUp size={16} />
                  {props.t('timetable.import')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {view === 'today' && (
        <TodaySchedule
          date={today}
          entries={todayEntries}
          classMap={classMap}
          t={props.t}
        />
      )}
      {view === 'week' && (
        <WeekSchedule
          entries={weekEntries}
          classMap={classMap}
          showClass={onlyMine}
          onEdit={openEditor}
          onCreate={(overrides) => {
            openEditor(undefined, { ...(onlyMine ? { className: '', grade: '' } : {}), ...overrides })
          }}
          t={props.t}
        />
      )}
      {view === 'grade' && (
        <GradeSchedule
          classes={gradeClasses}
          entries={gradeEntries}
          onEdit={openEditor}
          onCreate={(overrides) => { openEditor(undefined, overrides) }}
          onDeleteClass={deleteClass}
          t={props.t}
        />
      )}
      {view === 'study' && (
        <StudySchedule
          entries={studyEntries}
          classMap={classMap}
          onEdit={openEditor}
          onCreate={(overrides) => { openEditor(undefined, overrides) }}
          t={props.t}
        />
      )}

      {editing !== null && (
        <TimetableEditor
          request={editing}
          classes={classes}
          usage={usage}
          defaultTeacherName={props.settings.teacherName}
          commands={props.commands}
          t={props.t}
          onClose={() => { setEditing(null) }}
        />
      )}
      {classDraft !== null && (
        <EditorModal
          open
          title={props.t('timetable.addClass')}
          className={css.timetableClassEditorDialog as string}
          closeLabel={props.t('close')}
          saveLabel={props.t('save')}
          cancelLabel={props.t('cancel')}
          onClose={() => { setClassDraft(null) }}
          onSave={() => {
            void props.commands.saveClass({ ...classDraft, usage, subject: '' }).then((result) => {
              if (result.ok) setClassDraft(null)
            })
          }}
          valid={classDraft.name.trim() !== ''}
        >
          <>
            <FormField label={props.t('class.name')} wide>
              <input value={classDraft.name} onChange={(event) => { setClassDraft({ ...classDraft, name: event.target.value }) }} />
            </FormField>
            <FormField label={props.t('class.grade')} wide>
              <input value={classDraft.grade} onChange={(event) => { setClassDraft({ ...classDraft, grade: event.target.value }) }} />
            </FormField>
          </>
        </EditorModal>
      )}
      {importState !== null && (
        <TimetableImportModal
          state={importState}
          commands={props.commands}
          t={props.t}
          onChange={setImportState}
          onClose={() => { setImportState(null) }}
        />
      )}
    </section>
  )
}

function TimetableFilters(props: {
  view: TimetableView
  classes: readonly TeacherClass[]
  selectedClass: TeacherClass | undefined
  grades: readonly string[]
  activeGrade: string
  onlyMine: boolean
  teacherName: string
  onClassChange: (id: TeacherClassId | '') => void
  onGradeChange: (grade: string) => void
  onOnlyMineChange: (value: boolean) => void
  onTeacherNameChange: (value: string) => void
  onTeacherNameCommit: () => void
  onAddClass: () => void
  onDeleteClass: (owner: TeacherClass) => void
  t: TeacherWorkbenchTranslate
}) {
  const teacherFilter = (
    <div className={css.timetableTeacherFilter}>
      <label className={css.timetableMineToggle}>
        <input
          type="checkbox"
          checked={props.onlyMine}
          onChange={(event) => { props.onOnlyMineChange(event.target.checked) }}
        />
        <span>{props.t('timetable.onlyMine')}</span>
      </label>
      <input
        className={css.timetableTeacherNameInput}
        aria-label={props.t('timetable.teacherFilter')}
        autoComplete="off"
        maxLength={80}
        placeholder={props.t('timetable.teacherFilterPlaceholder')}
        value={props.teacherName}
        onChange={(event) => { props.onTeacherNameChange(event.target.value) }}
        onBlur={props.onTeacherNameCommit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </div>
  )
  if (props.view === 'today') return teacherFilter
  const addClass = (
    <IconAction label={props.t('timetable.addClass')} onClick={props.onAddClass}>
      <Plus size={16} />
    </IconAction>
  )
  if (props.view === 'grade') {
    return (
      <>
        <TimetableMenuSelect
          label={props.t('class.grade')}
          value={props.activeGrade}
          valueLabel={props.activeGrade || props.t('timetable.unsetGrade')}
          options={props.grades.map(grade => ({ id: grade, label: grade || props.t('timetable.unsetGrade') }))}
          onChange={props.onGradeChange}
        />
        {addClass}
      </>
    )
  }
  const classSelectionDisabled = props.onlyMine && props.view === 'week'
  return (
    <>
      <TimetableMenuSelect
        label={props.t('class.select')}
        value={classSelectionDisabled ? '' : props.selectedClass?.id ?? ''}
        valueLabel={classSelectionDisabled ? props.t('timetable.allMyClasses') : props.selectedClass?.name ?? props.t('class.select')}
        options={props.classes.map(item => ({ id: item.id, label: item.name }))}
        disabled={classSelectionDisabled}
        onChange={(id) => { props.onClassChange(id as TeacherClassId | '') }}
      />
      {addClass}
      {!classSelectionDisabled && props.selectedClass !== undefined && (
        <IconAction
          label={props.t('timetable.deleteClass')}
          danger
          onClick={() => {
            if (props.selectedClass !== undefined) props.onDeleteClass(props.selectedClass)
          }}
        >
          <IconTrashOutline16 />
        </IconAction>
      )}
      {props.view === 'week' && teacherFilter}
    </>
  )
}

function TimetableMenuSelect(props: {
  label: string
  value: string
  valueLabel: string
  options: readonly { id: string; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const disabled = props.disabled === true || props.options.length === 0
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  return (
    <Menu
      open={open}
      portal
      compact
      className={css.timetablePickerRoot ?? ''}
      anchor={(
        <button
          type="button"
          className={css.timetablePicker}
          aria-label={props.label}
          aria-haspopup="menu"
          aria-expanded={open}
          title={props.valueLabel}
          disabled={disabled}
          onClick={() => { setOpen(current => !current) }}
        >
          <span>{props.valueLabel}</span>
          <ChevronDown size={16} aria-hidden />
        </button>
      )}
      items={props.options}
      selectedId={props.value}
      onSelect={(id) => {
        props.onChange(id)
        setOpen(false)
      }}
      onClose={() => { setOpen(false) }}
    />
  )
}

function TodaySchedule(props: {
  date: Date
  entries: readonly TeacherTimetableEntry[]
  classMap: ReadonlyMap<TeacherClassId, TeacherClass>
  t: TeacherWorkbenchTranslate
}) {
  return (
    <div className={css.timetableView}>
      <div className={css.timetableViewHeading}>
        {props.t('timetable.todayDate', {
          date: props.date.toLocaleDateString([], { month: 'long', day: 'numeric' }),
          weekday: props.t(`timetable.weekday.${String(browserWeekday(props.date))}` as 'timetable.weekday.1'),
        })}
      </div>
      <div className={css.tableScroller}>
        <table className={`${css.dataTable} ${css.timetableTodayTable}`}>
          <thead><tr>
            <th>{props.t('timetable.period')}</th>
            <th>{props.t('timetable.startTime')}</th>
            <th>{props.t('timetable.subject')}</th>
            <th>{props.t('timetable.teacher')}</th>
            <th>{props.t('timetable.teachingClass')}</th>
          </tr></thead>
          <tbody>
            {props.entries.map(entry => (
              <tr key={entry.id}>
                <td>{props.t('timetable.periodValue', { period: entry.period })}</td>
                <td>{formatTimeRange(entry)}</td>
                <td className={css.primaryCell}>{entry.subject}</td>
                <td>{entry.teacherName}</td>
                <td>{props.classMap.get(entry.classId)?.name ?? ''}</td>
              </tr>
            ))}
            {props.entries.length === 0 && <EmptyTableRow columns={5} text={props.t('timetable.empty.today')} />}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WeekSchedule(props: {
  entries: readonly TeacherTimetableEntry[]
  classMap: ReadonlyMap<TeacherClassId, TeacherClass>
  showClass: boolean
  onEdit: (entry: TeacherTimetableEntry) => void
  onCreate: (overrides: Partial<EditorRequest>) => void
  t: TeacherWorkbenchTranslate
}) {
  const periods = periodRange(props.entries, 8)
  return (
    <ScheduleGrid
      rowLabels={periods.map(period => props.t('timetable.periodValue', { period }))}
      rowEntries={periods.map(period => props.entries.filter(entry => entry.period === period))}
      classMap={props.classMap}
      showClass={props.showClass}
      emptyText={props.t('timetable.empty.week')}
      onEdit={props.onEdit}
      onCreate={(weekday, index) => {
        props.onCreate({ kind: 'lesson', weekday, period: periods[index] ?? 1 })
      }}
      t={props.t}
    />
  )
}

function GradeSchedule(props: {
  classes: readonly TeacherClass[]
  entries: readonly TeacherTimetableEntry[]
  onEdit: (entry: TeacherTimetableEntry) => void
  onCreate: (overrides: Partial<EditorRequest>) => void
  onDeleteClass: (owner: TeacherClass) => void
  t: TeacherWorkbenchTranslate
}) {
  const periods = periodRange(props.entries, 8)
  if (props.classes.length === 0) return <div className={css.emptyState}>{props.t('timetable.empty.grade')}</div>
  return (
    <div className={css.tableScroller}>
      <table className={css.timetableGradeTable}>
        <thead><tr>
          <th>{props.t('class.name')}</th>
          <th>{props.t('timetable.period')}</th>
          {WEEKDAYS.map(day => <th key={day}>{weekdayLabel(day, props.t)}</th>)}
        </tr></thead>
        <tbody>
          {props.classes.flatMap(owner => periods.map((period, periodIndex) => (
            <tr key={`${owner.id}-${String(period)}`}>
              {periodIndex === 0 && (
                <th rowSpan={periods.length}>
                  <div className={css.timetableGradeClassHeading}>
                    <span>{owner.name}</span>
                    <IconAction
                      label={props.t('timetable.deleteClassNamed', { name: owner.name })}
                      danger
                      onClick={() => { props.onDeleteClass(owner) }}
                    >
                      <IconTrashOutline16 />
                    </IconAction>
                  </div>
                </th>
              )}
              <th>{props.t('timetable.periodValue', { period })}</th>
              {WEEKDAYS.map((day) => {
                const cellEntries = props.entries.filter(entry => (
                  entry.classId === owner.id && entry.period === period && entry.weekday === day
                ))
                const slot = `${owner.name} · ${props.t('timetable.periodValue', { period })} · ${weekdayLabel(day, props.t)}`
                return (
                  <td key={day}>
                    {cellEntries.map(entry => (
                      <TimetableEntryCard
                        key={entry.id}
                        entry={entry}
                        showClass={false}
                        onEdit={props.onEdit}
                      />
                    ))}
                    {cellEntries.length === 0 && (
                      <TimetableEmptySlot
                        label={props.t('timetable.addAt', { slot })}
                        onClick={() => {
                          props.onCreate({ className: owner.name, grade: owner.grade, kind: 'lesson', weekday: day, period })
                        }}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  )
}

function StudySchedule(props: {
  entries: readonly TeacherTimetableEntry[]
  classMap: ReadonlyMap<TeacherClassId, TeacherClass>
  onEdit: (entry: TeacherTimetableEntry) => void
  onCreate: (overrides: Partial<EditorRequest>) => void
  t: TeacherWorkbenchTranslate
}) {
  const morningPeriods = periodRange(props.entries.filter(item => item.kind === 'morningStudy'), 1)
  const eveningPeriods = periodRange(props.entries.filter(item => item.kind === 'eveningStudy'), 1)
  const rows = [
    ...morningPeriods.map(period => ({ kind: 'morningStudy' as const, period })),
    ...eveningPeriods.map(period => ({ kind: 'eveningStudy' as const, period })),
  ]
  return (
    <ScheduleGrid
      rowLabels={rows.map(row => `${props.t(KIND_KEYS[row.kind])}${rows.filter(candidate => candidate.kind === row.kind).length > 1 ? ` ${String(row.period)}` : ''}`)}
      rowEntries={rows.map(row => props.entries.filter(entry => entry.kind === row.kind && entry.period === row.period))}
      classMap={props.classMap}
      showClass={false}
      emptyText={props.t('timetable.empty.study')}
      onEdit={props.onEdit}
      onCreate={(weekday, index) => {
        const row = rows[index]
        if (row !== undefined) props.onCreate({ kind: row.kind, weekday, period: row.period })
      }}
      t={props.t}
    />
  )
}

function ScheduleGrid(props: {
  rowLabels: readonly string[]
  rowEntries: readonly (readonly TeacherTimetableEntry[])[]
  classMap: ReadonlyMap<TeacherClassId, TeacherClass>
  showClass: boolean
  emptyText: string
  onEdit: (entry: TeacherTimetableEntry) => void
  onCreate: (weekday: TeacherWeekday, rowIndex: number) => void
  t: TeacherWorkbenchTranslate
}) {
  const total = props.rowEntries.reduce((count, entries) => count + entries.length, 0)
  return (
    <div className={css.tableScroller}>
      <table className={css.timetableGrid}>
        <thead><tr>
          <th>{props.t('timetable.period')}</th>
          {WEEKDAYS.map(day => <th key={day}>{weekdayLabel(day, props.t)}</th>)}
        </tr></thead>
        <tbody>
          {props.rowLabels.map((label, index) => (
            <tr key={`${label}-${String(index)}`}>
              <th>{label}</th>
              {WEEKDAYS.map((day) => {
                const cellEntries = props.rowEntries[index]?.filter(entry => entry.weekday === day) ?? []
                const slot = `${label} · ${weekdayLabel(day, props.t)}`
                return (
                  <td key={day}>
                    {cellEntries.map(entry => (
                      <TimetableEntryCard
                        key={entry.id}
                        entry={entry}
                        className={props.classMap.get(entry.classId)?.name ?? ''}
                        showClass={props.showClass}
                        onEdit={props.onEdit}
                      />
                    ))}
                    {cellEntries.length === 0 && (
                      <TimetableEmptySlot
                        label={props.t('timetable.addAt', { slot })}
                        onClick={() => { props.onCreate(day, index) }}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          {total === 0 && <tr className={css.timetableEmptyOverlay}><td colSpan={8}>{props.emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function TimetableEmptySlot(props: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={css.timetableEmptySlot} aria-label={props.label} title={props.label} onClick={props.onClick}>
      <Plus size={16} aria-hidden />
    </button>
  )
}

function TimetableEntryCard(props: {
  entry: TeacherTimetableEntry
  className?: string
  showClass: boolean
  onEdit: (entry: TeacherTimetableEntry) => void
}) {
  const details = [props.showClass ? props.className : '', props.entry.teacherName, props.entry.location].filter(Boolean).join(' · ')
  return (
    <article className={css.timetableEntry}>
      <button type="button" className={css.timetableEntryMain} onClick={() => { props.onEdit(props.entry) }}>
        <strong>{props.entry.subject}</strong>
        {details !== '' && <span>{details}</span>}
        {formatTimeRange(props.entry) !== '' && <time>{formatTimeRange(props.entry)}</time>}
      </button>
    </article>
  )
}

function TimetableEditor(props: {
  request: EditorRequest
  classes: readonly TeacherClass[]
  usage: TeacherTimetableClassUsage
  defaultTeacherName: string
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onClose: () => void
}) {
  const [className, setClassName] = useState(props.request.className)
  const [grade, setGrade] = useState(props.request.grade)
  const [kind, setKind] = useState(props.request.kind)
  const [weekday, setWeekday] = useState(props.request.weekday)
  const [period, setPeriod] = useState(String(props.request.period))
  const [startTime, setStartTime] = useState(props.request.entry?.startTime ?? '')
  const [endTime, setEndTime] = useState(props.request.entry?.endTime ?? '')
  const [subject, setSubject] = useState(props.request.entry?.subject ?? '')
  const [teacherName, setTeacherName] = useState(props.request.entry?.teacherName ?? props.defaultTeacherName)
  const [location, setLocation] = useState(props.request.entry?.location ?? '')
  const classId = props.classes.find(item => item.name === className.trim() && item.grade === grade.trim())?.id
  const numericPeriod = Number(period)
  const save = async (): Promise<void> => {
    const result = await props.commands.saveTimetableEntry({
      ...(props.request.entry === undefined ? {} : { id: props.request.entry.id }),
      ...(classId === undefined ? {} : { classId }),
      usage: props.usage,
      className,
      grade,
      kind,
      weekday,
      period: numericPeriod,
      startTime,
      endTime,
      subject,
      teacherName,
      location,
    })
    if (result.ok) props.onClose()
  }
  return (
    <EditorModal
      open
      title={props.request.entry === undefined ? props.t('timetable.add') : props.t('timetable.edit')}
      closeLabel={props.t('close')}
      onClose={props.onClose}
      onSave={() => { void save() }}
      saveLabel={props.t('save')}
      cancelLabel={props.t('cancel')}
      valid={className.trim() !== '' && subject.trim() !== '' && Number.isInteger(numericPeriod) && numericPeriod >= 1 && numericPeriod <= 20}
    >
      <datalist id="timetable-class-options">
        {props.classes.map(item => <option key={item.id} value={item.name}>{item.grade}</option>)}
      </datalist>
      <FormField label={props.t('class.name')}>
        <input
          list="timetable-class-options"
          maxLength={80}
          value={className}
          onChange={(event) => {
            const value = event.target.value
            setClassName(value)
            const owner = props.classes.find(item => item.name === value)
            if (owner !== undefined) setGrade(owner.grade)
          }}
        />
      </FormField>
      <FormField label={props.t('class.grade')}><input maxLength={80} value={grade} onChange={(event) => { setGrade(event.target.value) }} /></FormField>
      <FormField label={props.t('timetable.kind')}>
        <select value={kind} onChange={(event) => { setKind(event.target.value as TeacherTimetableEntryKind) }}>
          {Object.entries(KIND_KEYS).map(([value, key]) => <option key={value} value={value}>{props.t(key)}</option>)}
        </select>
      </FormField>
      <FormField label={props.t('timetable.weekday')}>
        <select value={weekday} onChange={(event) => { setWeekday(Number(event.target.value) as TeacherWeekday) }}>
          {WEEKDAYS.map(day => <option key={day} value={day}>{weekdayLabel(day, props.t)}</option>)}
        </select>
      </FormField>
      <FormField label={props.t('timetable.period')}><input type="number" min={1} max={20} step={1} value={period} onChange={(event) => { setPeriod(event.target.value) }} /></FormField>
      <FormField label={props.t('timetable.subject')}><input autoFocus maxLength={120} value={subject} onChange={(event) => { setSubject(event.target.value) }} /></FormField>
      <FormField label={props.t('timetable.startTime')}><input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value) }} /></FormField>
      <FormField label={props.t('timetable.endTime')}><input type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value) }} /></FormField>
      <FormField label={props.t('timetable.teacher')}><input maxLength={80} value={teacherName} onChange={(event) => { setTeacherName(event.target.value) }} /></FormField>
      <FormField label={props.t('timetable.location')}><input maxLength={120} value={location} onChange={(event) => { setLocation(event.target.value) }} /></FormField>
    </EditorModal>
  )
}

function TimetableImportModal(props: {
  state: TimetableImportState
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onChange: (state: TimetableImportState) => void
  onClose: () => void
}) {
  const review = props.state.kind === 'review' ? props.state : null
  const allowedKinds = props.state.context.defaults.target === 'study'
    ? ['morningStudy', 'eveningStudy'] as const
    : ['lesson'] as const
  const selected = review?.items.filter(item => (
    item.selected
    && isPlausibleClassName(item.className)
    && item.subject.trim() !== ''
    && (allowedKinds as readonly TeacherTimetableEntryKind[]).includes(item.kind)
  )) ?? []
  const update = (id: string, change: Partial<TimetableImportDraft>): void => {
    if (review === null) return
    props.onChange({ ...review, items: review.items.map(item => item.id === id ? { ...item, ...change } : item) })
  }
  const importItems = async (): Promise<void> => {
    const result = await props.commands.importTimetableEntries(selected.map((item) => {
      const classId = props.state.context.classes.find(owner => (
        owner.name === item.className.trim() && owner.grade === item.grade.trim()
      ))?.id
      return {
        ...(classId === undefined ? {} : { classId }),
        usage: props.state.context.usage,
        className: item.className,
        grade: item.grade,
        kind: item.kind,
        weekday: item.weekday,
        period: item.period,
        startTime: item.startTime,
        endTime: item.endTime,
        subject: item.subject,
        teacherName: item.teacherName,
        location: item.location,
      }
    }))
    if (result.ok) props.onClose()
  }
  return (
    <Modal
      open
      title={props.t('timetable.importTitle')}
      closeLabel={props.t('close')}
      onClose={props.onClose}
      className={`${css.editorDialog} ${css.calendarImportDialog} ${css.timetableImportDialog}`}
      footer={review === null ? (
        <button type="button" className={css.buttonPrimary} onClick={props.onClose}>{props.t('close')}</button>
      ) : (
        <>
          <button type="button" className={css.buttonSecondary} onClick={props.onClose}>{props.t('cancel')}</button>
          <button type="button" className={css.buttonPrimary} disabled={selected.length === 0} onClick={() => { void importItems() }}>
            {props.t('timetable.importSelected', { count: selected.length })}
          </button>
        </>
      )}
    >
      {props.state.kind === 'extracting' && (
        <div className={css.calendarImportStatus} role="status">
          <span className={css.calendarImportSpinner} aria-hidden />
          <div><strong>{props.t('timetable.importExtracting')}</strong><span>{props.state.fileName}</span></div>
        </div>
      )}
      {props.state.kind === 'normalizing' && (
        <div className={css.calendarImportStatus} role="status">
          <span className={css.calendarImportSpinner} aria-hidden />
          <div><strong>{props.t('timetable.importNormalizing')}</strong><span>{props.state.fileName}</span></div>
        </div>
      )}
      {props.state.kind === 'error' && (
        <div className={css.calendarImportError} role="alert">
          <strong>{props.t('timetable.importFailed')}</strong>
          <span>{props.state.message}</span>
        </div>
      )}
      {review !== null && (
        <div className={css.calendarImportBody}>
          <datalist id="timetable-import-class-options">
            {props.state.context.classes.map(item => <option key={item.id} value={item.name}>{item.grade}</option>)}
          </datalist>
          <div className={css.calendarImportSummary}>
            <div><strong>{review.fileName}</strong><span>{props.t('timetable.importFound', { count: review.items.length })}</span></div>
            <label>
              <input
                type="checkbox"
                checked={review.items.length > 0 && review.items.every(item => item.selected)}
                onChange={(event) => {
                  props.onChange({ ...review, items: review.items.map(item => ({ ...item, selected: event.target.checked })) })
                }}
              />
              {props.t('timetable.importSelectAll')}
            </label>
          </div>
          {review.truncated && <div className={css.calendarImportWarning}>{props.t('timetable.importTruncated')}</div>}
          <div className={`${css.calendarImportList} ${css.timetableImportList}`}>
            {review.items.map(item => (
              <div key={item.id} className={css.timetableImportRow}>
                <input
                  type="checkbox"
                  aria-label={props.t('timetable.importToggle', { subject: item.subject })}
                  checked={item.selected}
                  onChange={(event) => { update(item.id, { selected: event.target.checked }) }}
                />
                <div className={css.timetableImportFields}>
                  <input list="timetable-import-class-options" aria-label={props.t('class.name')} title={props.t('class.name')} value={item.className} onChange={(event) => { update(item.id, { className: event.target.value }) }} />
                  <input aria-label={props.t('class.grade')} title={props.t('class.grade')} value={item.grade} onChange={(event) => { update(item.id, { grade: event.target.value }) }} />
                  <select aria-label={props.t('timetable.kind')} title={props.t('timetable.kind')} value={item.kind} onChange={(event) => { update(item.id, { kind: event.target.value as TeacherTimetableEntryKind }) }}>
                    {allowedKinds.map(value => <option key={value} value={value}>{props.t(KIND_KEYS[value])}</option>)}
                  </select>
                  <select aria-label={props.t('timetable.weekday')} title={props.t('timetable.weekday')} value={item.weekday} onChange={(event) => { update(item.id, { weekday: Number(event.target.value) as TeacherWeekday }) }}>
                    {WEEKDAYS.map(day => <option key={day} value={day}>{weekdayLabel(day, props.t)}</option>)}
                  </select>
                  <input type="number" min={1} max={20} aria-label={props.t('timetable.period')} title={props.t('timetable.period')} value={item.period} onChange={(event) => { update(item.id, { period: Number(event.target.value) }) }} />
                  <input className={css.timetableImportSubject} aria-label={props.t('timetable.subject')} title={props.t('timetable.subject')} value={item.subject} onChange={(event) => { update(item.id, { subject: event.target.value }) }} />
                  <input aria-label={props.t('timetable.teacher')} title={props.t('timetable.teacher')} value={item.teacherName} onChange={(event) => { update(item.id, { teacherName: event.target.value }) }} />
                  <input aria-label={props.t('timetable.location')} title={props.t('timetable.location')} value={item.location} onChange={(event) => { update(item.id, { location: event.target.value }) }} />
                  <input type="time" aria-label={props.t('timetable.startTime')} title={props.t('timetable.startTime')} value={item.startTime} onChange={(event) => { update(item.id, { startTime: event.target.value }) }} />
                  <input type="time" aria-label={props.t('timetable.endTime')} title={props.t('timetable.endTime')} value={item.endTime} onChange={(event) => { update(item.id, { endTime: event.target.value }) }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

function EmptyTableRow(props: { columns: number; text: string }) {
  return <tr><td className={css.timetableEmptyCell} colSpan={props.columns}>{props.text}</td></tr>
}

function importFailureText(code: string, message: string, t: TeacherWorkbenchTranslate): string {
  switch (code) {
    case 'provider-unavailable': return t('timetable.importProviderUnavailable')
    case 'unsupported-format': return t('timetable.importUnsupported')
    case 'file-too-large': return t('timetable.importTooLarge')
    default: return t('timetable.importFailureDetail', { message })
  }
}

function normalizeFailureText(code: string, message: string, t: TeacherWorkbenchTranslate): string {
  switch (code) {
    case 'session-unavailable': return t('timetable.importSessionUnavailable')
    case 'tool-model-unavailable': return t('timetable.importToolModelUnavailable')
    case 'source-too-large': return t('timetable.importTooLarge')
    case 'timed-out': return t('timetable.importToolModelTimedOut')
    case 'invalid-output': return t('timetable.importToolModelInvalid')
    default: return t('timetable.importFailureDetail', { message })
  }
}

function timetableClassUsage(view: TimetableView): TeacherTimetableClassUsage {
  switch (view) {
    case 'today':
    case 'week':
    case 'study':
      return 'timetable'
    case 'grade':
      return 'gradeTimetable'
  }
}

function browserWeekday(date: Date): TeacherWeekday {
  const day = date.getDay()
  return (day === 0 ? 7 : day) as TeacherWeekday
}

function weekdayLabel(day: TeacherWeekday, t: TeacherWorkbenchTranslate): string {
  return t(`timetable.weekday.${String(day)}` as 'timetable.weekday.1')
}

function normalizeTeacherName(value: string): string {
  return value.trim().replace(/\s+/gu, '').toLocaleLowerCase()
}

function periodRange(entries: readonly TeacherTimetableEntry[], minimum: number): number[] {
  const maximum = Math.max(minimum, ...entries.map(item => item.period))
  return Array.from({ length: maximum }, (_, index) => index + 1)
}

function entryOrder(left: TeacherTimetableEntry, right: TeacherTimetableEntry): number {
  return left.weekday - right.weekday || left.period - right.period || left.subject.localeCompare(right.subject)
}

function formatTimeRange(entry: Pick<TeacherTimetableEntry, 'startTime' | 'endTime'>): string {
  if (entry.startTime === '') return entry.endTime
  return entry.endTime === '' ? entry.startTime : `${entry.startTime}–${entry.endTime}`
}
