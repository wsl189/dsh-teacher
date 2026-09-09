/** Editable review of agent-produced timetable entries. */

import type { TeacherTimetableNormalizedEntry } from '@deepseek-ai/dsh-api-remotes/client'

/** One agent-produced entry with browser-local review state. */
export interface TimetableImportDraft extends TeacherTimetableNormalizedEntry {
  /** Browser-local identity for review edits. */
  readonly id: string
  /** Whether this row will be imported. */
  readonly selected: boolean
}

/**
 * Check the required fields after a teacher edits an import row.
 * @param item - Recognized or teacher-edited identity and course information.
 * @returns Whether the row has a class and a course or study supervisor.
 */
export function isTimetableImportReady(
  item: Pick<TeacherTimetableNormalizedEntry, 'className' | 'kind' | 'subject' | 'teacherName'>,
): boolean {
  const className = item.className.trim()
  return className.length > 0 && className.length <= 80
    && (item.subject.trim() !== '' || (item.kind !== 'lesson' && item.teacherName.trim() !== ''))
}
