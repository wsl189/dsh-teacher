/** Sidebar entry and disclosure for daily management and teaching modules. */

import type { ComponentType } from 'react'
import clsx from 'clsx'
import {
  CalendarRange,
  ClipboardList,
  FileText,
  Grid2X2,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Scissors,
} from 'lucide-react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconChecklistOutline14,
  IconDataOutline16,
  IconFolderOpenOutline16,
  IconListPenOutline16,
  IconUserOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { createTeacherWorkbenchViewStore, TeacherWorkbenchModule } from './view-store.ts'
import type { TeacherWorkbenchKey } from './locales.ts'
import css from './TeacherWorkbench.module.css'

const DailyIcon: ComponentType<{ size?: number; className?: string }> = props => <LayoutDashboard {...props} />
const TimetableIcon: ComponentType<{ size?: number; className?: string }> = props => <CalendarRange {...props} />
const QuestionsIcon: ComponentType<{ size?: number; className?: string }> = props => <Scissors {...props} />
const FamilyIcon: ComponentType<{ size?: number; className?: string }> = props => <Megaphone {...props} />
const ClassRecordsIcon: ComponentType<{ size?: number; className?: string }> = props => <ClipboardList {...props} />
const TalkRecordsIcon: ComponentType<{ size?: number; className?: string }> = props => <MessageCircle {...props} />
const SeatingIcon: ComponentType<{ size?: number; className?: string }> = props => <Grid2X2 {...props} />
const ClassSummaryIcon: ComponentType<{ size?: number; className?: string }> = props => <FileText {...props} />

/** Full sidebar-entry props. */
export type SidebarWorkbenchProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createTeacherWorkbenchViewStore>>
  & PropsLocale<'teacherWorkbench'>

const MODULES: readonly {
  id: TeacherWorkbenchModule
  label: TeacherWorkbenchKey
  Icon: ComponentType<{ size?: number; className?: string }>
}[] = [
  { id: 'daily', label: 'module.daily', Icon: DailyIcon },
  { id: 'timetable', label: 'module.timetable', Icon: TimetableIcon },
  { id: 'questions', label: 'module.questions', Icon: QuestionsIcon },
  { id: 'lesson', label: 'module.lesson', Icon: IconFolderOpenOutline16 },
  { id: 'students', label: 'module.students', Icon: IconUserOutline16 },
  { id: 'scores', label: 'module.scores', Icon: IconDataOutline16 },
  { id: 'records', label: 'module.records', Icon: IconListPenOutline16 },
  { id: 'family', label: 'module.family', Icon: FamilyIcon },
  { id: 'classRecords', label: 'module.classRecords', Icon: ClassRecordsIcon },
  { id: 'talkRecords', label: 'module.talkRecords', Icon: TalkRecordsIcon },
  { id: 'seating', label: 'module.seating', Icon: SeatingIcon },
  { id: 'classSummary', label: 'module.classSummary', Icon: ClassSummaryIcon },
]

/**
 * Render the workbench trigger and its function disclosure.
 * @param props - composed sidebar slot props.
 * @returns the sidebar entry tree.
 */
export function SidebarWorkbench({ wide, useStore, actions, t }: SidebarWorkbenchProps) {
  const expanded = useStore(state => state.expanded)
  const active = useStore(state => state.active)
  const open = useStore(state => state.open)
  const toggle = (): void => {
    if (!wide) {
      actions.openModule(active)
      return
    }
    actions.setExpanded(!expanded)
  }
  return (
    <div className={css.sidebarRoot}>
      <Tooltip label={t('open')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={clsx(css.sidebarTrigger, !wide && css.sidebarTriggerRail)}
          aria-expanded={wide ? expanded : undefined}
          aria-label={t('open')}
          onClick={toggle}
        >
          <IconChecklistOutline14 size={wide ? 16 : 18} />
          {wide && (
            <>
              <span className={css.sidebarLabel}>{t('title')}</span>
              {expanded
                ? <IconChevronDownOutline14 className={css.sidebarChevron} />
                : <IconChevronRightOutline14 className={css.sidebarChevron} />}
            </>
          )}
        </button>
      </Tooltip>
      {wide && expanded && (
        <div className={css.sidebarModules} aria-label={t('subtitle')}>
          {MODULES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={clsx(css.sidebarModule, open && active === id && css.sidebarModuleActive)}
              onClick={() => { actions.openModule(id) }}
            >
              <Icon size={16} />
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
