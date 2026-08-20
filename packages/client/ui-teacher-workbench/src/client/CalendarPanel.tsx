/** Compact and expanded Gregorian, lunar, holiday, and personal calendar. */

import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileUp,
  ListTodo,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import type { TeacherCalendarItem, TeacherWorkbenchState } from '@deepseek-ai/dsh-api-remotes/client'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import { parseSchoolCalendar, type CalendarImportDraft } from './calendar-import.ts'
import { buildTeacherCalendarMonth, formatLocalDate, parseLocalDate } from './calendar-data.ts'
import { EditorModal, FormField, IconAction, confirmDelete, type TeacherWorkbenchTranslate } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

type CalendarImportState =
  | { readonly kind: 'extracting'; readonly fileName: string }
  | { readonly kind: 'review'; readonly fileName: string; readonly items: readonly CalendarImportDraft[]; readonly truncated: boolean }
  | { readonly kind: 'error'; readonly fileName: string; readonly message: string }

/** Calendar panel props. */
export interface CalendarPanelProps {
  /** Complete durable workbench state. */
  state: TeacherWorkbenchState
  /** Durable workbench commands. */
  commands: TeacherWorkbenchCommands
  /** Whether the detailed panel occupies the full daily-management area. */
  expanded: boolean
  /** Expand the panel. */
  onExpand: () => void
  /** Return to the four-panel board. */
  onCollapse: () => void
  /** Workbench translator. */
  t: TeacherWorkbenchTranslate
}

/**
 * Render a simple month grid or an expanded lunar and statutory-holiday calendar.
 * @param props - durable data, commands, expansion state, and copy.
 * @returns an interactive calendar whose selected date owns editable items.
 */
export function CalendarPanel(props: CalendarPanelProps) {
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState(() => formatLocalDate(today))
  const [editing, setEditing] = useState<TeacherCalendarItem | 'new' | null>(null)
  const [importState, setImportState] = useState<CalendarImportState | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const month = useMemo(() => buildTeacherCalendarMonth(cursor, today), [cursor, today])
  const selectedDay = month.days.find(day => day.date === selected)
    ?? findSelectedDay(selected, today)
  const selectedItems = useMemo(
    () => props.state.calendarItems
      .filter(item => item.date === selected)
      .sort((left, right) => left.time.localeCompare(right.time) || left.createdAt - right.createdAt),
    [props.state.calendarItems, selected],
  )
  const selectedTodos = useMemo(
    () => props.state.dailyTodos.filter(todo => todo.dueAt.startsWith(`${selected}T`)),
    [props.state.dailyTodos, selected],
  )
  const itemCountByDate = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of props.state.calendarItems) counts.set(item.date, (counts.get(item.date) ?? 0) + 1)
    for (const todo of props.state.dailyTodos) {
      const date = todo.dueAt.slice(0, 10)
      if (date !== '') counts.set(date, (counts.get(date) ?? 0) + 1)
    }
    return counts
  }, [props.state.calendarItems, props.state.dailyTodos])
  const selectDay = (date: string, inMonth: boolean): void => {
    setSelected(date)
    if (!inMonth) {
      const parsed = parseLocalDate(date)
      setCursor(new Date(parsed.getFullYear(), parsed.getMonth(), 1))
    }
    if (!props.expanded) props.onExpand()
  }
  const moveMonth = (delta: number): void => {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1))
  }
  const goToday = (): void => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
    setSelected(formatLocalDate(today))
  }
  const toggleLabel = props.expanded ? props.t('daily.panel.collapse') : props.t('daily.panel.expand')
  const recognizeCalendar = async (file: File): Promise<void> => {
    setImportState({ kind: 'extracting', fileName: file.name })
    const result = await props.commands.extractDocument(file)
    if (!result.ok) {
      setImportState({ kind: 'error', fileName: file.name, message: importFailureText(result.error.code, result.error.message, props.t) })
      return
    }
    const items = parseSchoolCalendar(result.value.markdown, cursor.getFullYear())
    if (items.length === 0) {
      setImportState({ kind: 'error', fileName: file.name, message: props.t('daily.calendar.importNoItems') })
      return
    }
    setImportState({ kind: 'review', fileName: file.name, items, truncated: result.value.truncated })
  }
  return (
    <section className={`${css.dailyPanel} ${css.calendarPanel} ${props.expanded ? css.dailyPanelExpanded : ''}`} aria-labelledby="daily-calendar-title">
      <header className={css.dailyPanelHeader}>
        <div>
          <h2 id="daily-calendar-title">{props.t('daily.calendar.title', { year: month.year, month: month.month })}</h2>
          <span>{props.expanded ? selectedDay.lunarLong : props.t('daily.calendar.itemCount', { count: props.state.calendarItems.length })}</span>
        </div>
        <div className={css.dailyPanelActions}>
          <button type="button" className={css.dailyIconButton} aria-label={props.t('daily.calendar.previous')} title={props.t('daily.calendar.previous')} onClick={() => { moveMonth(-1) }} disabled={month.year === 1900 && month.month === 1}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className={css.calendarTodayButton} onClick={goToday}>{props.t('daily.calendar.today')}</button>
          <button type="button" className={css.dailyIconButton} aria-label={props.t('daily.calendar.next')} title={props.t('daily.calendar.next')} onClick={() => { moveMonth(1) }} disabled={month.year === 2100 && month.month === 12}>
            <ChevronRight size={16} />
          </button>
          <button type="button" className={css.dailyIconButton} aria-label={toggleLabel} title={toggleLabel} onClick={props.expanded ? props.onCollapse : props.onExpand}>
            {props.expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </header>
      <div className={props.expanded ? css.calendarExpandedBody : css.calendarCompactBody}>
        <div className={css.calendarGridArea}>
          <div className={css.calendarWeekdays} aria-hidden="true">
            {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
          </div>
          <div className={css.calendarDays}>
            {month.days.map((day) => {
              const count = itemCountByDate.get(day.date) ?? 0
              const annotation = day.holidayName || day.makeupWorkdayName || day.solarTerm || day.lunarShort
              return (
                <button
                  key={day.date}
                  type="button"
                  className={clsx(
                    css.calendarDay,
                    !day.inMonth && css.calendarDayOutside,
                    day.today && css.calendarDayToday,
                    day.date === selected && css.calendarDaySelected,
                  )}
                  aria-label={props.t('daily.calendar.dayLabel', {
                    date: day.date,
                    lunar: day.lunarLong,
                    detail: annotation,
                    count,
                  })}
                  onClick={() => { selectDay(day.date, day.inMonth) }}
                >
                  <span className={css.calendarSolar}>{day.day}</span>
                  {props.expanded && <span className={clsx(css.calendarLunar, day.holidayName && css.calendarHoliday)}>{annotation}</span>}
                  {props.expanded && count > 0 && <i className={css.calendarEventCount}>{count}</i>}
                </button>
              )
            })}
          </div>
          {!props.expanded && (
            <div className={css.calendarCompactSelection}>
              <CalendarDays size={15} />
              <span>{formatSelectedDate(selected)}</span>
            </div>
          )}
        </div>
        {props.expanded && (
          <aside className={css.calendarAgenda} aria-label={props.t('daily.calendar.agenda')}>
            <div className={css.calendarSelectedHeading}>
              <div>
                <span>{formatSelectedDate(selected)}</span>
                <h3>{selectedDay.lunarLong}</h3>
              </div>
              <div className={css.calendarHeadingActions}>
                <input
                  ref={importInputRef}
                  className={css.calendarImportInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff,.pdf,.docx,.pptx,.xlsx"
                  onChange={(event) => {
                    const [file] = [...(event.target.files ?? [])]
                    event.target.value = ''
                    if (file !== undefined) void recognizeCalendar(file)
                  }}
                />
                <button type="button" className={css.buttonSecondary} onClick={() => { importInputRef.current?.click() }}>
                  <FileUp size={16} />
                  {props.t('daily.calendar.import')}
                </button>
                <button type="button" className={css.buttonPrimary} onClick={() => { setEditing('new') }}>
                  <Plus size={16} />
                  {props.t('daily.calendar.addItem')}
                </button>
              </div>
            </div>
            {(selectedDay.holidayName !== '' || selectedDay.makeupWorkdayName !== '' || selectedDay.solarTerm !== '') && (
              <div className={css.calendarAnnotations}>
                {selectedDay.holidayName !== '' && <span>{props.t('daily.calendar.publicHoliday', { name: selectedDay.holidayName })}</span>}
                {selectedDay.makeupWorkdayName !== '' && <span>{props.t('daily.calendar.makeupWorkday', { name: selectedDay.makeupWorkdayName })}</span>}
                {selectedDay.solarTerm !== '' && <span>{selectedDay.solarTerm}</span>}
              </div>
            )}
            {!month.officialScheduleKnown && (
              <div className={css.calendarScheduleNotice}>{props.t('daily.calendar.scheduleUnavailable')}</div>
            )}
            <div className={css.calendarAgendaList}>
              {selectedItems.map(item => (
                <article key={item.id} className={css.calendarAgendaItem}>
                  <Clock3 size={15} />
                  <button type="button" className={css.calendarAgendaMain} onClick={() => { setEditing(item) }}>
                    <strong>{item.title}</strong>
                    <span>{item.time || props.t('daily.calendar.allDay')}{item.details === '' ? '' : ` · ${item.details}`}</span>
                  </button>
                  <IconAction label={props.t('edit')} onClick={() => { setEditing(item) }}><Pencil size={15} /></IconAction>
                  <IconAction label={props.t('delete')} danger onClick={() => { if (confirmDelete(props.t)) void props.commands.deleteCalendarItem(item.id) }}><Trash2 size={15} /></IconAction>
                </article>
              ))}
              {selectedTodos.map(todo => (
                <article key={todo.id} className={css.calendarTodoItem}>
                  <ListTodo size={15} />
                  <label>
                    <input type="checkbox" checked={todo.completed} onChange={() => { void props.commands.toggleDailyTodo(todo.id) }} />
                    <span>{todo.title}</span>
                  </label>
                  <time>{todo.dueAt.slice(11)}</time>
                </article>
              ))}
              {selectedItems.length === 0 && selectedTodos.length === 0 && (
                <div className={css.dailyEmpty}>{props.t('daily.calendar.empty')}</div>
              )}
            </div>
          </aside>
        )}
      </div>
      {editing !== null && (
        <CalendarItemEditor
          item={editing === 'new' ? undefined : editing}
          selectedDate={selected}
          commands={props.commands}
          t={props.t}
          onClose={() => { setEditing(null) }}
        />
      )}
      {importState !== null && (
        <CalendarImportModal
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

function CalendarImportModal(props: {
  state: CalendarImportState
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onChange: (state: CalendarImportState) => void
  onClose: () => void
}) {
  const review = props.state.kind === 'review' ? props.state : null
  const selected = review?.items.filter(item => item.selected && item.date !== '' && item.title.trim() !== '') ?? []
  const update = (id: string, change: Partial<CalendarImportDraft>): void => {
    if (review === null) return
    props.onChange({ ...review, items: review.items.map(item => item.id === id ? { ...item, ...change } : item) })
  }
  const importItems = async (): Promise<void> => {
    const result = await props.commands.importCalendarItems(selected.map(item => ({
      date: item.date,
      time: item.time,
      title: item.title,
      details: item.details,
    })))
    if (result.ok) props.onClose()
  }
  return (
    <Modal
      open
      title={props.t('daily.calendar.importTitle')}
      closeLabel={props.t('close')}
      onClose={props.onClose}
      className={`${css.editorDialog} ${css.calendarImportDialog}`}
      footer={review === null ? (
        <button type="button" className={css.buttonPrimary} onClick={props.onClose}>{props.t('close')}</button>
      ) : (
        <>
          <button type="button" className={css.buttonSecondary} onClick={props.onClose}>{props.t('cancel')}</button>
          <button type="button" className={css.buttonPrimary} disabled={selected.length === 0} onClick={() => { void importItems() }}>
            {props.t('daily.calendar.importSelected', { count: selected.length })}
          </button>
        </>
      )}
    >
      {props.state.kind === 'extracting' && (
        <div className={css.calendarImportStatus} role="status">
          <span className={css.calendarImportSpinner} aria-hidden />
          <div><strong>{props.t('daily.calendar.importExtracting')}</strong><span>{props.state.fileName}</span></div>
        </div>
      )}
      {props.state.kind === 'error' && (
        <div className={css.calendarImportError} role="alert">
          <strong>{props.t('daily.calendar.importFailed')}</strong>
          <span>{props.state.message}</span>
        </div>
      )}
      {review !== null && (
        <div className={css.calendarImportBody}>
          <div className={css.calendarImportSummary}>
            <div><strong>{review.fileName}</strong><span>{props.t('daily.calendar.importFound', { count: review.items.length })}</span></div>
            <label>
              <input
                type="checkbox"
                checked={review.items.length > 0 && review.items.every(item => item.selected)}
                onChange={(event) => {
                  props.onChange({ ...review, items: review.items.map(item => ({ ...item, selected: event.target.checked })) })
                }}
              />
              {props.t('daily.calendar.importSelectAll')}
            </label>
          </div>
          {review.truncated && <div className={css.calendarImportWarning}>{props.t('daily.calendar.importTruncated')}</div>}
          <div className={css.calendarImportList}>
            {review.items.map(item => (
              <div key={item.id} className={css.calendarImportRow}>
                <input
                  type="checkbox"
                  aria-label={props.t('daily.calendar.importToggle', { title: item.title })}
                  checked={item.selected}
                  onChange={(event) => { update(item.id, { selected: event.target.checked }) }}
                />
                <input type="date" value={item.date} min="1900-01-01" max="2100-12-31" onChange={(event) => { update(item.id, { date: event.target.value }) }} />
                <input type="time" value={item.time} aria-label={props.t('daily.calendar.time')} onChange={(event) => { update(item.id, { time: event.target.value }) }} />
                <input maxLength={120} value={item.title} aria-label={props.t('daily.calendar.itemTitle')} onChange={(event) => { update(item.id, { title: event.target.value }) }} />
                <textarea rows={2} maxLength={2000} value={item.details} aria-label={props.t('daily.calendar.details')} placeholder={props.t('daily.calendar.importDetailsPlaceholder')} onChange={(event) => { update(item.id, { details: event.target.value }) }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

function importFailureText(code: string, message: string, t: TeacherWorkbenchTranslate): string {
  switch (code) {
    case 'provider-unavailable': return t('daily.calendar.importProviderUnavailable')
    case 'unsupported-format': return t('daily.calendar.importUnsupported')
    case 'file-too-large': return t('daily.calendar.importTooLarge')
    default: return t('daily.calendar.importFailureDetail', { message })
  }
}

function CalendarItemEditor(props: {
  item: TeacherCalendarItem | undefined
  selectedDate: string
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onClose: () => void
}) {
  const [date, setDate] = useState(props.item?.date ?? props.selectedDate)
  const [time, setTime] = useState(props.item?.time ?? '')
  const [title, setTitle] = useState(props.item?.title ?? '')
  const [details, setDetails] = useState(props.item?.details ?? '')
  const save = async (): Promise<void> => {
    const result = await props.commands.saveCalendarItem({
      ...(props.item === undefined ? {} : { id: props.item.id }),
      date,
      time,
      title,
      details,
    })
    if (result.ok) props.onClose()
  }
  return (
    <EditorModal
      open
      title={props.item === undefined ? props.t('daily.calendar.addItem') : props.t('daily.calendar.editItem')}
      closeLabel={props.t('close')}
      onClose={props.onClose}
      onSave={() => { void save() }}
      saveLabel={props.t('save')}
      cancelLabel={props.t('cancel')}
      valid={date !== '' && title.trim() !== ''}
    >
      <FormField label={props.t('date')}><input type="date" value={date} min="1900-01-01" max="2100-12-31" onChange={(event) => { setDate(event.target.value) }} /></FormField>
      <FormField label={props.t('daily.calendar.time')}><input type="time" value={time} onChange={(event) => { setTime(event.target.value) }} /></FormField>
      <FormField label={props.t('daily.calendar.itemTitle')} wide><input autoFocus maxLength={120} value={title} onChange={(event) => { setTitle(event.target.value) }} /></FormField>
      <FormField label={props.t('daily.calendar.details')} wide><textarea rows={5} maxLength={2000} value={details} onChange={(event) => { setDetails(event.target.value) }} /></FormField>
    </EditorModal>
  )
}

function formatSelectedDate(value: string): string {
  return parseLocalDate(value).toLocaleDateString([], { month: 'long', day: 'numeric', weekday: 'long' })
}

function findSelectedDay(selected: string, today: Date) {
  const day = buildTeacherCalendarMonth(parseLocalDate(selected), today).days.find(entry => entry.date === selected)
  /* v8 ignore next -- a month projection always contains every date in that month. */
  if (day === undefined) throw new Error(`calendar projection omitted ${selected}`)
  return day
}
