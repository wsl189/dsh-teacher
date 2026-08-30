/** Browser-local disclosure and active-module state for the workbench surface. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Daily management, timetable, and the four migrated teaching modules. */
export type TeacherWorkbenchModule =
  | 'daily'
  | 'timetable'
  | 'questions'
  | 'lesson'
  | 'students'
  | 'scores'
  | 'records'
  | 'family'
  | 'classRecords'
  | 'talkRecords'
  | 'seating'
  | 'classSummary'

/** Shared state rendered by the sidebar entry and full workbench surface. */
export interface TeacherWorkbenchViewState {
  /** Whether the sidebar function list is expanded. */
  expanded: boolean
  /** Whether the workbench main surface is open. */
  open: boolean
  /** Module shown in the workbench main surface. */
  active: TeacherWorkbenchModule
}

type TeacherWorkbenchViewActions = {
  setExpanded: (draft: TeacherWorkbenchViewState, expanded: boolean) => void
  openModule: (draft: TeacherWorkbenchViewState, module: TeacherWorkbenchModule) => void
  close: (draft: TeacherWorkbenchViewState) => void
}

/**
 * Create the shared workbench-view store.
 * @returns one handle shared by the sidebar and main-surface registrations.
 */
export function createTeacherWorkbenchViewStore(): EngineStoreHandle<TeacherWorkbenchViewState, TeacherWorkbenchViewActions> {
  return defineStore({
    init: (): TeacherWorkbenchViewState => ({ expanded: false, open: false, active: 'daily' }),
    actions: {
      setExpanded: (draft, expanded) => { draft.expanded = expanded },
      openModule: (draft, module) => {
        draft.active = module
        draft.open = true
      },
      close: (draft) => { draft.open = false },
    },
  })
}
