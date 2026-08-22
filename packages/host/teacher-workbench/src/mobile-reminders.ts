/** Mobile-notification projection and timer owner for teacher-workbench reminders. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  TeacherCalendarItem,
  TeacherDailyTodo,
  TeacherLedgerEntry,
  TeacherMobileBotId,
  TeacherMobileChannel,
  TeacherNotificationTarget,
  TeacherQuickNote,
  TeacherReminder,
  TeacherWorkbenchState,
} from './types.ts'

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MOBILE_CHANNELS = new Set<TeacherMobileChannel>([
  'weixin', 'feishu', 'dingtalk', 'wecom', 'qq', 'slack', 'telegram', 'discord', 'whatsapp',
])

/** Request accepted by the optional dsh-im notification provider. */
export interface MobileNotificationRequest {
  /** Platform selected for the reminder. */
  readonly channel: TeacherMobileChannel
  /** Bot selected within that platform. */
  readonly botId: TeacherMobileBotId
  /** Complete user-visible reminder text. */
  readonly text: string
}

/** Optional service contributed by dsh-im when mobile channels are installed. */
export interface MobileNotificationGateway {
  /** List configured bots without returning credentials or conversation identifiers. */
  listTargets: () => Promise<readonly TeacherNotificationTarget[]>
  /** Send text to the bot's most recently remembered private conversation. */
  send: (request: MobileNotificationRequest) => Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional dsh-im mobile-notification provider. */
    mobileNotifications: MobileNotificationGateway
  }
}

/**
 * Validate the external provider's public bot projection before it crosses the Remote wire.
 * @param ctx - Host context that may contain the dsh-im provider.
 * @returns Credential-free configured notification targets, or an empty list without a provider.
 */
export async function listMobileNotificationTargets(ctx: Context): Promise<readonly TeacherNotificationTarget[]> {
  const gateway = ctx.get('mobileNotifications')
  if (gateway === undefined) return Object.freeze([])
  const value: unknown = await gateway.listTargets()
  if (!Array.isArray(value)) throw new Error('mobileNotifications.listTargets() must return an array')
  return Object.freeze(value.map((candidate) => {
    if (!recordObject(candidate)
      || typeof candidate.channel !== 'string'
      || !MOBILE_CHANNELS.has(candidate.channel as TeacherMobileChannel)
      || typeof candidate.botId !== 'string' || candidate.botId.trim() === ''
      || typeof candidate.label !== 'string' || candidate.label.trim() === ''
      || typeof candidate.connected !== 'boolean') {
      throw new Error('mobileNotifications returned an invalid notification target')
    }
    return Object.freeze({
      channel: candidate.channel as TeacherMobileChannel,
      botId: candidate.botId as TeacherMobileBotId,
      label: candidate.label.trim(),
      connected: candidate.connected,
    })
  }))
}

/** Exact durable reminder occurrence selected for delivery and acknowledgment. */
export interface ReminderOccurrence {
  /** Kind of workbench row that owns the reminder. */
  readonly owner: 'todo' | 'memo' | 'ledger' | 'calendar'
  /** Opaque id of the owning row. */
  readonly id: string
  /** User-visible row title. */
  readonly title: string
  /** Optional user-visible details. */
  readonly details: string
  /** Local deadline text included in the notification. */
  readonly deadline: string
  /** Reminder configuration that must still match when delivery is acknowledged. */
  readonly reminder: TeacherReminder
  /** UTC timestamp for this occurrence. */
  readonly occurrenceAt: string
}

/** Credential-free scheduled reminder projected for a shared task list. */
export interface TeacherScheduledReminderTask {
  /** Stable key derived from the workbench row identity. */
  readonly key: string
  /** Kind of workbench row that owns the reminder. */
  readonly owner: 'todo' | 'memo' | 'ledger' | 'calendar'
  /** User-visible row title. */
  readonly title: string
  /** Local deadline displayed by the workbench. */
  readonly deadline: string
  /** UTC instant of the next eligible occurrence. */
  readonly nextRun: string
  /** Platform selected for delivery. */
  readonly channel: TeacherMobileChannel
  /** Last known selected bot label. */
  readonly botLabel: string
  /** One-shot lead or repeat interval. */
  readonly rule: TeacherReminder['rule']
}

/** Process-local projection of durable workbench reminders. */
export class TeacherReminderRuntime {
  private timer: ReturnType<typeof setTimeout> | undefined
  private run: Promise<void> | undefined
  private requested = false
  private stopping = false

  /**
   * @param ctx - Host context that may contain the dsh-im provider.
   * @param state - Current durable workbench state.
   * @param markDelivered - Durable commit performed after provider acceptance.
   * @param retryMs - Delay before retrying a failed or unavailable delivery.
   */
  constructor(
    private readonly ctx: Context,
    private readonly state: () => TeacherWorkbenchState,
    private readonly markDelivered: (occurrence: ReminderOccurrence) => Promise<void>,
    private readonly retryMs: number,
  ) {}

  /** Recompute the nearest occurrence after a durable document change. */
  requestDrive(): void {
    if (this.stopping) return
    this.requested = true
    this.clearTimer()
    if (this.run !== undefined) return
    const run = this.runRequested()
    this.run = run
    void run.then(
      () => { this.finishRun(run) },
      (error: unknown) => {
        this.ctx.logger.error(`teacher-workbench: reminder scheduler failed: ${renderThrown(error)}`)
        this.finishRun(run)
      },
    )
  }

  /** Stop timers and await the exact in-flight provider call and durable commit. */
  async dispose(): Promise<void> {
    this.stopping = true
    this.requested = false
    this.clearTimer()
    await this.run?.catch(() => undefined)
  }

  private async runRequested(): Promise<void> {
    while (this.requested && !this.stopping) {
      this.requested = false
      await this.driveOnce()
    }
  }

  private async driveOnce(): Promise<void> {
    const now = Date.now()
    const occurrence = nextReminderOccurrence(this.state(), now)
    if (occurrence === undefined) return
    const target = Date.parse(occurrence.occurrenceAt)
    if (target > now) {
      this.arm(target - now)
      return
    }
    const gateway = this.ctx.get('mobileNotifications')
    if (gateway === undefined) {
      this.arm(this.retryMs)
      return
    }
    try {
      await gateway.send({
        channel: occurrence.reminder.channel,
        botId: occurrence.reminder.botId,
        text: renderReminder(occurrence),
      })
      await this.markDelivered(occurrence)
      this.requested = true
    } catch (error: unknown) {
      this.ctx.logger.warn(`teacher-workbench: reminder delivery failed: ${renderThrown(error)}`)
      this.arm(this.retryMs)
    }
  }

  private arm(delay: number): void {
    if (this.stopping) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.requestDrive()
    }, Math.min(Math.max(1, delay), MAX_TIMER_DELAY_MS))
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private finishRun(run: Promise<void>): void {
    if (this.run === run) this.run = undefined
    if (this.requested && !this.stopping) this.requestDrive()
  }
}

/**
 * Resolve the next undelivered occurrence across active workbench reminders.
 * @param state - Current durable teacher-workbench state.
 * @param now - Current Unix timestamp in milliseconds.
 * @returns Earliest eligible occurrence, or `undefined` when no reminder remains.
 */
export function nextReminderOccurrence(
  state: TeacherWorkbenchState,
  now: number,
): ReminderOccurrence | undefined {
  return reminderOccurrences(state, now)[0]
}

/**
 * Project every active reminder into one credential-free scheduled-task row.
 * @param state - Current durable teacher-workbench state.
 * @param now - Current Unix timestamp in milliseconds.
 * @returns Tasks ordered by their next eligible occurrence.
 */
export function listScheduledReminderTasks(
  state: TeacherWorkbenchState,
  now: number,
): readonly TeacherScheduledReminderTask[] {
  return Object.freeze(reminderOccurrences(state, now).map(occurrence => Object.freeze({
    key: `teacher-workbench:${occurrence.owner}:${occurrence.id}`,
    owner: occurrence.owner,
    title: occurrence.title,
    deadline: occurrence.deadline,
    nextRun: occurrence.occurrenceAt,
    channel: occurrence.reminder.channel,
    botLabel: occurrence.reminder.botLabel,
    rule: Object.freeze({ ...occurrence.reminder.rule }),
  })))
}

function reminderOccurrences(state: TeacherWorkbenchState, now: number): ReminderOccurrence[] {
  const occurrences: ReminderOccurrence[] = []
  for (const item of state.dailyTodos) {
    if (item.completed || item.reminder === undefined) continue
    const occurrenceAt = reminderOccurrence(item.reminder, now)
    if (occurrenceAt !== undefined) occurrences.push(todoOccurrence(item, item.reminder, occurrenceAt))
  }
  for (const item of state.quickNotes) {
    if (item.reminder === undefined) continue
    const occurrenceAt = reminderOccurrence(item.reminder, now)
    if (occurrenceAt !== undefined) occurrences.push(memoOccurrence(item, item.reminder, occurrenceAt))
  }
  for (const item of state.ledgerEntries) {
    if (item.reminder === undefined) continue
    const occurrenceAt = reminderOccurrence(item.reminder, now)
    if (occurrenceAt !== undefined) occurrences.push(ledgerOccurrence(item, item.reminder, occurrenceAt))
  }
  for (const item of state.calendarItems) {
    if (item.reminder === undefined) continue
    const occurrenceAt = reminderOccurrence(item.reminder, now)
    if (occurrenceAt !== undefined) occurrences.push(calendarOccurrence(item, item.reminder, occurrenceAt))
  }
  return occurrences.sort((left, right) => left.occurrenceAt.localeCompare(right.occurrenceAt))
}

function reminderOccurrence(reminder: TeacherReminder, now: number): string | undefined {
  const due = Date.parse(reminder.dueAtUtc)
  if (now > due) return undefined
  const last = reminder.lastOccurrenceAt === '' ? reminder.configuredAt : Date.parse(reminder.lastOccurrenceAt)
  if (reminder.rule.kind === 'once') {
    if (reminder.lastOccurrenceAt !== '') return undefined
    const target = due - reminder.rule.minutesBefore * 60_000
    return target > reminder.configuredAt ? new Date(target).toISOString() : undefined
  }
  const interval = reminder.rule.everyMinutes * 60_000
  const distance = due - last
  if (distance <= 0) return undefined
  const stepsBack = Math.max(0, Math.ceil(distance / interval) - 1)
  const target = due - stepsBack * interval
  return target > last && target <= due ? new Date(target).toISOString() : undefined
}

function todoOccurrence(item: TeacherDailyTodo, reminder: TeacherReminder, occurrenceAt: string): ReminderOccurrence {
  return {
    owner: 'todo',
    id: item.id,
    title: item.title,
    details: '',
    deadline: item.dueAt.replace('T', ' '),
    reminder,
    occurrenceAt,
  }
}

function memoOccurrence(item: TeacherQuickNote, reminder: TeacherReminder, occurrenceAt: string): ReminderOccurrence {
  return {
    owner: 'memo',
    id: item.id,
    title: item.content,
    details: '',
    deadline: item.remindAt?.replace('T', ' ') ?? '',
    reminder,
    occurrenceAt,
  }
}

function ledgerOccurrence(item: TeacherLedgerEntry, reminder: TeacherReminder, occurrenceAt: string): ReminderOccurrence {
  return {
    owner: 'ledger',
    id: item.id,
    title: item.description,
    details: `金额：${formatCny(item.amountCents)}`,
    deadline: item.remindAt?.replace('T', ' ') ?? '',
    reminder,
    occurrenceAt,
  }
}

function calendarOccurrence(item: TeacherCalendarItem, reminder: TeacherReminder, occurrenceAt: string): ReminderOccurrence {
  return {
    owner: 'calendar',
    id: item.id,
    title: item.title,
    details: item.details,
    deadline: `${item.date} ${item.time}`,
    reminder,
    occurrenceAt,
  }
}

function renderReminder(occurrence: ReminderOccurrence): string {
  const lines = [
    '⏰ DeepSeek Harness 事项提醒',
    `事项：${occurrence.title}`,
    `截止：${occurrence.deadline}`,
  ]
  if (occurrence.details.trim() !== '') lines.push(`详情：${occurrence.details.trim()}`)
  return lines.join('\n')
}

function formatCny(cents: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100)
}

function renderThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function recordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
