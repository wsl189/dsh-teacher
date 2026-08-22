/** Shared mobile-reminder controls for daily-management items. */

import { useEffect, useMemo, useState } from 'react'
import type {
  TeacherMobileChannel,
  TeacherNotificationTarget,
  TeacherReminder,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherReminderInput } from './controller.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Controlled reminder fields shared by daily-management editors. */
export function ReminderFields(props: {
  deadline: string
  value: TeacherReminderInput | null
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onChange: (value: TeacherReminderInput | null) => void
}) {
  const [targets, setTargets] = useState<readonly TeacherNotificationTarget[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    void props.commands.listNotificationTargets().then((value) => {
      if (!live) return
      setTargets(value)
      setLoaded(true)
    })
    return () => { live = false }
  }, [props.commands])
  const channels = useMemo(
    () => [...new Set([
      ...targets.map(target => target.channel),
      ...(props.value === null ? [] : [props.value.channel]),
    ])],
    [props.value, targets],
  )
  const channelTargets = props.value === null
    ? []
    : targets.filter(target => target.channel === props.value?.channel)
  const reminder = props.value
  const deadlineIssue = reminderDeadlineIssue(props.deadline)
  const validationIssue = reminderValidationIssue(props.deadline, props.value)

  const enable = (): void => {
    const target = targets.find(candidate => candidate.connected) ?? targets[0]
    if (target === undefined || deadlineIssue !== null) return
    const remainingMs = new Date(props.deadline).getTime() - Date.now()
    const minutesBefore = Math.min(30, Math.max(0, Math.floor((remainingMs - 1) / 60_000)))
    props.onChange({
      channel: target.channel,
      botId: target.botId,
      botLabel: target.label,
      rule: { kind: 'once', minutesBefore },
    })
  }
  const updateTarget = (channel: TeacherMobileChannel, botId?: string): void => {
    const target = targets.find(candidate => candidate.channel === channel && candidate.botId === botId)
      ?? targets.find(candidate => candidate.channel === channel)
    if (target === undefined || props.value === null) return
    props.onChange({
      ...props.value,
      channel: target.channel,
      botId: target.botId,
      botLabel: target.label,
    })
  }

  return (
    <fieldset className={css.reminderFields}>
      <legend>{props.t('daily.reminder.title')}</legend>
      <label className={css.reminderEnable}>
        <input
          type="checkbox"
          checked={props.value !== null}
          disabled={props.value === null && (deadlineIssue !== null || (loaded && targets.length === 0))}
          onChange={(event) => {
            if (event.target.checked) enable()
            else props.onChange(null)
          }}
        />
        <span>{props.t('daily.reminder.enable')}</span>
      </label>
      {deadlineIssue === 'required' && <p>{props.t('daily.reminder.deadlineRequired')}</p>}
      {deadlineIssue === 'past' && <p className={css.reminderError}>{props.t('daily.reminder.deadlinePast')}</p>}
      {validationIssue === 'occurrence-past' && (
        <p className={css.reminderError}>{props.t('daily.reminder.occurrencePast')}</p>
      )}
      {loaded && targets.length === 0 && <p>{props.t('daily.reminder.noBots')}</p>}
      {reminder !== null && (
        <div className={css.reminderGrid}>
          <label>
            <span>{props.t('daily.reminder.mode')}</span>
            <select
              value={reminder.rule.kind}
              onChange={(event) => {
                props.onChange({
                  ...reminder,
                  rule: event.target.value === 'once'
                    ? { kind: 'once', minutesBefore: 30 }
                    : { kind: 'repeat', everyMinutes: 60 },
                })
              }}
            >
              <option value="once">{props.t('daily.reminder.once')}</option>
              <option value="repeat">{props.t('daily.reminder.repeat')}</option>
            </select>
          </label>
          <label>
            <span>{reminder.rule.kind === 'once'
              ? props.t('daily.reminder.minutesBefore')
              : props.t('daily.reminder.everyMinutes')}</span>
            <input
              type="number"
              min={reminder.rule.kind === 'once' ? 0 : 5}
              max={525_600}
              value={reminder.rule.kind === 'once'
                ? reminder.rule.minutesBefore
                : reminder.rule.everyMinutes}
              onChange={(event) => {
                const parsed = Number(event.target.value)
                if (!Number.isFinite(parsed)) return
                const amount = Math.min(525_600, Math.max(reminder.rule.kind === 'once' ? 0 : 5, parsed))
                props.onChange({
                  ...reminder,
                  rule: reminder.rule.kind === 'once'
                    ? { kind: 'once', minutesBefore: amount }
                    : { kind: 'repeat', everyMinutes: amount },
                })
              }}
            />
          </label>
          <label>
            <span>{props.t('daily.reminder.platform')}</span>
            <select
              value={reminder.channel}
              onChange={(event) => { updateTarget(event.target.value as TeacherMobileChannel) }}
            >
              {channels.map(channel => (
                <option key={channel} value={channel}>{channelLabel(props.t, channel)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{props.t('daily.reminder.bot')}</span>
            <select
              value={reminder.botId}
              onChange={(event) => { updateTarget(reminder.channel, event.target.value) }}
            >
              {channelTargets.length === 0 && (
                <option value={reminder.botId}>{reminder.botLabel}</option>
              )}
              {channelTargets.map(target => (
                <option key={target.botId} value={target.botId}>
                  {target.label}{target.connected ? '' : ` · ${props.t('daily.reminder.offline')}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </fieldset>
  )
}

/** Convert a durable reminder into the editable credential-free form. */
export function editableReminder(reminder: TeacherReminder | undefined): TeacherReminderInput | null {
  return reminder === undefined ? null : {
    channel: reminder.channel,
    botId: reminder.botId,
    botLabel: reminder.botLabel,
    rule: reminder.rule,
  }
}

/** Decide whether a reminder draft has a future eligible occurrence. */
export function reminderValid(deadline: string, reminder: TeacherReminderInput | null): boolean {
  return reminderValidationIssue(deadline, reminder) === null
}

type ReminderValidationIssue = 'required' | 'past' | 'occurrence-past'

function reminderValidationIssue(
  deadline: string,
  reminder: TeacherReminderInput | null,
): ReminderValidationIssue | null {
  if (reminder === null) return null
  const issue = reminderDeadlineIssue(deadline)
  if (issue !== null) return issue
  const due = new Date(deadline).getTime()
  return reminder.rule.kind === 'once' && due - reminder.rule.minutesBefore * 60_000 <= Date.now()
    ? 'occurrence-past'
    : null
}

function reminderDeadlineIssue(deadline: string): Exclude<ReminderValidationIssue, 'occurrence-past'> | null {
  if (deadline === '') return 'required'
  const due = new Date(deadline).getTime()
  return !Number.isFinite(due) || due <= Date.now() ? 'past' : null
}

function channelLabel(t: TeacherWorkbenchTranslate, channel: TeacherMobileChannel): string {
  return t(`daily.reminder.channel.${channel}`)
}
