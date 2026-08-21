/** Daily-management dashboard with header weather and independent task cards. */

import { useState } from 'react'
import type { TeacherWeatherForecast, TeacherWorkbenchState } from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { CalendarPanel } from './CalendarPanel.tsx'
import { DailyTodoPanel } from './DailyTodoPanel.tsx'
import { LedgerPanel } from './LedgerPanel.tsx'
import { QuickNotesPanel } from './QuickNotesPanel.tsx'
import { WeatherPanel } from './WeatherPanel.tsx'
import css from './TeacherWorkbench.module.css'

/** Daily-management board props. */
export interface DailyManagementProps {
  /** Visible module heading. */
  title: string
  /** Saving status shown beside the module heading, or null while idle. */
  savingLabel: string | null
  /** Complete durable workbench state. */
  state: TeacherWorkbenchState
  /** Feature settings used by weather and speech recognition. */
  settings: TeacherWorkbenchSettings
  /** Durable workbench commands. */
  commands: TeacherWorkbenchCommands
  /** Persist the weather location query through dsh settings. */
  setWeatherLocation: (location: string) => Promise<void>
  /** Load validated weather through the DSH Host. */
  loadWeather: (location: string, signal?: AbortSignal) => Promise<TeacherWeatherForecast>
  /** Workbench translator. */
  t: TeacherWorkbenchTranslate
}

/**
 * Render header weather plus task, note, and calendar cards.
 * @param props - durable state, settings, commands, and copy.
 * @returns the daily dashboard with weather and calendar detail modes.
 */
export function DailyManagement(props: DailyManagementProps) {
  const [expanded, setExpanded] = useState<'weather' | 'ledger' | 'calendar' | null>(null)
  return (
    <div className={`${css.dailyManagement} ${expanded === 'weather' ? css.dailyManagementWeatherExpanded : ''}`}>
      <div className={`${css.contentHeading} ${css.dailyContentHeading}`}>
        <h1>{props.title}</h1>
        {props.savingLabel !== null && <span className={css.savingText}>{props.savingLabel}</span>}
      </div>
      <WeatherPanel
        expanded={expanded === 'weather'}
        location={props.settings.weatherLocation}
        onExpand={() => { setExpanded('weather') }}
        onCollapse={() => { setExpanded(null) }}
        onSaveLocation={props.setWeatherLocation}
        loadWeather={props.loadWeather}
        t={props.t}
      />
      <div className={`${css.dailyBoard} ${expanded === 'ledger' || expanded === 'calendar' ? css.dailyBoardExpanded : ''}`}>
        <DailyTodoPanel state={props.state} settings={props.settings} commands={props.commands} t={props.t} />
        <QuickNotesPanel state={props.state} settings={props.settings} commands={props.commands} t={props.t} />
        <LedgerPanel
          state={props.state}
          settings={props.settings}
          commands={props.commands}
          expanded={expanded === 'ledger'}
          onExpand={() => { setExpanded('ledger') }}
          onCollapse={() => { setExpanded(null) }}
          t={props.t}
        />
        <CalendarPanel
          state={props.state}
          commands={props.commands}
          expanded={expanded === 'calendar'}
          onExpand={() => { setExpanded('calendar') }}
          onCollapse={() => { setExpanded(null) }}
          t={props.t}
        />
      </div>
    </div>
  )
}
