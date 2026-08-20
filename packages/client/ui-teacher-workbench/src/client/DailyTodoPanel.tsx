/** Independent daily-todo cards with color markers and voice entry. */

import { useMemo, useRef, useState } from 'react'
import { Calendar, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  TeacherDailyTodo,
  TeacherDailyTodoCategory,
  TeacherDailyTodoColor,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import { EditorModal, FormField, IconAction, confirmDelete, type TeacherWorkbenchTranslate } from './shared.tsx'
import { VoiceInputButton } from './SpeechInput.tsx'
import css from './TeacherWorkbench.module.css'

type TodoView = TeacherDailyTodoCategory

const TODO_VIEWS = ['today', 'important', 'urgent'] as const satisfies readonly TodoView[]

const TODO_COLORS = [
  { value: 'red', hex: '#e5484d' },
  { value: 'orange', hex: '#f76b15' },
  { value: 'amber', hex: '#f5a524' },
  { value: 'yellow', hex: '#d4a017' },
  { value: 'green', hex: '#30a46c' },
  { value: 'teal', hex: '#12a594' },
  { value: 'cyan', hex: '#0894b3' },
  { value: 'blue', hex: '#3e63dd' },
  { value: 'violet', hex: '#8e4ec6' },
  { value: 'pink', hex: '#d6409f' },
] as const satisfies readonly { value: TeacherDailyTodoColor; hex: string }[]

/** Daily todo panel props. */
export interface DailyTodoPanelProps {
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
 * Render Today, Important, and Urgent as simultaneously visible cards.
 * @param props - durable tasks, voice settings, commands, and copy.
 * @returns three deadline-aware task composers and editable task lists.
 */
export function DailyTodoPanel({ state, settings, commands, t }: DailyTodoPanelProps) {
  const allTasks = useMemo(() => [...state.dailyTodos].sort(compareTodos), [state.dailyTodos])
  return (
    <>
      {TODO_VIEWS.map(view => (
        <TodoCard
          key={view}
          view={view}
          tasks={allTasks.filter(task => task.category === view)}
          settings={settings}
          commands={commands}
          t={t}
        />
      ))}
    </>
  )
}

function TodoCard(props: {
  view: TodoView
  tasks: TeacherDailyTodo[]
  settings: TeacherWorkbenchSettings
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
}) {
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [editing, setEditing] = useState<TeacherDailyTodo | null>(null)
  const openCount = props.tasks.filter(task => !task.completed).length
  const add = async (): Promise<void> => {
    if (title.trim() === '') return
    const result = await props.commands.saveDailyTodo({
      title,
      dueAt,
      category: props.view,
      color: 'blue',
    })
    if (!result.ok) return
    setTitle('')
    setDueAt('')
  }
  const headingId = todoHeadingId(props.view)
  return (
    <section
      className={`${css.dailyPanel} ${css.todoPanel} ${todoPanelClass(props.view)}`}
      aria-labelledby={headingId}
      data-todo-category={props.view}
    >
      <header className={`${css.dailyPanelHeader} ${css.todoPanelHeader}`}>
        <div className={css.todoHeaderSummary}>
          <h2 id={headingId}>{todoTitleLabel(props.t, props.view)}</h2>
          <span>{props.t('daily.todo.openCount', { count: openCount })}</span>
        </div>
      </header>
      <form
        className={`${css.todoComposer} ${css.todoComposerCompact}`}
        onSubmit={(event) => { event.preventDefault(); void add() }}
      >
        <input
          aria-label={todoComposerLabel(props.t, props.view)}
          maxLength={120}
          placeholder={todoComposerPlaceholder(props.t, props.view)}
          value={title}
          onChange={(event) => { setTitle(event.target.value) }}
        />
        <label
          className={css.todoDeadlinePicker}
          data-has-value={dueAt !== ''}
          data-todo-deadline-picker
          title={dueAt === ''
            ? props.t('daily.todo.deadline')
            : `${props.t('daily.todo.deadline')}: ${formatLocalDateTime(dueAt)}`}
        >
          <Calendar size={17} aria-hidden="true" />
          <input
            className={css.todoDeadlineInput}
            type="datetime-local"
            aria-label={props.t('daily.todo.deadline')}
            value={dueAt}
            onChange={(event) => { setDueAt(event.target.value) }}
          />
        </label>
        <VoiceInputButton
          language={props.settings.speechLanguage}
          onTranscript={(transcript) => { setTitle(current => joinSpeech(current, transcript)) }}
          t={props.t}
        />
        <button
          type="submit"
          className={css.dailyAddButton}
          aria-label={props.t('daily.todo.add')}
          title={props.t('daily.todo.add')}
          disabled={title.trim() === ''}
        >
          <Plus size={17} />
        </button>
      </form>
      <div className={css.todoList}>
        {props.tasks.length === 0
          ? <div className={css.dailyEmpty}>{todoEmptyLabel(props.t, props.view)}</div>
          : props.tasks.map(task => (
            <article
              key={task.id}
              className={`${task.completed ? css.todoItemDone : css.todoItem} ${task.category === 'today' ? css.todoItemWithoutMarker : ''}`}
            >
              {task.category !== 'today' && <TodoColorMarker task={task} commands={props.commands} t={props.t} />}
              <label className={css.todoCheck}>
                <input
                  type="checkbox"
                  checked={task.completed}
                  aria-label={props.t('daily.todo.toggle', { title: task.title })}
                  onChange={() => { void props.commands.toggleDailyTodo(task.id) }}
                />
              </label>
              <div className={css.todoCopy}>
                <strong>{task.title}</strong>
                <span className={task.dueAt !== '' && isPast(task.dueAt) && !task.completed ? css.todoOverdue : undefined}>
                  {task.dueAt === '' ? props.t('daily.todo.noDeadline') : props.t('daily.todo.due', { value: formatLocalDateTime(task.dueAt) })}
                </span>
              </div>
              <div className={css.dailyRowActions}>
                <IconAction label={props.t('edit')} onClick={() => { setEditing(task) }}><Pencil size={15} /></IconAction>
                <IconAction
                  label={props.t('delete')}
                  danger
                  onClick={() => { if (confirmDelete(props.t)) void props.commands.deleteDailyTodo(task.id) }}
                >
                  <Trash2 size={15} />
                </IconAction>
              </div>
            </article>
          ))}
      </div>
      <footer className={css.todoFooter}>
        <span>{props.t('daily.todo.summary', { total: props.tasks.length, done: props.tasks.length - openCount })}</span>
      </footer>
      {editing !== null && (
        <TodoEditor
          task={editing}
          language={props.settings.speechLanguage}
          commands={props.commands}
          t={props.t}
          onClose={() => { setEditing(null) }}
        />
      )}
    </section>
  )
}

function TodoEditor(props: {
  task: TeacherDailyTodo
  language: string
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onClose: () => void
}) {
  const [title, setTitle] = useState(props.task.title)
  const [dueAt, setDueAt] = useState(props.task.dueAt)
  const [category, setCategory] = useState<TeacherDailyTodoCategory>(props.task.category)
  const save = async (): Promise<void> => {
    const result = await props.commands.saveDailyTodo({
      id: props.task.id,
      title,
      dueAt,
      completed: props.task.completed,
      category,
      color: props.task.color,
    })
    if (result.ok) props.onClose()
  }
  return (
    <EditorModal
      open
      title={props.t('daily.todo.edit')}
      closeLabel={props.t('close')}
      onClose={props.onClose}
      onSave={() => { void save() }}
      saveLabel={props.t('save')}
      cancelLabel={props.t('cancel')}
      valid={title.trim() !== ''}
    >
      <div className={css.fieldWide}>
        <span className={css.fieldLabel}>{props.t('daily.todo.item')}</span>
        <div className={css.voiceField}>
          <input aria-label={props.t('daily.todo.item')} value={title} maxLength={120} onChange={(event) => { setTitle(event.target.value) }} />
          <VoiceInputButton
            language={props.language}
            onTranscript={(transcript) => { setTitle(current => joinSpeech(current, transcript)) }}
            t={props.t}
          />
        </div>
      </div>
      <FormField label={props.t('daily.todo.deadline')} wide>
        <input type="datetime-local" value={dueAt} onChange={(event) => { setDueAt(event.target.value) }} />
      </FormField>
      <div className={`${css.fieldWide} ${css.todoCategoryField}`}>
        <span className={css.fieldLabel}>{props.t('daily.todo.classification')}</span>
        <div className={css.todoCategoryOptions} role="radiogroup" aria-label={props.t('daily.todo.classification')}>
          <label className={css.todoCategoryOption}>
            <input
              type="radio"
              name="todo-category"
              checked={category === 'today'}
              onChange={() => { setCategory('today') }}
            />
            <span>{props.t('daily.todo.title')}</span>
          </label>
          <label className={css.todoCategoryOption}>
            <input
              type="radio"
              name="todo-category"
              checked={category === 'important'}
              onChange={() => { setCategory('important') }}
            />
            <span>{props.t('daily.todo.important')}</span>
          </label>
          <label className={css.todoCategoryOption}>
            <input
              type="radio"
              name="todo-category"
              checked={category === 'urgent'}
              onChange={() => { setCategory('urgent') }}
            />
            <span>{props.t('daily.todo.urgent')}</span>
          </label>
        </div>
      </div>
    </EditorModal>
  )
}

function TodoColorMarker(props: {
  task: TeacherDailyTodo
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const root = useRef<HTMLDivElement>(null)
  useDismissOnOutsidePointer(root, open, setOpen)

  const toggle = (button: HTMLButtonElement): void => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = button.getBoundingClientRect()
    const width = 154
    const height = 72
    const margin = 8
    const left = Math.min(Math.max(rect.left - 5, margin), window.innerWidth - width - margin)
    const below = rect.bottom + 6
    const top = below + height <= window.innerHeight - margin ? below : rect.top - height - 6
    setPosition({ left, top: Math.max(margin, top) })
    setOpen(true)
  }
  const choose = async (color: TeacherDailyTodoColor): Promise<void> => {
    if (color === props.task.color) {
      setOpen(false)
      return
    }
    const result = await props.commands.saveDailyTodo({
      id: props.task.id,
      title: props.task.title,
      dueAt: props.task.dueAt,
      completed: props.task.completed,
      category: props.task.category,
      color,
    })
    if (result.ok) setOpen(false)
  }
  const currentColor = todoColorHex(props.task.color)
  return (
    <div
      className={css.todoMarker}
      ref={root}
      onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}
    >
      <button
        type="button"
        className={css.todoMarkerButton}
        style={{ backgroundColor: currentColor }}
        aria-label={props.t('daily.todo.marker', {
          title: props.task.title,
          color: todoColorLabel(props.t, props.task.color),
        })}
        aria-expanded={open}
        title={props.t('daily.todo.marker', {
          title: props.task.title,
          color: todoColorLabel(props.t, props.task.color),
        })}
        onClick={(event) => { toggle(event.currentTarget) }}
      />
      {open && (
        <div
          className={css.todoColorPopover}
          role="group"
          aria-label={props.t('daily.todo.markerPicker')}
          style={{ left: position.left, top: position.top }}
        >
          {TODO_COLORS.map(color => (
            <button
              key={color.value}
              type="button"
              className={css.todoColorSwatch}
              style={{ backgroundColor: color.hex }}
              aria-label={todoColorLabel(props.t, color.value)}
              aria-pressed={props.task.color === color.value}
              title={todoColorLabel(props.t, color.value)}
              onClick={() => { void choose(color.value) }}
            >
              {props.task.color === color.value && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function todoHeadingId(view: TodoView): string {
  return view === 'today' ? 'daily-todo-title' : `daily-todo-${view}-title`
}

function todoPanelClass(view: TodoView): string | undefined {
  return view === 'today'
    ? css.todoTodayPanel
    : view === 'important'
      ? css.todoImportantPanel
      : css.todoUrgentPanel
}

function todoTitleLabel(t: TeacherWorkbenchTranslate, view: TodoView): string {
  return view === 'today'
    ? t('daily.todo.title')
    : view === 'important'
      ? t('daily.todo.important')
      : t('daily.todo.urgent')
}

function todoComposerLabel(t: TeacherWorkbenchTranslate, view: TodoView): string {
  return view === 'today'
    ? t('daily.todo.new')
    : view === 'important'
      ? t('daily.todo.newImportant')
      : t('daily.todo.newUrgent')
}

function todoComposerPlaceholder(t: TeacherWorkbenchTranslate, view: TodoView): string {
  return view === 'today'
    ? t('daily.todo.placeholder')
    : view === 'important'
      ? t('daily.todo.placeholderImportant')
      : t('daily.todo.placeholderUrgent')
}

function todoEmptyLabel(t: TeacherWorkbenchTranslate, view: TodoView): string {
  return view === 'today'
    ? t('daily.todo.empty')
    : view === 'important'
      ? t('daily.todo.emptyImportant')
      : t('daily.todo.emptyUrgent')
}

function todoColorHex(color: TeacherDailyTodoColor): string {
  const entry = TODO_COLORS.find(candidate => candidate.value === color)
  if (entry === undefined) throw new Error(`Unsupported daily-todo color: ${color}`)
  return entry.hex
}

function todoColorLabel(t: TeacherWorkbenchTranslate, color: TeacherDailyTodoColor): string {
  switch (color) {
    case 'red': return t('daily.todo.color.red')
    case 'orange': return t('daily.todo.color.orange')
    case 'amber': return t('daily.todo.color.amber')
    case 'yellow': return t('daily.todo.color.yellow')
    case 'green': return t('daily.todo.color.green')
    case 'teal': return t('daily.todo.color.teal')
    case 'cyan': return t('daily.todo.color.cyan')
    case 'blue': return t('daily.todo.color.blue')
    case 'violet': return t('daily.todo.color.violet')
    case 'pink': return t('daily.todo.color.pink')
  }
  return assertNeverColor(color)
}

function assertNeverColor(color: never): never {
  throw new Error(`Unsupported daily-todo color: ${String(color)}`)
}

function compareTodos(left: TeacherDailyTodo, right: TeacherDailyTodo): number {
  if (left.completed !== right.completed) return left.completed ? 1 : -1
  if (left.dueAt === '' && right.dueAt !== '') return 1
  if (left.dueAt !== '' && right.dueAt === '') return -1
  if (left.dueAt !== right.dueAt) return left.dueAt.localeCompare(right.dueAt)
  return right.createdAt - left.createdAt
}

function joinSpeech(current: string, transcript: string): string {
  return current.trim() === '' ? transcript : `${current.trim()} ${transcript}`
}

function isPast(value: string): boolean {
  return value < localDateTimeNow()
}

function localDateTimeNow(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function formatLocalDateTime(value: string): string {
  return value.replace('T', ' ')
}
