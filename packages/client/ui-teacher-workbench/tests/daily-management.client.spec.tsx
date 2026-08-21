// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeacherCalendarItemId,
  TeacherDailyTodoId,
  TeacherLedgerCategoryId,
  TeacherLedgerEntryId,
  TeacherQuickNoteId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import { DEFAULT_TEACHER_WORKBENCH_SETTINGS } from '../src/settings.ts'
import { CalendarPanel } from '../src/client/CalendarPanel.tsx'
import { buildTeacherCalendarMonth } from '../src/client/calendar-data.ts'
import { DailyManagement } from '../src/client/DailyManagement.tsx'
import { DailyTodoPanel } from '../src/client/DailyTodoPanel.tsx'
import { QuickNotesPanel } from '../src/client/QuickNotesPanel.tsx'
import { LedgerPanel } from '../src/client/LedgerPanel.tsx'
import type { TeacherWorkbenchCommands } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
})

const emptyState = (): TeacherWorkbenchState => ({
  dailyTodos: [], quickNotes: [], ledgerCategories: [], ledgerEntries: [], calendarItems: [], timetableEntries: [],
  classes: [], students: [], resources: [], templates: [], records: [], exams: [],
  questionBatches: [], questionFolders: [], questionAssignments: [],
})

function commands(): TeacherWorkbenchCommands {
  const action = () => vi.fn(async () => ({ ok: true } as const))
  return {
    saveDailyTodo: action(), toggleDailyTodo: action(), deleteDailyTodo: action(),
    saveQuickNote: action(), deleteQuickNote: action(),
    saveLedgerCategory: action(), deleteLedgerCategory: action(),
    saveLedgerEntry: action(), deleteLedgerEntry: action(),
    saveCalendarItem: action(), deleteCalendarItem: action(),
    extractDocument: vi.fn(async () => ({ ok: false, error: { code: 'provider-unavailable', message: 'unavailable' } } as const)),
    normalizeTimetable: vi.fn(async () => ({ ok: false, error: { code: 'tool-model-unavailable', message: 'unavailable' } } as const)),
    extractQuestionLayout: vi.fn(async () => ({ ok: false, error: { code: 'provider-unavailable', message: 'unavailable' } } as const)),
    importCalendarItems: action(),
    saveTimetableEntry: action(),
    deleteTimetableEntry: action(),
    importTimetableEntries: action(),
    saveClass: action(), deleteClass: action(), saveStudent: action(), importStudents: action(),
    deleteStudent: action(), createQuestionFolder: action(), deleteQuestionFolder: action(),
    saveResource: action(), deleteResource: action(), saveTemplate: action(),
    deleteTemplate: action(), saveRecord: action(), toggleRecord: action(), deleteRecord: action(),
    saveExam: action(), deleteExam: action(),
    saveQuestionBatch: action(), replaceQuestionImage: action(), deleteQuestionImage: action(),
    deleteQuestionBatch: action(), assignQuestions: action(),
    saveTemporaryQuestionSelection: vi.fn(async () => ({ ok: false, error: { code: 'storage-failure', message: 'unavailable' } } as const)),
    listTemporaryQuestionSelections: vi.fn(async () => ({ ok: false, error: { code: 'storage-failure', message: 'unavailable' } } as const)),
    readQuestionImage: vi.fn(async () => ({ ok: false, error: { code: 'storage-failure', message: 'unavailable' } } as const)),
    generateQuestionDocument: vi.fn(async () => ({ ok: false, error: { code: 'generation-failure', message: 'unavailable' } } as const)),
    generateUploadedQuestionDocument: vi.fn(async () => ({ ok: false, error: { code: 'generation-failure', message: 'unavailable' } } as const)),
    generateStudentDocuments: vi.fn(async () => ({ ok: false, error: { code: 'generation-failure', message: 'unavailable' } } as const)),
  }
}

const failure = { ok: false, error: { code: 'test', message: 'rejected' } } as const

class RecognitionMock {
  static instances: RecognitionMock[] = []
  lang = ''
  continuous = true
  interimResults = true
  maxAlternatives = 0
  onresult: ((event: never) => void) | null = null
  onerror: ((event: never) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => { this.onend?.() })
  abort = vi.fn()

  constructor() {
    RecognitionMock.instances.push(this)
  }

  emitFinal(transcript: string): void {
    this.onresult?.({
      resultIndex: 0,
      results: { 0: { 0: { transcript }, length: 1, isFinal: true }, length: 1 },
    } as never)
  }
}

afterEach(() => {
  cleanup()
  RecognitionMock.instances = []
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('daily todo panel', () => {
  it('adds by speech, edits, completes, and deletes deadline-aware tasks', async () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    const c = commands()
    const rendered = render(
      <DailyTodoPanel state={emptyState()} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )
    const todayCard = screen.getByRole('region', { name: '今日待办' })

    fireEvent.click(within(todayCard).getByRole('button', { name: '开始语音输入' }))
    expect(RecognitionMock.instances[0]).toMatchObject({
      lang: 'zh-CN', continuous: false, interimResults: false, maxAlternatives: 1,
    })
    act(() => { RecognitionMock.instances[0]!.emitFinal('批改作业') })
    fireEvent.change(within(todayCard).getByLabelText('截止时间'), { target: { value: '2026-08-18T18:30' } })
    fireEvent.click(within(todayCard).getByRole('button', { name: '添加待办' }))
    await waitFor(() => {
      expect(c.saveDailyTodo).toHaveBeenCalledWith({
        title: '批改作业', dueAt: '2026-08-18T18:30',
        category: 'today', color: 'blue',
      })
    })

    const todoId = 'todo-a' as TeacherDailyTodoId
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      dailyTodos: [{
        id: todoId, title: '批改作业', dueAt: '2026-08-18T18:30', completed: false,
        category: 'today', color: 'blue',
        createdAt: 1, updatedAt: 1,
      }],
    }
    rendered.rerender(
      <DailyTodoPanel state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )
    fireEvent.click(within(todayCard).getByRole('checkbox', { name: '切换“批改作业”完成状态' }))
    expect(c.toggleDailyTodo).toHaveBeenCalledWith(todoId)
    expect(within(todayCard).queryByRole('button', { name: /“批改作业”的颜色标记/ })).toBeNull()

    fireEvent.click(within(todayCard).getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('事项'), { target: { value: '批改试卷' } })
    const editor = screen.getByRole('dialog', { name: '编辑待办' })
    fireEvent.change(within(editor).getByLabelText('截止时间'), { target: { value: '' } })
    fireEvent.click(within(editor).getByRole('radio', { name: '重要事项' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.saveDailyTodo).toHaveBeenLastCalledWith({
        id: todoId, title: '批改试卷', dueAt: '', completed: false,
        category: 'important', color: 'blue',
      })
    })

    fireEvent.click(within(todayCard).getByRole('button', { name: '删除' }))
    expect(c.deleteDailyTodo).toHaveBeenCalledWith(todoId)
  })

  it('sorts task states and keeps failed additions and edits available to retry', async () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const c = commands()
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      dailyTodos: [
        { id: 'done' as TeacherDailyTodoId, title: '已完成', dueAt: '2000-01-01T08:00', completed: true, category: 'today', color: 'blue', createdAt: 1, updatedAt: 1 },
        { id: 'none' as TeacherDailyTodoId, title: '无期限', dueAt: '', completed: false, category: 'urgent', color: 'cyan', createdAt: 1, updatedAt: 1 },
        { id: 'later-old' as TeacherDailyTodoId, title: '稍后旧', dueAt: '2099-01-02T08:00', completed: false, category: 'important', color: 'amber', createdAt: 1, updatedAt: 1 },
        { id: 'past' as TeacherDailyTodoId, title: '已逾期', dueAt: '2000-01-01T09:00', completed: false, category: 'today', color: 'red', createdAt: 1, updatedAt: 1 },
        { id: 'later-new' as TeacherDailyTodoId, title: '稍后新', dueAt: '2099-01-02T08:00', completed: false, category: 'today', color: 'green', createdAt: 2, updatedAt: 2 },
      ],
    }
    const rendered = render(
      <DailyTodoPanel state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )
    const todayCard = screen.getByRole('region', { name: '今日待办' })
    const importantCard = screen.getByRole('region', { name: '重要事项' })
    const urgentCard = screen.getByRole('region', { name: '紧急事项' })
    expect(within(todayCard).getAllByRole('checkbox').map(input => input.getAttribute('aria-label'))).toEqual([
      '切换“已逾期”完成状态',
      '切换“稍后新”完成状态',
      '切换“已完成”完成状态',
    ])
    expect(within(todayCard).getByRole<HTMLInputElement>('checkbox', { name: '切换“已完成”完成状态' }).checked).toBe(true)

    expect(within(importantCard).getByText('稍后旧')).toBeTruthy()
    expect(within(importantCard).queryByText('已逾期')).toBeNull()
    expect(within(importantCard).queryByText('无期限')).toBeNull()
    fireEvent.click(within(importantCard).getByRole('button', { name: '更改“稍后旧”的颜色标记，当前为琥珀色' }))
    const palette = screen.getByRole('group', { name: '选择事项标记颜色' })
    expect(within(palette).getAllByRole('button')).toHaveLength(10)
    fireEvent.click(within(palette).getByRole('button', { name: '红色' }))
    await waitFor(() => {
      expect(c.saveDailyTodo).toHaveBeenLastCalledWith({
        id: 'later-old', title: '稍后旧', dueAt: '2099-01-02T08:00', completed: false,
        category: 'important', color: 'red',
      })
    })
    fireEvent.change(within(importantCard).getByLabelText('新增重要事项'), { target: { value: '准备公开课' } })
    fireEvent.click(within(importantCard).getByRole('button', { name: '添加待办' }))
    await waitFor(() => {
      expect(c.saveDailyTodo).toHaveBeenCalledWith({
        title: '准备公开课', dueAt: '', category: 'important', color: 'blue',
      })
    })
    expect(within(urgentCard).getByText('无期限')).toBeTruthy()
    expect(within(urgentCard).getByText('未设置截止时间')).toBeTruthy()
    expect(within(urgentCard).queryByText('已逾期')).toBeNull()
    expect(within(urgentCard).queryByText('稍后旧')).toBeNull()
    vi.mocked(c.saveDailyTodo).mockClear()

    const newTitle = within(todayCard).getByLabelText('新增今日待办')
    fireEvent.submit(newTitle.closest('form')!)
    expect(c.saveDailyTodo).not.toHaveBeenCalled()
    fireEvent.change(newTitle, { target: { value: '手动事项' } })
    vi.mocked(c.saveDailyTodo).mockResolvedValueOnce(failure)
    fireEvent.click(within(todayCard).getByRole('button', { name: '添加待办' }))
    await waitFor(() => {
      expect(c.saveDailyTodo).toHaveBeenCalledWith({
        title: '手动事项', dueAt: '', category: 'today', color: 'blue',
      })
    })
    expect((newTitle as HTMLInputElement).value).toBe('手动事项')
    fireEvent.click(within(todayCard).getByRole('button', { name: '添加待办' }))
    await waitFor(() => { expect((newTitle as HTMLInputElement).value).toBe('') })

    const pastRow = within(todayCard).getByText('已逾期').closest('article')!
    fireEvent.click(within(pastRow).getByRole('button', { name: '编辑' }))
    const editor = screen.getByRole('dialog', { name: '编辑待办' })
    fireEvent.click(within(editor).getByRole('button', { name: '开始语音输入' }))
    act(() => { RecognitionMock.instances[0]!.emitFinal('补充') })
    expect(within(editor).getByLabelText<HTMLInputElement>('事项').value).toBe('已逾期 补充')
    vi.mocked(c.saveDailyTodo).mockResolvedValueOnce(failure)
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveDailyTodo).toHaveBeenCalledWith(expect.objectContaining({ title: '已逾期 补充' })) })
    expect(screen.getByRole('dialog', { name: '编辑待办' })).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '编辑待办' })).toBeNull() })

    fireEvent.click(within(pastRow).getByRole('button', { name: '删除' }))
    expect(c.deleteDailyTodo).not.toHaveBeenCalled()
    fireEvent.click(within(pastRow).getByRole('button', { name: '删除' }))
    expect(c.deleteDailyTodo).toHaveBeenCalledWith('past')
    expect(confirm).toHaveBeenCalledTimes(2)

    rendered.rerender(
      <DailyTodoPanel
        state={{ ...state, dailyTodos: [...state.dailyTodos].reverse() }}
        settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
        commands={c}
        t={t}
      />,
    )
  })
})

describe('quick notes panel', () => {
  it('creates a speech draft and edits or deletes each note', async () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    const c = commands()
    const rendered = render(
      <QuickNotesPanel state={emptyState()} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    act(() => { RecognitionMock.instances[0]!.emitFinal('记录课堂观察') })
    expect(screen.getByLabelText<HTMLTextAreaElement>('随记内容').value).toBe('记录课堂观察')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveQuickNote).toHaveBeenCalledWith({ content: '记录课堂观察' }) })

    const noteId = 'note-a' as TeacherQuickNoteId
    rendered.rerender(
      <QuickNotesPanel
        state={{
          ...emptyState(),
          quickNotes: [{ id: noteId, content: '记录课堂观察', createdAt: 1, updatedAt: 2 }],
        }}
        settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
        commands={c}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('随记内容'), { target: { value: '调整课堂节奏' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.saveQuickNote).toHaveBeenLastCalledWith({ id: noteId, content: '调整课堂节奏' })
    })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(c.deleteQuickNote).toHaveBeenCalledWith(noteId)
  })

  it('supports manual drafts, speech append, note-body editing, sorting, and failed saves', async () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const c = commands()
    const oldId = 'note-old' as TeacherQuickNoteId
    const newId = 'note-new' as TeacherQuickNoteId
    render(
      <QuickNotesPanel
        state={{
          ...emptyState(),
          quickNotes: [
            { id: oldId, content: '较早随记', createdAt: 1, updatedAt: 1 },
            { id: newId, content: '较新随记', createdAt: 2, updatedAt: 2 },
          ],
        }}
        settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
        commands={c}
        t={t}
      />,
    )
    expect(screen.getAllByRole('button').filter(button => ['较新随记', '较早随记'].some(text => button.textContent?.includes(text))).map(button => button.textContent?.includes('较新随记'))).toEqual([true, false])

    fireEvent.click(screen.getByRole('button', { name: '添加随记' }))
    const editor = screen.getByRole('dialog', { name: '添加随记' })
    const content = within(editor).getByLabelText<HTMLTextAreaElement>('随记内容')
    fireEvent.change(content, { target: { value: '手动记录  ' } })
    fireEvent.click(within(editor).getByRole('button', { name: '开始语音输入' }))
    act(() => { RecognitionMock.instances[0]!.emitFinal('语音补充') })
    expect(content.value).toBe('手动记录\n语音补充')
    vi.mocked(c.saveQuickNote).mockResolvedValueOnce(failure)
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveQuickNote).toHaveBeenCalledWith({ content: '手动记录\n语音补充' }) })
    expect(screen.getByRole('dialog', { name: '添加随记' })).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '添加随记' })).toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: '添加随记' }))
    const emptyEditor = screen.getByRole('dialog', { name: '添加随记' })
    fireEvent.click(within(emptyEditor).getByRole('button', { name: '开始语音输入' }))
    act(() => { RecognitionMock.instances[1]!.emitFinal('纯语音记录') })
    expect(within(emptyEditor).getByLabelText<HTMLTextAreaElement>('随记内容').value).toBe('纯语音记录')
    fireEvent.click(within(emptyEditor).getByRole('button', { name: '取消' }))

    fireEvent.click(screen.getByText('较新随记'))
    expect(screen.getByRole('dialog', { name: '编辑随记' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    const oldRow = screen.getByText('较早随记').closest('article')!
    fireEvent.click(within(oldRow).getByRole('button', { name: '删除' }))
    expect(c.deleteQuickNote).not.toHaveBeenCalled()
    fireEvent.click(within(oldRow).getByRole('button', { name: '删除' }))
    expect(c.deleteQuickNote).toHaveBeenCalledWith(oldId)
    expect(confirm).toHaveBeenCalledTimes(2)
  })
})

describe('ledger panel', () => {
  it('opens from the compact card and manages category entries with voice and time', async () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    const categoryId = 'ledger-category-a' as TeacherLedgerCategoryId
    const entryId = 'ledger-entry-a' as TeacherLedgerEntryId
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      ledgerCategories: [{ id: categoryId, name: '水电燃气', createdAt: 1 }],
      ledgerEntries: [{
        id: entryId,
        categoryId,
        description: '七月电费',
        amountCents: 8_880,
        occurredAt: '2026-08-01T08:30',
        createdAt: 1,
        updatedAt: 1,
      }],
    }
    const c = commands()
    const expand = vi.fn()
    const rendered = render(
      <LedgerPanel
        state={state}
        settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
        commands={c}
        expanded={false}
        onExpand={expand}
        onCollapse={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText('¥88.80')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '打开账本' }))
    expect(expand).toHaveBeenCalledOnce()

    const collapse = vi.fn()
    rendered.rerender(
      <LedgerPanel
        state={state}
        settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
        commands={c}
        expanded
        onExpand={expand}
        onCollapse={collapse}
        t={t}
      />,
    )
    const category = screen.getByRole('article', { name: '水电燃气' })
    expect(within(category).getByTitle('发生时间').getAttribute('data-has-value')).toBe('false')
    expect(within(category).getByLabelText<HTMLInputElement>('发生时间').value).toBe('')
    expect(within(category).getByRole<HTMLButtonElement>('button', { name: '添加明细' }).disabled).toBe(true)
    fireEvent.click(within(category).getByRole('button', { name: '开始语音输入' }))
    act(() => { RecognitionMock.instances[0]!.emitFinal('八月水费') })
    fireEvent.change(within(category).getByLabelText('金额（元）'), { target: { value: '36.50' } })
    fireEvent.change(within(category).getByLabelText('发生时间'), { target: { value: '2026-08-20T19:30' } })
    expect(within(category).getByTitle('发生时间: 2026-08-20 19:30').getAttribute('data-has-value')).toBe('true')
    fireEvent.click(within(category).getByRole('button', { name: '添加明细' }))
    await waitFor(() => {
      expect(c.saveLedgerEntry).toHaveBeenCalledWith({
        categoryId,
        description: '八月水费',
        amountCents: 3_650,
        occurredAt: '2026-08-20T19:30',
      })
    })

    fireEvent.click(within(category).getByText('七月电费'))
    const editor = screen.getByRole('dialog', { name: '编辑账目' })
    fireEvent.change(within(editor).getByLabelText('账目说明'), { target: { value: '七月电费调整' } })
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.saveLedgerEntry).toHaveBeenLastCalledWith({
        id: entryId,
        categoryId,
        description: '七月电费调整',
        amountCents: 8_880,
        occurredAt: '2026-08-01T08:30',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '添加账本分类' }))
    const categoryEditor = screen.getByRole('dialog', { name: '添加账本分类' })
    fireEvent.change(within(categoryEditor).getByLabelText('分类名称'), { target: { value: '房屋费用' } })
    fireEvent.click(within(categoryEditor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveLedgerCategory).toHaveBeenCalledWith({ name: '房屋费用' }) })

    fireEvent.click(within(category).getByRole('button', { name: '删除明细' }))
    expect(c.deleteLedgerEntry).toHaveBeenCalledWith(entryId)
    fireEvent.click(within(category).getByRole('button', { name: '删除分类“水电燃气”' }))
    expect(c.deleteLedgerCategory).toHaveBeenCalledWith(categoryId)
    fireEvent.click(screen.getByRole('button', { name: '恢复日常管理布局' }))
    expect(collapse).toHaveBeenCalledOnce()
  })
})

describe('calendar panel', () => {
  it('shows lunar and agenda data and saves, edits, deletes, and completes dated items', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = commands()
    const today = localDate(new Date())
    const calendarId = 'calendar-a' as TeacherCalendarItemId
    const todoId = 'todo-a' as TeacherDailyTodoId
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      calendarItems: [{
        id: calendarId, date: today, time: '09:00', title: '教研会', details: '会议室',
        createdAt: 1, updatedAt: 1,
      }, {
        id: 'calendar-all-day' as TeacherCalendarItemId, date: today, time: '', title: '全天事项', details: '',
        createdAt: 2, updatedAt: 2,
      }, {
        id: 'calendar-same-time' as TeacherCalendarItemId, date: today, time: '09:00', title: '同刻事项', details: '',
        createdAt: 2, updatedAt: 2,
      }],
      dailyTodos: [{
        id: todoId, title: '提交周报', dueAt: `${today}T17:00`, completed: false,
        category: 'today', color: 'blue',
        createdAt: 1, updatedAt: 1,
      }, {
        id: 'todo-undated' as TeacherDailyTodoId, title: '无日期事项', dueAt: '', completed: false,
        category: 'today', color: 'blue',
        createdAt: 2, updatedAt: 2,
      }, {
        id: 'todo-other-date' as TeacherDailyTodoId, title: '其他日期事项', dueAt: '2099-01-01T08:00', completed: false,
        category: 'today', color: 'blue',
        createdAt: 3, updatedAt: 3,
      }],
    }
    const collapse = vi.fn()
    render(
      <CalendarPanel state={state} commands={c} expanded onExpand={vi.fn()} onCollapse={collapse} t={t} />,
    )

    expect(screen.getAllByText(/农历/)).toHaveLength(2)
    expect(screen.getByText('教研会')).toBeTruthy()
    expect(screen.getByText('全天')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(c.toggleDailyTodo).toHaveBeenCalledWith(todoId)

    fireEvent.click(screen.getByRole('button', { name: '添加当日事项' }))
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '14:30' } })
    fireEvent.change(screen.getByLabelText('事项名称'), { target: { value: '家长会' } })
    fireEvent.change(screen.getByLabelText('详细内容'), { target: { value: '线上' } })
    vi.mocked(c.saveCalendarItem).mockResolvedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.saveCalendarItem).toHaveBeenCalledWith({
        date: '2026-10-01', time: '14:30', title: '家长会', details: '线上',
      })
    })
    expect(screen.getByRole('dialog', { name: '添加当日事项' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '添加当日事项' })).toBeNull() })

    fireEvent.click(screen.getByText('全天事项'))
    expect(screen.getByRole('dialog', { name: '编辑日历事项' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    const researchRow = screen.getByText('教研会').closest('article')!
    fireEvent.click(within(researchRow).getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('事项名称'), { target: { value: '教研会改期' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.saveCalendarItem).toHaveBeenLastCalledWith(expect.objectContaining({
        id: calendarId, title: '教研会改期', date: today,
      }))
    })
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(within(researchRow).getByRole('button', { name: '删除' }))
    expect(c.deleteCalendarItem).not.toHaveBeenCalled()
    fireEvent.click(within(researchRow).getByRole('button', { name: '删除' }))
    expect(c.deleteCalendarItem).toHaveBeenCalledWith(calendarId)
    fireEvent.click(screen.getByRole('button', { name: '恢复日常管理布局' }))
    expect(collapse).toHaveBeenCalledOnce()
  })

  it('extracts a school calendar, lets the teacher review it, and imports once', async () => {
    const c = commands()
    vi.mocked(c.extractDocument).mockResolvedValueOnce({
      ok: true,
      value: {
        name: '五月校历.png',
        mediaType: 'image/png',
        markdown: '福州市马尾第一中学 2026年5月份工作安排\n5月18日\n1. 开旗仪式\n2. 新教师考核周',
        provider: 'mineru',
        truncated: false,
      },
    })
    const rendered = render(
      <CalendarPanel state={emptyState()} commands={c} expanded onExpand={vi.fn()} onCollapse={vi.fn()} t={t} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '识别校历' }))
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['calendar'], '五月校历.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByRole('dialog', { name: '上传并识别校历' })).toBeTruthy()
    expect(await screen.findByText('识别到 2 项，请确认后导入')).toBeTruthy()
    const titles = screen.getAllByLabelText('事项名称')
    fireEvent.change(titles[0]!, { target: { value: '开旗仪式（已确认）' } })
    fireEvent.click(screen.getByRole('button', { name: '导入 2 项' }))
    await waitFor(() => {
      expect(c.importCalendarItems).toHaveBeenCalledWith([
        { date: '2026-05-18', time: '', title: '开旗仪式（已确认）', details: '' },
        { date: '2026-05-18', time: '', title: '新教师考核周', details: '' },
      ])
    })
    expect(screen.queryByRole('dialog', { name: '上传并识别校历' })).toBeNull()
  })

  it('expands a compact day and switches to an adjacent month', () => {
    const c = commands()
    const expand = vi.fn()
    const today = localDate(new Date())
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      calendarItems: [{
        id: 'compact-calendar-item' as TeacherCalendarItemId,
        date: today,
        time: '',
        title: '紧凑日历事项',
        details: '',
        createdAt: 1,
        updatedAt: 1,
      }],
    }
    const rendered = render(
      <CalendarPanel state={state} commands={c} expanded={false} onExpand={expand} onCollapse={vi.fn()} t={t} />,
    )
    expect(rendered.container.querySelector('i')).toBeNull()
    const now = new Date()
    const outsideDate = buildTeacherCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1), now).days.find(day => !day.inMonth)!.date
    const outsideDay = screen.getByRole('button', { name: new RegExp(`^${outsideDate}`) })
    fireEvent.click(outsideDay)
    expect(expand).toHaveBeenCalledOnce()
  })

  it('navigates months and renders holiday, workday, solar-term, empty, and unavailable-schedule details', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 1, 9))
    const c = commands()
    const october = buildTeacherCalendarMonth(new Date(2026, 9, 1), new Date(2026, 9, 1))
    const solarTerm = october.days.find(day => day.solarTerm !== '')!
    const first = render(
      <CalendarPanel state={emptyState()} commands={c} expanded onExpand={vi.fn()} onCollapse={vi.fn()} t={t} />,
    )
    expect(screen.getByText('法定节假日 · 国庆节')).toBeTruthy()
    expect(screen.getByText('这一天还没有安排')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^2026-10-10/ }))
    expect(screen.getByText('国庆节调休上班')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${solarTerm.date}`) }))
    expect(screen.getAllByText(solarTerm.solarTerm).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '下个月' }))
    expect(screen.getByRole('heading', { name: '2026年11月' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下个月' }))
    expect(screen.getByRole('heading', { name: '2026年12月' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '上个月' }))
    expect(screen.getByRole('heading', { name: '2026年11月' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '今天' }))
    expect(screen.getByRole('heading', { name: '2026年10月' })).toBeTruthy()
    first.unmount()

    vi.setSystemTime(new Date(2027, 0, 15, 9))
    const unavailable = render(
      <CalendarPanel state={emptyState()} commands={c} expanded onExpand={vi.fn()} onCollapse={vi.fn()} t={t} />,
    )
    expect(screen.getByText('该年份的法定节假日安排尚未收录')).toBeTruthy()
    unavailable.unmount()

    vi.setSystemTime(new Date(1900, 0, 1, 9))
    const lower = render(
      <CalendarPanel state={emptyState()} commands={c} expanded={false} onExpand={vi.fn()} onCollapse={vi.fn()} t={t} />,
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '上个月' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '下个月' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '上个月' }).disabled).toBe(false)
    lower.unmount()

    vi.setSystemTime(new Date(2100, 11, 1, 9))
    render(<CalendarPanel state={emptyState()} commands={c} expanded={false} onExpand={vi.fn()} onCollapse={vi.fn()} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '下个月' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '上个月' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '下个月' }).disabled).toBe(false)
  })
})

describe('daily management board', () => {
  it('opens weather details by clicking the compact panel', () => {
    render(
      <DailyManagement
        title="日常管理"
        savingLabel={null}
        state={emptyState()}
        settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
        commands={commands()}
        setWeatherLocation={vi.fn(async () => {})}
        loadWeather={vi.fn(async () => { throw new Error('weather is not configured') })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '查看详细天气' }))
    expect(screen.getByLabelText('天气地点')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '恢复日常管理布局' }))
    expect(screen.getByRole('region', { name: '今日待办' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '重要事项' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '紧急事项' })).toBeTruthy()
  })

  it('opens and closes calendar details from the daily dashboard', () => {
    render(
      <DailyManagement
        title="日常管理"
        savingLabel={null}
        state={emptyState()}
        settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
        commands={commands()}
        setWeatherLocation={vi.fn(async () => {})}
        loadWeather={vi.fn(async () => { throw new Error('weather is not configured') })}
        t={t}
      />,
    )
    const calendar = screen.getByRole('region', { name: /年\d+月/ })
    fireEvent.click(within(calendar).getByRole('button', { name: '放大板块' }))
    expect(screen.getByRole('complementary', { name: '当日安排' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '恢复日常管理布局' }))
    expect(screen.queryByRole('complementary', { name: '当日安排' })).toBeNull()
  })
})

function localDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
