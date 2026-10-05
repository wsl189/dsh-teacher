/** Workbench reminders in the shared Automation tasks page. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-schedule/client'
import { Button, IconClockOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReminderCatalogSnapshot } from './reminder-catalog.ts'
import css from './WorkbenchTaskSource.module.css'

export type WorkbenchTaskSourceProps = PropsRuntime<'schedule.manager.sources'>
  & PropsLocale<'teacherWorkbench'>
  & InjectFace<{
    hooks: { reminders: HostObservable<ReminderCatalogSnapshot> }
    retry: () => Promise<void>
    openWorkbench: () => void
  }>

/** Apply the shared filters without creating a second reminder record or timer. */
export function WorkbenchTaskSource(props: WorkbenchTaskSourceProps) {
  const { records, status } = props.useReminders(value => value)
  const query = props.search.trim().toLowerCase()
  const rows = props.statusFilter === 'inactive' ? [] : records.filter(record =>
    [record.title, record.botLabel, record.channel, props.t(`daily.reminder.channel.${record.channel}`),
      props.t(`automation.owner.${record.owner}`)]
      .some(value => value.toLowerCase().includes(query)))
  return (
    <section className={css.source} aria-label={props.t('automation.workbench')}>
      <div className={css.heading}>
        <h2>{props.t('automation.workbench')}</h2>
        <Button size="sm" variant="outline" onClick={props.openWorkbench}>{props.t('automation.manage')}</Button>
      </div>
      {status === 'loading' && <p role="status">{props.t('automation.loading')}</p>}
      {status === 'error' && <div role="alert">
        <p>{props.t('automation.error')}</p>
        <Button size="sm" onClick={() => { void props.retry() }}>{props.t('retry')}</Button>
      </div>}
      {status === 'ready' && rows.length === 0 && <p role="status">{props.t(
        records.length === 0 ? 'automation.empty' : 'automation.noMatches',
      )}</p>}
      <ul className={css.rows}>
        {rows.map(record => <li key={record.key}>
          <Button className={css.row} onClick={props.openWorkbench} aria-label={record.title}>
            <IconClockOutlineRegular />
            <span>
              <strong>{record.title}</strong>
              <span className={css.metadata}>
                {props.t(`automation.owner.${record.owner}`)} · {props.t(`daily.reminder.channel.${record.channel}`)} · {record.botLabel}
              </span>
              <span className={css.metadata}>
                {record.rule.kind === 'once' ? props.t('automation.once', { minutes: record.rule.minutesBefore })
                  : props.t('automation.repeat', { minutes: record.rule.everyMinutes })}
                {' · '}{props.t('automation.next')} <time dateTime={record.nextRun}>
                  {new Date(record.nextRun).toLocaleString(props.t('automation.locale'))}
                </time>
              </span>
            </span>
          </Button>
        </li>)}
      </ul>
    </section>
  )
}
