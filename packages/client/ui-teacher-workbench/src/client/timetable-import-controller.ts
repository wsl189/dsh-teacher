/** Browser-held timetable recognition and review, independent of mounted workbench views. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  TeacherClass,
  TeacherTimetableClassUsage,
  TeacherTimetableNormalizeDefaults,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import { isTimetableImportReady, type TimetableImportDraft } from './timetable-import.ts'

/** Destination captured when the user selects a file. */
export interface TimetableImportContext {
  readonly classes: readonly TeacherClass[]
  readonly defaults: TeacherTimetableNormalizeDefaults
  readonly usage: TeacherTimetableClassUsage
}

interface TimetableImportSource {
  readonly fileName: string
  readonly context: TimetableImportContext
}

/** Editable recognition output retained until imported or explicitly discarded. */
export interface TimetableImportReview extends TimetableImportSource {
  readonly kind: 'review'
  readonly items: readonly TimetableImportDraft[]
  readonly truncated: boolean
  readonly saving: boolean
  readonly saveError: string | null
}

/** Progress and failures retain their source and original destination. */
export type TimetableImportState =
  | (TimetableImportSource & { readonly kind: 'extracting' | 'normalizing' })
  | TimetableImportReview
  | (TimetableImportSource & {
    readonly kind: 'error'
    readonly stage: 'extracting' | 'normalizing' | 'empty'
    readonly code: string
    readonly message: string
  })

/** One pending recognition or review in the current browser plugin lifetime. */
export interface TimetableImportView {
  readonly job: TimetableImportState | null
}

/** Timetable task mutations supplied by the plugin's object layer. */
export interface TimetableImportCommands {
  /** Start only when no pending task or review exists. */
  start: (file: File, context: TimetableImportContext) => void
  /** Replace editable rows while the review is not being saved. */
  updateItems: (items: readonly TimetableImportDraft[]) => void
  /** Release a completed review or failure; running operations cannot be discarded. */
  discard: () => void
  /** Save selected, ready rows once; preserve the review if persistence fails. */
  importSelected: () => Promise<void>
}

type Services = Pick<TeacherWorkbenchCommands, 'extractDocument' | 'normalizeTimetable' | 'importTimetableEntries'>

/** Stable empty projection for the timetable task source. */
export const EMPTY_TIMETABLE_IMPORT_VIEW: TimetableImportView = Object.freeze({ job: null })

/** Owns file processing and review drafts until the browser plugin is disposed. */
export class TimetableImportController implements HostObservable<TimetableImportView> {
  private view = EMPTY_TIMETABLE_IMPORT_VIEW
  private readonly listeners = new Set<() => void>()
  private disposed = false

  constructor(private readonly services: Services) {}

  /** User actions remain usable when no timetable component is mounted. */
  readonly commands: TimetableImportCommands = {
    start: (file, context) => {
      if (this.disposed || this.view.job !== null) return
      const source = { fileName: file.name, context }
      this.publish({ ...source, kind: 'extracting' })
      void this.recognize(file, source)
    },
    updateItems: (items) => {
      const job = this.view.job
      if (job?.kind !== 'review' || job.saving) return
      this.publish({ ...job, items, saveError: null })
    },
    discard: () => {
      const job = this.view.job
      if (job?.kind === 'error' || (job?.kind === 'review' && !job.saving)) this.publish(null)
    },
    importSelected: () => this.importSelected(),
  }

  /** @returns the same projection reference until task data changes. */
  getSnapshot = (): TimetableImportView => this.view

  /**
   * Subscribe without acquiring ownership of the running task.
   * @param listener - Projection change callback.
   * @returns disposer that only removes this subscription.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Release browser-held state and suppress late asynchronous completions. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    this.view = EMPTY_TIMETABLE_IMPORT_VIEW
  }

  private async recognize(file: File, source: TimetableImportSource): Promise<void> {
    const directImage = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
    let stage = 'extracting' as 'extracting' | 'normalizing'
    try {
      const extracted = await this.services.extractDocument(file, {
        includeDiscardedText: true,
        enhanceImageDetail: directImage,
      })
      if (this.disposed) return
      if (!extracted.ok && !directImage) {
        this.publish({ ...source, kind: 'error', stage, ...extracted.error })
        return
      }
      stage = 'normalizing'
      this.publish({ ...source, kind: stage })
      const normalized = await this.services.normalizeTimetable(
        file.name,
        extracted.ok ? extracted.value.markdown : '',
        source.context.defaults,
        directImage ? file : undefined,
      )
      if (this.view.job === null) return
      if (!normalized.ok) {
        this.publish({ ...source, kind: 'error', stage, ...normalized.error })
        return
      }
      const items = normalized.value.items.map((item, index) => ({
        ...item, id: `agent-${String(index)}`, selected: isTimetableImportReady(item),
      }))
      this.publish(items.length === 0
        ? { ...source, kind: 'error', stage: 'empty', code: 'empty', message: '' }
        : { ...source, kind: 'review', items, truncated: extracted.ok && extracted.value.truncated, saving: false, saveError: null })
    } catch (error) {
      this.publish({ ...source, kind: 'error', stage, code: 'request-failed', message: errorMessage(error) })
    }
  }

  private async importSelected(): Promise<void> {
    const review = this.view.job
    if (this.disposed || review?.kind !== 'review' || review.saving) return
    const selected = selectedTimetableImportItems(review)
    if (selected.length === 0) return
    this.publish({ ...review, saving: true, saveError: null })
    try {
      const result = await this.services.importTimetableEntries(selected.map((item) => {
        const classId = review.context.classes.find(owner => (
          owner.name === item.className.trim() && owner.grade === item.grade.trim()
        ))?.id
        const { id: _id, selected: _selected, ...entry } = item
        return { ...entry, ...(classId === undefined ? {} : { classId }), usage: review.context.usage }
      }))
      this.publish(result.ok ? null : { ...review, saving: false, saveError: result.error.message })
    } catch (error) {
      this.publish({ ...review, saving: false, saveError: errorMessage(error) })
    }
  }

  private publish(job: TimetableImportState | null): void {
    if (this.disposed) return
    this.view = Object.freeze({ job })
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-teacher-workbench] timetable-import subscriber threw:', error)
      }
    }
  }
}

/**
 * Select complete rows whose entry kind belongs to the captured import destination.
 * @param review - Editable entries and their original import context.
 * @returns selected rows eligible for durable import.
 */
export function selectedTimetableImportItems(review: TimetableImportReview): readonly TimetableImportDraft[] {
  return review.items.filter(item => item.selected && isTimetableImportReady(item)
    && (review.context.defaults.target === 'study' ? item.kind !== 'lesson' : item.kind === 'lesson'))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
