/**
 * Browser object layer over the revisioned teacher-workbench document.
 * @module @deepseek-ai/dsh-client-ui-teacher-workbench/client/controller
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  TeacherCalendarItem,
  TeacherCalendarItemId,
  TeacherClass,
  TeacherClassId,
  TeacherClassUsage,
  TeacherDailyTodo,
  TeacherDailyTodoCategory,
  TeacherDailyTodoColor,
  TeacherDailyTodoId,
  TeacherExam,
  TeacherExamEntry,
  TeacherExamId,
  TeacherLessonResource,
  TeacherLessonResourceCategory,
  TeacherLessonResourceId,
  TeacherLedgerCategory,
  TeacherLedgerCategoryId,
  TeacherLedgerEntry,
  TeacherLedgerEntryId,
  TeacherNotice,
  TeacherNoticeId,
  TeacherNoticeTemplate,
  TeacherNoticeTemplateId,
  TeacherRecord,
  TeacherRecordId,
  TeacherRecordStatus,
  TeacherRecordTemplate,
  TeacherRecordTemplateId,
  TeacherRecordTemplateKind,
  TeacherSeatingLayout,
  TeacherQuickNote,
  TeacherQuickNoteId,
  TeacherQuestionAssignRequest,
  TeacherQuestionBatchId,
  TeacherQuestionBatchDeleteRequest,
  TeacherQuestionBatchDocumentRequest,
  TeacherQuestionBatchDocumentResult,
  TeacherQuestionBatchSaveRequest,
  TeacherQuestionDocumentRequest,
  TeacherQuestionDocumentResult,
  TeacherQuestionFolder,
  TeacherQuestionFolderId,
  TeacherQuestionImageDeleteRequest,
  TeacherQuestionImageReadRequest,
  TeacherQuestionImageReadResult,
  TeacherQuestionImageReplaceRequest,
  TeacherQuestionMutationResult,
  TeacherQuestionRejected,
  TeacherQuestionTemporaryListRequest,
  TeacherQuestionTemporaryListResult,
  TeacherQuestionTemporarySaveRequest,
  TeacherQuestionTemporarySaveResult,
  TeacherQuestionUploadedDocumentRequest,
  TeacherStudent,
  TeacherStudentId,
  TeacherTimetableEntry,
  TeacherTimetableEntryId,
  TeacherTimetableEntryKind,
  TeacherTimetableClassUsage,
  TeacherWeekday,
  TeacherWorkbenchDocument,
  TeacherWorkbenchReadResult,
  TeacherWorkbenchState,
  TeacherWorkbenchWriteResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { StudentImportRow } from './import-data.ts'
import { isPlausibleClassName } from './timetable-import.ts'

/** Remote methods consumed by the browser object layer. */
export interface TeacherWorkbenchRemote {
  /** Read the current document. */
  read: (request: Record<never, never>) => Promise<RemoteResult<TeacherWorkbenchReadResult>>
  /** Compare-and-set the complete state. */
  write: (request: {
    expectedRevision: number
    state: TeacherWorkbenchState
  }) => Promise<RemoteResult<TeacherWorkbenchWriteResult>>
  /**
   * Persist one complete rendered paper batch.
   * @param request - batch metadata and reviewed raster payloads.
   * @returns the settled persistence result.
   */
  saveQuestionBatch: (request: TeacherQuestionBatchSaveRequest) => Promise<RemoteResult<TeacherQuestionMutationResult>>
  /** Read one stored question raster. */
  readQuestionImage: (request: TeacherQuestionImageReadRequest) => Promise<RemoteResult<TeacherQuestionImageReadResult>>
  /** Replace one stored question raster. */
  replaceQuestionImage: (request: TeacherQuestionImageReplaceRequest) => Promise<RemoteResult<TeacherQuestionMutationResult>>
  /** Delete one stored question raster. */
  deleteQuestionImage: (request: TeacherQuestionImageDeleteRequest) => Promise<RemoteResult<TeacherQuestionMutationResult>>
  /** Delete one paper batch. */
  deleteQuestionBatch: (request: TeacherQuestionBatchDeleteRequest) => Promise<RemoteResult<TeacherQuestionMutationResult>>
  /** Copy selected questions to a student. */
  assignQuestions: (request: TeacherQuestionAssignRequest) => Promise<RemoteResult<TeacherQuestionMutationResult>>
  /** Snapshot selected student images into temporary generation storage. */
  saveTemporaryQuestionSelection: (
    request: TeacherQuestionTemporarySaveRequest,
  ) => Promise<RemoteResult<TeacherQuestionTemporarySaveResult>>
  /** List students with available temporary generation images. */
  listTemporaryQuestionSelections: (
    request: TeacherQuestionTemporaryListRequest,
  ) => Promise<RemoteResult<TeacherQuestionTemporaryListResult>>
  /** Generate one Word or PowerPoint artifact. */
  generateQuestionDocument: (request: TeacherQuestionDocumentRequest) => Promise<RemoteResult<TeacherQuestionDocumentResult>>
  /** Generate one Office artifact from browser-selected images. */
  generateUploadedQuestionDocument: (
    request: TeacherQuestionUploadedDocumentRequest,
  ) => Promise<RemoteResult<TeacherQuestionDocumentResult>>
  /** Generate independent per-student Office documents. */
  generateStudentDocuments: (
    request: TeacherQuestionBatchDocumentRequest,
  ) => Promise<RemoteResult<TeacherQuestionBatchDocumentResult>>
}

/** Current object-layer state. */
export interface TeacherWorkbenchSnapshot {
  /** Load or mutation state. */
  status: 'cold' | 'loading' | 'ready' | 'saving' | 'error'
  /** Last accepted Host document. */
  document: TeacherWorkbenchDocument | null
  /** Last failure, cleared on the next successful operation. */
  error: { code: string; message: string } | null
}

/** Settled object-layer command. */
export type TeacherWorkbenchActionResult =
  | { ok: true; batchId?: TeacherQuestionBatchId }
  | { ok: false; error: { code: string; message: string } }

type TeacherWorkbenchActionFailure = Extract<TeacherWorkbenchActionResult, { ok: false }>

type TeacherWorkbenchWriteCallResult =
  | { ok: true; value: TeacherWorkbenchWriteResult }
  | { ok: false; error: { code: string; message: string } }

/** Class form data accepted by {@link TeacherWorkbenchController.saveClass}. */
export interface TeacherClassInput {
  /** Existing identity when editing. */
  id?: TeacherClassId
  /** Durable catalog in which the class is selectable. */
  usage: TeacherClassUsage
  /** Academic-year directory used by the question hierarchy. */
  academicYear?: string
  /** Class display name. */
  name: string
  /** Grade label. */
  grade: string
  /** Subject label. */
  subject: string
}

/** Student form data accepted by {@link TeacherWorkbenchController.saveStudent}. */
export interface TeacherStudentInput {
  /** Existing identity when editing. */
  id?: TeacherStudentId
  /** Owning class. */
  classId: TeacherClassId
  /** Student name. */
  name: string
  /** Student number. */
  studentNumber: string
  /** Gender text. */
  gender: string
  /** Guardian name. */
  guardian: string
  /** Guardian relationship. */
  relation: string
  /** Phone. */
  phone: string
  /** Address. */
  address: string
  /** Imported extra fields. */
  extras?: Record<string, string>
}

/** Nested question-folder data accepted by {@link TeacherWorkbenchController.createQuestionFolder}. */
export interface TeacherQuestionFolderInput {
  /** Student hierarchy root that owns the folder. */
  studentId: TeacherStudentId
  /** Parent directory; omission creates a folder directly below the student. */
  parentId?: TeacherQuestionFolderId
  /** Teacher-facing directory name. */
  name: string
}

/** Lesson-resource form data. */
export interface TeacherLessonResourceInput {
  /** Existing identity when editing. */
  id?: TeacherLessonResourceId
  /** Resource category. */
  category: TeacherLessonResourceCategory
  /** Display name. */
  name: string
  /** Absolute web address. */
  url: string
  /** Optional note. */
  description: string
}

/** Record-template form data. */
export interface TeacherRecordTemplateInput {
  /** Existing identity when editing. */
  id?: TeacherRecordTemplateId
  /** Template family. */
  kind: TeacherRecordTemplateKind
  /** Display name. */
  name: string
  /** Use-case description. */
  scene: string
  /** Ordered field labels. */
  fields: string[]
}

/** Teaching-record form data. */
export interface TeacherRecordInput {
  /** Existing identity when editing. */
  id?: TeacherRecordId
  /** Selected template. */
  templateId: TeacherRecordTemplateId
  /** Record title. */
  title: string
  /** Optional ISO date. */
  dueDate: string
  /** Lifecycle state. */
  status: TeacherRecordStatus
  /** Dynamic field values. */
  values: Record<string, string>
}

/** Family-notice template data. */
export interface TeacherNoticeTemplateInput {
  /** Existing identity when editing. */
  id?: TeacherNoticeTemplateId
  /** Compact scenario name. */
  name: string
  /** Stable icon family. */
  icon: TeacherNoticeTemplate['icon']
  /** Template-selection guidance. */
  hint: string
  /** Editable information structure. */
  starter: string
  /** Whether the teacher may delete this template. */
  custom: boolean
}

/** Saved family-notice data. */
export interface TeacherNoticeInput {
  /** Existing identity when replacing a draft. */
  id?: TeacherNoticeId
  /** Scenario label. */
  title: string
  /** Complete reviewed message. */
  content: string
}

/** Class seating-layout data. */
export interface TeacherSeatingLayoutInput {
  /** Roster class that owns the arrangement. */
  classId: TeacherClassId
  /** Number of rows. */
  rows: number
  /** Number of columns. */
  columns: number
  /** Row-major roster identities or empty seats. */
  slots: readonly (TeacherStudentId | null)[]
}

/** Exam form data after recognized rows are matched to a roster. */
export interface TeacherExamInput {
  /** Existing identity when editing. */
  id?: TeacherExamId
  /** Owning class. */
  classId: TeacherClassId
  /** Exam display name. */
  name: string
  /** Optional ISO date. */
  date: string
  /** Matched score entries. */
  entries: TeacherExamEntry[]
}

/** Daily-todo form data. */
export interface TeacherDailyTodoInput {
  /** Existing identity when editing. */
  id?: TeacherDailyTodoId
  /** Task text. */
  title: string
  /** Optional local ISO deadline. */
  dueAt: string
  /** Completion state retained while editing. */
  completed?: boolean
  /** Mutually exclusive owning list retained while editing. */
  category?: TeacherDailyTodoCategory
  /** Stable color marker retained while editing. */
  color?: TeacherDailyTodoColor
}

/** Quick-note form data. */
export interface TeacherQuickNoteInput {
  /** Existing identity when editing. */
  id?: TeacherQuickNoteId
  /** Note content. */
  content: string
}

/** Ledger-category form data. */
export interface TeacherLedgerCategoryInput {
  /** Existing identity when editing. */
  id?: TeacherLedgerCategoryId
  /** Category display name. */
  name: string
}

/** Ledger-entry form data. */
export interface TeacherLedgerEntryInput {
  /** Existing identity when editing. */
  id?: TeacherLedgerEntryId
  /** Owning ledger category. */
  categoryId: TeacherLedgerCategoryId
  /** Expense description. */
  description: string
  /** Non-negative CNY amount in integer cents. */
  amountCents: number
  /** Required local ISO date and time. */
  occurredAt: string
}

/** Calendar-item form data. */
export interface TeacherCalendarItemInput {
  /** Existing identity when editing. */
  id?: TeacherCalendarItemId
  /** Local ISO date. */
  date: string
  /** Optional local start time. */
  time: string
  /** Item title. */
  title: string
  /** Optional details. */
  details: string
}

/** One recognized calendar row accepted by a bulk import. */
export interface TeacherCalendarImportInput {
  /** Local ISO date. */
  date: string
  /** Optional local start time. */
  time: string
  /** Recognized or teacher-edited title. */
  title: string
  /** Optional recognized details. */
  details: string
}

/** Timetable form data resolved within one timetable catalog before persistence. */
export interface TeacherTimetableEntryInput {
  /** Existing identity when editing. */
  id?: TeacherTimetableEntryId
  /** Existing class identity when selected from the workbench. */
  classId?: TeacherClassId
  /** Timetable catalog that owns the class and entry. */
  usage: TeacherTimetableClassUsage
  /** Class name used to resolve or create the owning class. */
  className: string
  /** Grade used to resolve or create the owning class. */
  grade: string
  /** Regular lesson, morning study, or evening study. */
  kind: TeacherTimetableEntryKind
  /** Weekday using Monday as one. */
  weekday: TeacherWeekday
  /** One-based lesson or study slot. */
  period: number
  /** Optional local start time. */
  startTime: string
  /** Optional local end time. */
  endTime: string
  /** Course or study-session label. */
  subject: string
  /** Teacher responsible for the entry. */
  teacherName: string
  /** Optional classroom or location. */
  location: string
}

/** One reviewed OCR timetable row accepted by a bulk import. */
export type TeacherTimetableImportInput = Omit<TeacherTimetableEntryInput, 'id'>

/** Optional deterministic clocks for object-layer tests. */
export interface TeacherWorkbenchControllerOptions {
  /** Generate an opaque identity string. */
  id?: () => string
  /** Return Unix epoch milliseconds. */
  now?: () => number
}

const INITIAL_SNAPSHOT: TeacherWorkbenchSnapshot = Object.freeze({
  status: 'cold',
  document: null,
  error: null,
})

const OK: TeacherWorkbenchActionResult = Object.freeze({ ok: true })

/** Revision-aware object layer shared by every workbench module. */
export class TeacherWorkbenchController implements HostObservable<TeacherWorkbenchSnapshot> {
  private snapshot = INITIAL_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  private loadPromise: Promise<TeacherWorkbenchActionResult> | null = null
  private operationTail: Promise<void> = Promise.resolve()
  private disposed = false
  private readonly createId: () => string
  private readonly now: () => number

  /**
   * @param remote - generated teacherWorkbench Remote namespace.
   * @param options - optional deterministic id and clock sources.
   */
  constructor(remote: TeacherWorkbenchRemote, options: TeacherWorkbenchControllerOptions = {}) {
    this.remote = remote
    this.createId = options.id ?? (() => globalThis.crypto.randomUUID())
    this.now = options.now ?? (() => Date.now())
  }

  private readonly remote: TeacherWorkbenchRemote

  /** @returns the cached immutable snapshot. */
  getSnapshot = (): TeacherWorkbenchSnapshot => this.snapshot

  /**
   * Subscribe to snapshot replacement.
   * @param listener - change listener.
   * @returns disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Load the document once; failed reads remain retryable.
   * @returns the settled read result.
   */
  ensure(): Promise<TeacherWorkbenchActionResult> {
    if (this.snapshot.document !== null && this.snapshot.status !== 'error') return Promise.resolve(OK)
    return this.refresh()
  }

  /**
   * Read the Host document, collapsing concurrent reads.
   * @returns the settled read result.
   */
  refresh(): Promise<TeacherWorkbenchActionResult> {
    if (this.loadPromise !== null) return this.loadPromise
    this.publish({ status: 'loading', document: this.snapshot.document, error: null })
    const pending = this.load()
    this.loadPromise = pending
    return pending.finally(() => { this.loadPromise = null })
  }

  /**
   * Re-read behind queued mutations after a connection reset.
   * @returns the settled read result.
   */
  resync(): Promise<TeacherWorkbenchActionResult> {
    return this.enqueue(async () => await this.load())
  }

  /**
   * Save a new or existing daily task.
   * @param input - task fields and optional identity.
   * @returns the settled persistence result.
   */
  saveDailyTodo(input: TeacherDailyTodoInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const existing = input.id === undefined
        ? undefined
        : state.dailyTodos.find(item => item.id === input.id)
      const now = this.now()
      const item: TeacherDailyTodo = {
        id: input.id ?? this.id() as TeacherDailyTodoId,
        title: input.title.trim(),
        dueAt: input.dueAt,
        completed: input.completed ?? existing?.completed ?? false,
        category: input.category ?? existing?.category ?? 'today',
        color: input.color ?? existing?.color ?? 'blue',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return { ...state, dailyTodos: upsert(state.dailyTodos, item) }
    })
  }

  /**
   * Toggle one daily task's completion state.
   * @param id - task identity.
   * @returns the settled persistence result.
   */
  toggleDailyTodo(id: TeacherDailyTodoId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      dailyTodos: state.dailyTodos.map(item => item.id === id ? {
        ...item,
        completed: !item.completed,
        updatedAt: this.now(),
      } : item),
    }))
  }

  /**
   * Delete one daily task.
   * @param id - task identity.
   * @returns the settled persistence result.
   */
  deleteDailyTodo(id: TeacherDailyTodoId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      dailyTodos: state.dailyTodos.filter(item => item.id !== id),
    }))
  }

  /**
   * Save a new or existing quick note.
   * @param input - note content and optional identity.
   * @returns the settled persistence result.
   */
  saveQuickNote(input: TeacherQuickNoteInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const existing = input.id === undefined
        ? undefined
        : state.quickNotes.find(item => item.id === input.id)
      const now = this.now()
      const item: TeacherQuickNote = {
        id: input.id ?? this.id() as TeacherQuickNoteId,
        content: input.content.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return { ...state, quickNotes: upsert(state.quickNotes, item) }
    })
  }

  /**
   * Delete one quick note.
   * @param id - note identity.
   * @returns the settled persistence result.
   */
  deleteQuickNote(id: TeacherQuickNoteId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      quickNotes: state.quickNotes.filter(item => item.id !== id),
    }))
  }

  /**
   * Save a new or existing ledger category.
   * @param input - category name and optional identity.
   * @returns the settled persistence result.
   */
  saveLedgerCategory(input: TeacherLedgerCategoryInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const existing = input.id === undefined
        ? undefined
        : state.ledgerCategories.find(item => item.id === input.id)
      const item: TeacherLedgerCategory = {
        id: input.id ?? this.id() as TeacherLedgerCategoryId,
        name: input.name.trim(),
        createdAt: existing?.createdAt ?? this.now(),
      }
      return { ...state, ledgerCategories: upsert(state.ledgerCategories, item) }
    })
  }

  /**
   * Delete one ledger category and every entry it owns.
   * @param id - category identity.
   * @returns the settled persistence result.
   */
  deleteLedgerCategory(id: TeacherLedgerCategoryId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      ledgerCategories: state.ledgerCategories.filter(item => item.id !== id),
      ledgerEntries: state.ledgerEntries.filter(item => item.categoryId !== id),
    }))
  }

  /**
   * Save a new or existing ledger entry.
   * @param input - category, description, amount, time, and optional identity.
   * @returns the settled persistence result.
   */
  saveLedgerEntry(input: TeacherLedgerEntryInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const existing = input.id === undefined
        ? undefined
        : state.ledgerEntries.find(item => item.id === input.id)
      const now = this.now()
      const item: TeacherLedgerEntry = {
        id: input.id ?? this.id() as TeacherLedgerEntryId,
        categoryId: input.categoryId,
        description: input.description.trim(),
        amountCents: input.amountCents,
        occurredAt: input.occurredAt,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return { ...state, ledgerEntries: upsert(state.ledgerEntries, item) }
    })
  }

  /**
   * Delete one ledger entry.
   * @param id - entry identity.
   * @returns the settled persistence result.
   */
  deleteLedgerEntry(id: TeacherLedgerEntryId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      ledgerEntries: state.ledgerEntries.filter(item => item.id !== id),
    }))
  }

  /**
   * Save a new or existing calendar item.
   * @param input - calendar fields and optional identity.
   * @returns the settled persistence result.
   */
  saveCalendarItem(input: TeacherCalendarItemInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const existing = input.id === undefined
        ? undefined
        : state.calendarItems.find(item => item.id === input.id)
      const now = this.now()
      const item: TeacherCalendarItem = {
        id: input.id ?? this.id() as TeacherCalendarItemId,
        date: input.date,
        time: input.time,
        title: input.title.trim(),
        details: input.details.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return { ...state, calendarItems: upsert(state.calendarItems, item) }
    })
  }

  /**
   * Append recognized calendar rows in one revisioned write.
   * @param inputs - reviewed school-calendar items.
   * @returns the settled persistence result.
   */
  importCalendarItems(inputs: readonly TeacherCalendarImportInput[]): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const now = this.now()
      const imported = inputs.map((input): TeacherCalendarItem => ({
        id: this.id() as TeacherCalendarItemId,
        date: input.date,
        time: input.time,
        title: input.title.trim(),
        details: input.details.trim(),
        createdAt: now,
        updatedAt: now,
      }))
      return { ...state, calendarItems: [...state.calendarItems, ...imported] }
    })
  }

  /**
   * Delete one calendar item.
   * @param id - calendar-item identity.
   * @returns the settled persistence result.
   */
  deleteCalendarItem(id: TeacherCalendarItemId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      calendarItems: state.calendarItems.filter(item => item.id !== id),
    }))
  }

  /**
   * Save one timetable entry within its owning area.
   * @param input - timetable fields and class lookup data.
   * @returns the settled persistence result.
   */
  saveTimetableEntry(input: TeacherTimetableEntryInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const resolved = resolveTimetableClass(state.classes, input, () => this.id() as TeacherClassId)
      const existing = input.id === undefined
        ? undefined
        : state.timetableEntries.find(item => item.id === input.id)
      const now = this.now()
      const item: TeacherTimetableEntry = {
        id: input.id ?? this.id() as TeacherTimetableEntryId,
        classId: resolved.classId,
        kind: input.kind,
        weekday: input.weekday,
        period: input.period,
        startTime: input.startTime,
        endTime: input.endTime,
        subject: input.subject.trim(),
        teacherName: input.teacherName.trim(),
        location: input.location.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return {
        ...state,
        classes: resolved.classes,
        timetableEntries: replaceTimetableSlot(state.timetableEntries, item),
      }
    })
  }

  /**
   * Merge reviewed OCR timetable rows, replacing occupied class slots.
   * @param inputs - reviewed timetable rows.
   * @returns the settled persistence result.
   */
  importTimetableEntries(inputs: readonly TeacherTimetableImportInput[]): Promise<TeacherWorkbenchActionResult> {
    if (inputs.some(input => !isPlausibleClassName(input.className))) {
      return Promise.resolve({ ok: false, error: { code: 'invalid-state', message: '课表班级名称必须以“班”结尾' } })
    }
    return this.mutate((state) => {
      let classes = [...state.classes]
      let timetableEntries = [...state.timetableEntries]
      const now = this.now()
      for (const input of inputs) {
        const resolved = resolveTimetableClass(classes, input, () => this.id() as TeacherClassId)
        classes = resolved.classes
        const occupied = timetableEntries.find(item => sameTimetableSlot(item, {
          classId: resolved.classId,
          kind: input.kind,
          weekday: input.weekday,
          period: input.period,
        }))
        const item: TeacherTimetableEntry = {
          id: occupied?.id ?? this.id() as TeacherTimetableEntryId,
          classId: resolved.classId,
          kind: input.kind,
          weekday: input.weekday,
          period: input.period,
          startTime: input.startTime,
          endTime: input.endTime,
          subject: input.subject.trim(),
          teacherName: input.teacherName.trim(),
          location: input.location.trim(),
          createdAt: occupied?.createdAt ?? now,
          updatedAt: now,
        }
        timetableEntries = replaceTimetableSlot(timetableEntries, item)
      }
      return { ...state, classes, timetableEntries }
    })
  }

  /**
   * Delete one timetable entry.
   * @param id - timetable-entry identity.
   * @returns the settled persistence result.
   */
  deleteTimetableEntry(id: TeacherTimetableEntryId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      timetableEntries: state.timetableEntries.filter(item => item.id !== id),
    }))
  }

  /**
   * Save a new or existing class.
   * @param input - class fields and optional identity.
   * @returns the settled persistence result.
   */
  saveClass(input: TeacherClassInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const academicYear = input.academicYear?.trim() ?? ''
      const item: TeacherClass = {
        id: input.id ?? this.id() as TeacherClassId,
        usage: input.usage,
        ...(academicYear === '' ? {} : { academicYear }),
        name: input.name.trim(),
        grade: input.grade.trim(),
        subject: input.subject.trim(),
      }
      return { ...state, classes: upsert(state.classes, item) }
    })
  }

  /**
   * Delete a class and its roster, exams, and timetable entries.
   * @param id - class identity.
   * @returns the settled persistence result.
   */
  deleteClass(id: TeacherClassId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const removedStudents = new Set(state.students.filter(item => item.classId === id).map(item => item.id))
      return {
        ...state,
        classes: state.classes.filter(item => item.id !== id),
        students: state.students.filter(item => item.classId !== id),
        timetableEntries: state.timetableEntries.filter(item => item.classId !== id),
        exams: state.exams
          .filter(item => item.classId !== id)
          .map(item => ({ ...item, entries: item.entries.filter(entry => !removedStudents.has(entry.studentId)) })),
        questionFolders: state.questionFolders.filter(item => !removedStudents.has(item.studentId)),
        questionAssignments: state.questionAssignments.filter(item => !removedStudents.has(item.studentId)),
        seatingLayouts: state.seatingLayouts.filter(item => item.classId !== id),
      }
    })
  }

  /**
   * Save a new or existing student.
   * @param input - student fields and optional identity.
   * @returns the settled persistence result.
   */
  saveStudent(input: TeacherStudentInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const item: TeacherStudent = {
        id: input.id ?? this.id() as TeacherStudentId,
        classId: input.classId,
        name: input.name.trim(),
        studentNumber: input.studentNumber.trim(),
        gender: input.gender.trim(),
        guardian: input.guardian.trim(),
        relation: input.relation.trim(),
        phone: input.phone.trim(),
        address: input.address.trim(),
        extras: { ...(input.extras ?? {}) },
      }
      return { ...state, students: upsert(state.students, item) }
    })
  }

  /**
   * Merge imported roster rows into one class by student number, then name.
   * @param classId - destination class identity.
   * @param rows - normalized recognized rows.
   * @returns the settled persistence result.
   */
  importStudents(classId: TeacherClassId, rows: readonly StudentImportRow[]): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const students = [...state.students]
      for (const row of rows) {
        const existingIndex = students.findIndex(item => item.classId === classId && (
          row.studentNumber !== '' && item.studentNumber === row.studentNumber
            ? true
            : row.studentNumber === '' && item.name === row.name
        ))
        const existing = existingIndex < 0 ? undefined : students[existingIndex]
        const item: TeacherStudent = {
          id: existing?.id ?? this.id() as TeacherStudentId,
          classId,
          ...row,
        }
        if (existingIndex < 0) students.push(item)
        else students[existingIndex] = item
      }
      return { ...state, students }
    })
  }

  /**
   * Delete a student and remove that student's exam entries.
   * @param id - student identity.
   * @returns the settled persistence result.
   */
  deleteStudent(id: TeacherStudentId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      students: state.students.filter(item => item.id !== id),
      exams: state.exams.map(item => ({
        ...item,
        entries: item.entries.filter(entry => entry.studentId !== id),
      })),
      questionFolders: state.questionFolders.filter(item => item.studentId !== id),
      questionAssignments: state.questionAssignments.filter(item => item.studentId !== id),
      seatingLayouts: state.seatingLayouts.map(item => ({
        ...item,
        slots: item.slots.map(studentId => studentId === id ? null : studentId),
      })),
    }))
  }

  /**
   * Save a lesson-preparation resource.
   * @param input - resource fields and optional identity.
   * @returns the settled persistence result.
   */
  saveResource(input: TeacherLessonResourceInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const item: TeacherLessonResource = {
        id: input.id ?? this.id() as TeacherLessonResourceId,
        category: input.category,
        name: input.name.trim(),
        url: input.url.trim(),
        description: input.description.trim(),
      }
      return { ...state, resources: upsert(state.resources, item) }
    })
  }

  /**
   * Delete one lesson-preparation resource.
   * @param id - resource identity.
   * @returns the settled persistence result.
   */
  deleteResource(id: TeacherLessonResourceId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({ ...state, resources: state.resources.filter(item => item.id !== id) }))
  }

  /**
   * Save an observation or teaching-record template.
   * @param input - template fields and optional identity.
   * @returns the settled persistence result.
   */
  saveTemplate(input: TeacherRecordTemplateInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const item: TeacherRecordTemplate = {
        id: input.id ?? this.id() as TeacherRecordTemplateId,
        kind: input.kind,
        name: input.name.trim(),
        scene: input.scene.trim(),
        fields: input.fields.map(field => field.trim()).filter(Boolean),
      }
      return { ...state, templates: upsert(state.templates, item) }
    })
  }

  /**
   * Delete a template and the records authored from it.
   * @param id - template identity.
   * @returns the settled persistence result.
   */
  deleteTemplate(id: TeacherRecordTemplateId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      templates: state.templates.filter(item => item.id !== id),
      records: state.records.filter(item => item.templateId !== id),
    }))
  }

  /**
   * Save a teaching record.
   * @param input - record fields and optional identity.
   * @returns the settled persistence result.
   */
  saveRecord(input: TeacherRecordInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const item: TeacherRecord = {
        id: input.id ?? this.id() as TeacherRecordId,
        templateId: input.templateId,
        title: input.title.trim(),
        dueDate: input.dueDate,
        status: input.status,
        values: { ...input.values },
        updatedAt: this.now(),
      }
      return { ...state, records: upsert(state.records, item) }
    })
  }

  /**
   * Toggle one teaching record between active and done.
   * @param id - record identity.
   * @returns the settled persistence result.
   */
  toggleRecord(id: TeacherRecordId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      records: state.records.map(item => item.id === id ? {
        ...item,
        status: item.status === 'done' ? 'active' : 'done',
        updatedAt: this.now(),
      } : item),
    }))
  }

  /**
   * Delete one teaching record.
   * @param id - record identity.
   * @returns the settled persistence result.
   */
  deleteRecord(id: TeacherRecordId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({ ...state, records: state.records.filter(item => item.id !== id) }))
  }

  /**
   * Save one built-in or teacher-authored family-notice template.
   * @param input - template fields and optional identity.
   * @returns the settled persistence result.
   */
  saveNoticeTemplate(input: TeacherNoticeTemplateInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const item: TeacherNoticeTemplate = {
        id: input.id ?? this.id() as TeacherNoticeTemplateId,
        name: input.name.trim(),
        icon: input.icon,
        hint: input.hint.trim(),
        starter: input.starter.trim(),
        custom: input.custom,
      }
      return { ...state, noticeTemplates: upsert(state.noticeTemplates, item) }
    })
  }

  /**
   * Delete one teacher-authored family-notice template.
   * @param id - template identity.
   * @returns the settled persistence result.
   */
  deleteNoticeTemplate(id: TeacherNoticeTemplateId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({
      ...state,
      noticeTemplates: state.noticeTemplates.filter(item => item.id !== id || !item.custom),
    }))
  }

  /**
   * Save one reviewed family-notice draft.
   * @param input - scenario label and complete message.
   * @returns the settled persistence result.
   */
  saveNotice(input: TeacherNoticeInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const item: TeacherNotice = {
        id: input.id ?? this.id() as TeacherNoticeId,
        title: input.title.trim(),
        content: input.content.trim(),
        createdAt: this.now(),
      }
      return { ...state, notices: upsert(state.notices, item) }
    })
  }

  /**
   * Delete one saved family-notice draft.
   * @param id - saved-notice identity.
   * @returns the settled persistence result.
   */
  deleteNotice(id: TeacherNoticeId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({ ...state, notices: state.notices.filter(item => item.id !== id) }))
  }

  /**
   * Replace one class's seating arrangement.
   * @param input - complete grid and row-major occupants.
   * @returns the settled persistence result.
   */
  saveSeatingLayout(input: TeacherSeatingLayoutInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const item: TeacherSeatingLayout = {
        ...input,
        slots: [...input.slots],
        updatedAt: this.now(),
      }
      return {
        ...state,
        seatingLayouts: upsertBy(state.seatingLayouts, item, layout => layout.classId),
      }
    })
  }

  /**
   * Save an imported exam.
   * @param input - exam fields and roster-matched scores.
   * @returns the settled persistence result.
   */
  saveExam(input: TeacherExamInput): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const item: TeacherExam = {
        id: input.id ?? this.id() as TeacherExamId,
        classId: input.classId,
        name: input.name.trim(),
        date: input.date,
        entries: input.entries.map(entry => ({ ...entry, scores: { ...entry.scores } })),
      }
      return { ...state, exams: upsert(state.exams, item) }
    })
  }

  /**
   * Delete one exam.
   * @param id - exam identity.
   * @returns the settled persistence result.
   */
  deleteExam(id: TeacherExamId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate(state => ({ ...state, exams: state.exams.filter(item => item.id !== id) }))
  }

  /**
   * Create one durable nested directory below a roster student.
   * @param input - owning student, optional parent, and display name.
   * @returns the settled persistence result.
   */
  createQuestionFolder(input: TeacherQuestionFolderInput): Promise<TeacherWorkbenchActionResult> {
    const name = input.name.trim()
    if (name === '') return Promise.resolve({ ok: false, error: { code: 'invalid-state', message: '目录名不能为空' } })
    return this.mutate((state) => {
      const now = this.now()
      const item: TeacherQuestionFolder = {
        id: this.id() as TeacherQuestionFolderId,
        studentId: input.studentId,
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        name,
        createdAt: now,
        updatedAt: now,
      }
      return { ...state, questionFolders: [...state.questionFolders, item] }
    })
  }

  /**
   * Delete one nested directory, all descendants, and their assigned image copies.
   * @param id - root folder identity to remove.
   * @returns the settled persistence result.
   */
  deleteQuestionFolder(id: TeacherQuestionFolderId): Promise<TeacherWorkbenchActionResult> {
    return this.mutate((state) => {
      const removed = new Set<TeacherQuestionFolderId>([id])
      let changed = true
      while (changed) {
        changed = false
        for (const folder of state.questionFolders) {
          if (folder.parentId === undefined || !removed.has(folder.parentId) || removed.has(folder.id)) continue
          removed.add(folder.id)
          changed = true
        }
      }
      return {
        ...state,
        questionFolders: state.questionFolders.filter(item => !removed.has(item.id)),
        questionAssignments: state.questionAssignments.filter(item => item.folderId === undefined || !removed.has(item.folderId)),
      }
    })
  }

  /**
   * Persist one complete rendered paper batch.
   * @param request - batch metadata and reviewed raster payloads.
   * @returns the settled persistence result.
   */
  saveQuestionBatch(request: TeacherQuestionBatchSaveRequest): Promise<TeacherWorkbenchActionResult> {
    return this.questionMutation(() => this.remote.saveQuestionBatch(request))
  }

  /**
   * Read one stored question raster without changing the document snapshot.
   * @param request - exact batch or assignment image target.
   * @returns validated image bytes or a stable action failure.
   */
  async readQuestionImage(request: TeacherQuestionImageReadRequest): Promise<TeacherQuestionImageReadResult> {
    try {
      const carried = await this.remote.readQuestionImage(request)
      return carried.ok
        ? carried.value
        : { ok: false, error: { code: 'storage-failure', message: carried.error.message } }
    } catch (error) {
      return transportQuestionFailure(error)
    }
  }

  /**
   * Replace one stored question raster.
   * @param request - exact target and replacement raster payload.
   * @returns the settled persistence result.
   */
  replaceQuestionImage(request: TeacherQuestionImageReplaceRequest): Promise<TeacherWorkbenchActionResult> {
    return this.questionMutation(() => this.remote.replaceQuestionImage(request))
  }

  /**
   * Delete one stored question raster.
   * @param request - exact batch or assignment image target.
   * @returns the settled persistence result.
   */
  deleteQuestionImage(request: TeacherQuestionImageDeleteRequest): Promise<TeacherWorkbenchActionResult> {
    return this.questionMutation(() => this.remote.deleteQuestionImage(request))
  }

  /**
   * Delete one paper batch.
   * @param request - durable batch identity.
   * @returns the settled persistence result.
   */
  deleteQuestionBatch(request: TeacherQuestionBatchDeleteRequest): Promise<TeacherWorkbenchActionResult> {
    return this.questionMutation(() => this.remote.deleteQuestionBatch(request))
  }

  /**
   * Copy selected questions into a student's image folder.
   * @param request - destination student and source image ids.
   * @returns the settled persistence result.
   */
  assignQuestions(request: TeacherQuestionAssignRequest): Promise<TeacherWorkbenchActionResult> {
    return this.questionMutation(() => this.remote.assignQuestions(request))
  }

  /**
   * Snapshot selected student images for the legacy temporary-generation workflow.
   * @param request - student identity and ordered assignment ids.
   * @returns copied-image count or a stable failure.
   */
  async saveTemporaryQuestionSelection(
    request: TeacherQuestionTemporarySaveRequest,
  ): Promise<TeacherQuestionTemporarySaveResult> {
    try {
      const carried = await this.remote.saveTemporaryQuestionSelection(request)
      return carried.ok
        ? carried.value
        : { ok: false, error: { code: 'storage-failure', message: carried.error.message } }
    } catch (error) {
      return transportQuestionFailure(error)
    }
  }

  /**
   * Read temporary-generation availability for the requested roster students.
   * @param request - student identities to inspect.
   * @returns available temporary selections or a stable failure.
   */
  async listTemporaryQuestionSelections(
    request: TeacherQuestionTemporaryListRequest,
  ): Promise<TeacherQuestionTemporaryListResult> {
    try {
      const carried = await this.remote.listTemporaryQuestionSelections(request)
      return carried.ok
        ? carried.value
        : { ok: false, error: { code: 'storage-failure', message: carried.error.message } }
    } catch (error) {
      return transportQuestionFailure(error)
    }
  }

  /**
   * Generate one downloadable Word or PowerPoint artifact.
   * @param request - output options and ordered stored-image targets.
   * @returns the generated artifact or a stable failure.
   */
  generateQuestionDocument(request: TeacherQuestionDocumentRequest): Promise<TeacherQuestionDocumentResult> {
    return this.questionDocument(() => this.remote.generateQuestionDocument(request))
  }

  /**
   * Generate one Word or PowerPoint file from browser-selected images.
   * @param request - selected directory name, ordered images, and output family.
   * @returns the generated artifact or a stable failure.
   */
  generateUploadedQuestionDocument(
    request: TeacherQuestionUploadedDocumentRequest,
  ): Promise<TeacherQuestionDocumentResult> {
    return this.questionDocument(() => this.remote.generateUploadedQuestionDocument(request))
  }

  /**
   * Generate one independent Word or PowerPoint file per selected student.
   * @param request - output family and independent per-student Word options.
   * @returns generated artifacts, skipped students, or a stable failure.
   */
  async generateStudentDocuments(
    request: TeacherQuestionBatchDocumentRequest,
  ): Promise<TeacherQuestionBatchDocumentResult> {
    try {
      const carried = await this.remote.generateStudentDocuments(request)
      return carried.ok
        ? carried.value
        : { ok: false, error: { code: 'generation-failure', message: carried.error.message } }
    } catch (error) {
      return transportQuestionFailure(error)
    }
  }

  /** Drop subscribers and refuse later commands. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private id(): string {
    return this.createId()
  }

  private mutate(transform: (state: TeacherWorkbenchState) => TeacherWorkbenchState): Promise<TeacherWorkbenchActionResult> {
    return this.enqueue(async () => {
      const seeded = await this.ensure()
      if (!seeded.ok) return seeded
      const observed = this.snapshot.document
      if (observed === null) return this.failure('unavailable', 'teacher workbench document is unavailable')
      let current: TeacherWorkbenchDocument = observed
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const state = transform(current.state)
        this.publish({ status: 'saving', document: current, error: null })
        const carried = await this.callWrite(current.revision, state)
        if (!carried.ok) return carried
        const result = carried.value
        if (result.ok) {
          this.publish({ status: 'ready', document: result.value, error: null })
          return OK
        }
        if (result.error.code === 'revision-conflict') {
          current = result.error.current
          continue
        }
        return this.failure(result.error.code, result.error.message)
      }
      this.publish({ status: 'error', document: current, error: { code: 'revision-conflict', message: 'revision conflict' } })
      return { ok: false, error: { code: 'revision-conflict', message: 'revision conflict' } }
    })
  }

  private questionMutation(
    call: () => Promise<RemoteResult<TeacherQuestionMutationResult>>,
  ): Promise<TeacherWorkbenchActionResult> {
    return this.enqueue(async () => {
      const seeded = await this.ensure()
      if (!seeded.ok) return seeded
      this.publish({ status: 'saving', document: this.snapshot.document, error: null })
      try {
        const carried = await call()
        if (!carried.ok) return this.failure(carried.error.code, carried.error.message)
        if (!carried.value.ok) return this.failure(carried.value.error.code, carried.value.error.message)
        this.publish({ status: 'ready', document: carried.value.value.document, error: null })
        return carried.value.value.batchId === undefined
          ? OK
          : { ok: true, batchId: carried.value.value.batchId }
      } catch (error) {
        return this.failure('transport', error instanceof Error ? error.message : 'question operation failed')
      }
    })
  }

  private async questionDocument(
    call: () => Promise<RemoteResult<TeacherQuestionDocumentResult>>,
  ): Promise<TeacherQuestionDocumentResult> {
    try {
      const carried = await call()
      return carried.ok
        ? carried.value
        : { ok: false, error: { code: 'generation-failure', message: carried.error.message } }
    } catch (error) {
      return transportQuestionFailure(error)
    }
  }

  private async callWrite(
    expectedRevision: number,
    state: TeacherWorkbenchState,
  ): Promise<TeacherWorkbenchWriteCallResult> {
    try {
      const carried = await this.remote.write({ expectedRevision, state })
      if (!carried.ok) return this.failure(carried.error.code, carried.error.message)
      return { ok: true, value: carried.value }
    } catch (error) {
      return this.failure('transport', error instanceof Error ? error.message : 'teacher workbench write failed')
    }
  }

  private enqueue(operation: () => Promise<TeacherWorkbenchActionResult>): Promise<TeacherWorkbenchActionResult> {
    const result = this.operationTail.then(async () => {
      if (this.disposed) return { ok: false, error: { code: 'disposed', message: 'teacher workbench is disposed' } } as const
      return await operation()
    })
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private async load(): Promise<TeacherWorkbenchActionResult> {
    try {
      const carried = await this.remote.read({})
      if (this.disposed) return OK
      if (!carried.ok) return this.failure(carried.error.code, carried.error.message)
      this.publish({ status: 'ready', document: carried.value.value, error: null })
      return OK
    } catch (error) {
      if (this.disposed) return OK
      return this.failure('transport', error instanceof Error ? error.message : 'teacher workbench read failed')
    }
  }

  private failure(code: string, message: string): TeacherWorkbenchActionFailure {
    const error = { code, message }
    this.publish({ status: 'error', document: this.snapshot.document, error })
    return { ok: false, error }
  }

  private publish(snapshot: TeacherWorkbenchSnapshot): void {
    if (this.disposed) return
    this.snapshot = Object.freeze({ ...snapshot })
    for (const listener of [...this.listeners]) listener()
  }
}

function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  const index = items.findIndex(candidate => candidate.id === item.id)
  if (index < 0) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}

function upsertBy<T>(items: readonly T[], item: T, key: (value: T) => unknown): T[] {
  const itemKey = key(item)
  const index = items.findIndex(candidate => key(candidate) === itemKey)
  if (index < 0) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}

function transportQuestionFailure(error: unknown): TeacherQuestionRejected {
  return {
    ok: false,
    error: {
      code: 'storage-failure',
      message: error instanceof Error ? error.message : 'question operation failed',
    },
  }
}

type TimetableSlot = Pick<TeacherTimetableEntry, 'classId' | 'kind' | 'weekday' | 'period'>

function resolveTimetableClass(
  classes: readonly TeacherClass[],
  input: Pick<TeacherTimetableEntryInput, 'classId' | 'className' | 'grade' | 'subject' | 'usage'>,
  createId: () => TeacherClassId,
): { classes: TeacherClass[]; classId: TeacherClassId } {
  const className = input.className.trim()
  const grade = input.grade.trim()
  const existing = input.classId === undefined
    ? classes.find(item => item.usage === input.usage && item.name === className && item.grade === grade)
    : classes.find(item => item.id === input.classId && item.usage === input.usage)
      ?? classes.find(item => item.usage === input.usage && item.name === className && item.grade === grade)
  if (existing !== undefined) return { classes: [...classes], classId: existing.id }
  const item: TeacherClass = {
    id: createId(),
    usage: input.usage,
    name: className,
    grade,
    subject: input.subject.trim(),
  }
  return { classes: [...classes, item], classId: item.id }
}

function replaceTimetableSlot(
  entries: readonly TeacherTimetableEntry[],
  item: TeacherTimetableEntry,
): TeacherTimetableEntry[] {
  return [
    ...entries.filter(candidate => candidate.id !== item.id && !sameTimetableSlot(candidate, item)),
    item,
  ]
}

function sameTimetableSlot(left: TimetableSlot, right: TimetableSlot): boolean {
  return left.classId === right.classId
    && left.kind === right.kind
    && left.weekday === right.weekday
    && left.period === right.period
}
