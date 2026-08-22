import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  listScheduledReminderTasks,
  nextReminderOccurrence,
  TeacherReminderRuntime,
  type MobileNotificationGateway,
  type MobileNotificationRequest,
  type ReminderOccurrence,
} from '../src/mobile-reminders.ts'
import { INITIAL_TEACHER_WORKBENCH_STATE } from '../src/spec.ts'
import type {
  TeacherDailyTodoId,
  TeacherLedgerCategoryId,
  TeacherLedgerEntryId,
  TeacherMobileBotId,
  TeacherQuickNoteId,
  TeacherReminder,
  TeacherWorkbenchState,
} from '../src/types.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('teacher mobile reminders', () => {
  it('aligns repeated occurrences to the deadline and advances after delivery', () => {
    const reminder = repeatReminder('2026-08-22T12:00:00.000Z', Date.parse('2026-08-22T09:00:00.000Z'))
    const initial = stateWithTodo(reminder)

    const first = nextReminderOccurrence(initial, Date.parse('2026-08-22T09:30:00.000Z'))
    expect(first?.occurrenceAt).toBe('2026-08-22T10:00:00.000Z')

    const advanced = stateWithTodo({ ...reminder, lastOccurrenceAt: first!.occurrenceAt })
    expect(nextReminderOccurrence(advanced, Date.parse('2026-08-22T10:30:00.000Z'))?.occurrenceAt)
      .toBe('2026-08-22T11:00:00.000Z')
    expect(listScheduledReminderTasks(initial, Date.parse('2026-08-22T09:30:00.000Z'))).toMatchObject([{
      key: 'teacher-workbench:todo:todo-reminder',
      title: '交材料',
      nextRun: '2026-08-22T10:00:00.000Z',
      channel: 'telegram',
      botLabel: 'Primary',
    }])
  })

  it('sends a due reminder and durably marks only its exact configuration', async () => {
    const now = Date.parse('2026-08-22T09:30:00.000Z')
    vi.useFakeTimers({ now })
    let state = stateWithTodo({
      channel: 'telegram',
      botId: 'bot-primary' as TeacherMobileBotId,
      botLabel: 'Primary',
      dueAtUtc: '2026-08-22T10:00:00.000Z',
      rule: { kind: 'once', minutesBefore: 30 },
      configuredAt: now - 1,
      lastOccurrenceAt: '',
    })
    const send = vi.fn(async (_request: MobileNotificationRequest) => undefined)
    const gateway: MobileNotificationGateway = { listTargets: async () => [], send }
    const ctx = {
      get: (name: string) => name === 'mobileNotifications' ? gateway : undefined,
      logger: { warn: vi.fn(), error: vi.fn() },
    } as unknown as Context
    const mark = vi.fn(async (occurrence: ReminderOccurrence) => {
      state = stateWithTodo({
        ...occurrence.reminder,
        lastOccurrenceAt: occurrence.occurrenceAt,
      })
    })
    const runtime = new TeacherReminderRuntime(ctx, () => state, mark, 60_000)

    runtime.requestDrive()
    await vi.waitFor(() => { expect(send).toHaveBeenCalledOnce() })
    expect(send.mock.calls[0]?.[0]).toMatchObject({ channel: 'telegram', botId: 'bot-primary' })
    expect(send.mock.calls[0]?.[0].text).toContain('事项：交材料')
    await vi.waitFor(() => { expect(mark).toHaveBeenCalledOnce() })
    expect(nextReminderOccurrence(state, now)).toBeUndefined()

    await runtime.dispose()
  })

  it('projects memo and ledger reminders into the shared scheduled-task list', () => {
    const reminder = repeatReminder('2099-08-22T12:00:00.000Z', Date.parse('2099-08-22T09:00:00.000Z'))
    const state: TeacherWorkbenchState = {
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      quickNotes: [{
        id: 'memo-reminder' as TeacherQuickNoteId,
        content: '联系家长',
        remindAt: '2099-08-22T20:00',
        reminder,
        createdAt: reminder.configuredAt,
        updatedAt: reminder.configuredAt,
      }],
      ledgerCategories: [{
        id: 'ledger-category' as TeacherLedgerCategoryId,
        name: '保险保费',
        createdAt: reminder.configuredAt,
      }],
      ledgerEntries: [{
        id: 'ledger-reminder' as TeacherLedgerEntryId,
        categoryId: 'ledger-category' as TeacherLedgerCategoryId,
        description: '续交车险',
        amountCents: 120_000,
        occurredAt: '2099-08-01T10:00',
        remindAt: '2099-08-22T20:00',
        reminder,
        createdAt: reminder.configuredAt,
        updatedAt: reminder.configuredAt,
      }],
    }

    expect(listScheduledReminderTasks(state, Date.parse('2099-08-22T09:30:00.000Z'))).toMatchObject([
      { key: 'teacher-workbench:memo:memo-reminder', owner: 'memo', title: '联系家长' },
      { key: 'teacher-workbench:ledger:ledger-reminder', owner: 'ledger', title: '续交车险' },
    ])
  })
})

function repeatReminder(dueAtUtc: string, configuredAt: number): TeacherReminder {
  return {
    channel: 'telegram',
    botId: 'bot-primary' as TeacherMobileBotId,
    botLabel: 'Primary',
    dueAtUtc,
    rule: { kind: 'repeat', everyMinutes: 60 },
    configuredAt,
    lastOccurrenceAt: '',
  }
}

function stateWithTodo(reminder: TeacherReminder): TeacherWorkbenchState {
  return {
    ...INITIAL_TEACHER_WORKBENCH_STATE,
    dailyTodos: [{
      id: 'todo-reminder' as TeacherDailyTodoId,
      title: '交材料',
      dueAt: '2026-08-22T18:00',
      completed: false,
      category: 'today',
      color: 'blue',
      reminder,
      createdAt: reminder.configuredAt,
      updatedAt: reminder.configuredAt,
    }],
  }
}
