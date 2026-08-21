/**
 * Client-safe data and Remote vocabulary for the teacher workbench.
 * @module @deepseek-ai/dsh-host-teacher-workbench/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque class identity. */
export type TeacherClassId = Branded<'TeacherClassId'>
/** Opaque student identity. */
export type TeacherStudentId = Branded<'TeacherStudentId'>
/** Opaque lesson-resource identity. */
export type TeacherLessonResourceId = Branded<'TeacherLessonResourceId'>
/** Opaque record-template identity. */
export type TeacherRecordTemplateId = Branded<'TeacherRecordTemplateId'>
/** Opaque teaching-record identity. */
export type TeacherRecordId = Branded<'TeacherRecordId'>
/** Opaque exam identity. */
export type TeacherExamId = Branded<'TeacherExamId'>
/** Opaque daily-todo identity. */
export type TeacherDailyTodoId = Branded<'TeacherDailyTodoId'>
/** Opaque quick-note identity. */
export type TeacherQuickNoteId = Branded<'TeacherQuickNoteId'>
/** Opaque ledger-category identity. */
export type TeacherLedgerCategoryId = Branded<'TeacherLedgerCategoryId'>
/** Opaque ledger-entry identity. */
export type TeacherLedgerEntryId = Branded<'TeacherLedgerEntryId'>
/** Opaque calendar-item identity. */
export type TeacherCalendarItemId = Branded<'TeacherCalendarItemId'>
/** Opaque timetable-entry identity. */
export type TeacherTimetableEntryId = Branded<'TeacherTimetableEntryId'>
/** Opaque segmented-paper batch identity. */
export type TeacherQuestionBatchId = Branded<'TeacherQuestionBatchId'>
/** Opaque segmented-question image identity. */
export type TeacherQuestionImageId = Branded<'TeacherQuestionImageId'>
/** Opaque student question-copy identity. */
export type TeacherQuestionAssignmentId = Branded<'TeacherQuestionAssignmentId'>
/** Opaque student question-folder identity. */
export type TeacherQuestionFolderId = Branded<'TeacherQuestionFolderId'>
/** Opaque identity assigned to one OCR element during a question-segmentation run. */
export type TeacherQuestionLayoutElementId = Branded<'TeacherQuestionLayoutElementId'>

/** Stable palette key used to mark a daily task. */
export type TeacherDailyTodoColor =
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'blue'
  | 'violet'
  | 'pink'

/** Mutually exclusive list that owns one daily task. */
export type TeacherDailyTodoCategory = 'today' | 'important' | 'urgent'

/** Weekday number using Monday as one and Sunday as seven. */
export type TeacherWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Course-table row family. */
export type TeacherTimetableEntryKind = 'lesson' | 'morningStudy' | 'eveningStudy'

/** Durable catalog that owns a class and controls where it is selectable. */
export type TeacherClassUsage =
  | 'roster'
  | 'timetable'
  | 'gradeTimetable'

/** Timetable catalog that owns a schedule class. */
export type TeacherTimetableClassUsage = Exclude<TeacherClassUsage, 'roster'>

/** One class owned by the roster or one timetable catalog. */
export interface TeacherClass {
  /** Stable identity. */
  readonly id: TeacherClassId
  /** Catalog in which this class may be selected. */
  readonly usage: TeacherClassUsage
  /** Optional academic-year directory used by the reference question hierarchy. */
  readonly academicYear?: string
  /** Display name, such as "高一（1）班". */
  readonly name: string
  /** Optional grade label. */
  readonly grade: string
  /** Optional subject label. */
  readonly subject: string
}

/** One student in a class roster. */
export interface TeacherStudent {
  /** Stable identity. */
  readonly id: TeacherStudentId
  /** Owning class. */
  readonly classId: TeacherClassId
  /** Student name. */
  readonly name: string
  /** School-assigned student number. */
  readonly studentNumber: string
  /** Optional gender text from the source roster. */
  readonly gender: string
  /** Optional guardian name. */
  readonly guardian: string
  /** Optional guardian relationship. */
  readonly relation: string
  /** Optional guardian phone. */
  readonly phone: string
  /** Optional address. */
  readonly address: string
  /** Imported columns that are not part of the standard roster. */
  readonly extras: Readonly<Record<string, string>>
}

/** Resource group used by daily lesson preparation. */
export type TeacherLessonResourceCategory = 'resource' | 'observation' | 'publicLesson'

/** One reusable lesson-preparation link. */
export interface TeacherLessonResource {
  /** Stable identity. */
  readonly id: TeacherLessonResourceId
  /** Resource group. */
  readonly category: TeacherLessonResourceCategory
  /** Display name. */
  readonly name: string
  /** Absolute web address. */
  readonly url: string
  /** Optional teacher-authored note. */
  readonly description: string
}

/** Template family for observation forms and teaching records. */
export type TeacherRecordTemplateKind = 'observation' | 'teaching'

/** Reusable field list for one record family. */
export interface TeacherRecordTemplate {
  /** Stable identity. */
  readonly id: TeacherRecordTemplateId
  /** Module that uses this template. */
  readonly kind: TeacherRecordTemplateKind
  /** Display name. */
  readonly name: string
  /** Optional use-case description. */
  readonly scene: string
  /** Ordered field labels. */
  readonly fields: readonly string[]
}

/** Lifecycle state of one observation or teaching record. */
export type TeacherRecordStatus = 'active' | 'done'

/** One record populated from a reusable template. */
export interface TeacherRecord {
  /** Stable identity. */
  readonly id: TeacherRecordId
  /** Template used to author the values. */
  readonly templateId: TeacherRecordTemplateId
  /** Record title. */
  readonly title: string
  /** Optional ISO date chosen by the teacher. */
  readonly dueDate: string
  /** Current lifecycle state. */
  readonly status: TeacherRecordStatus
  /** Field label to teacher-authored value. */
  readonly values: Readonly<Record<string, string>>
  /** Host-independent last edit time in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** Scores for one student in one exam. */
export interface TeacherExamEntry {
  /** Roster student receiving these scores. */
  readonly studentId: TeacherStudentId
  /** Subject label to numeric score. */
  readonly scores: Readonly<Record<string, number>>
}

/** One imported exam for a class. */
export interface TeacherExam {
  /** Stable identity. */
  readonly id: TeacherExamId
  /** Class whose roster anchors score rows. */
  readonly classId: TeacherClassId
  /** Exam display name. */
  readonly name: string
  /** Optional ISO exam date. */
  readonly date: string
  /** Scores keyed to roster identities. */
  readonly entries: readonly TeacherExamEntry[]
}

/** One teacher-authored daily task. */
export interface TeacherDailyTodo {
  /** Stable identity. */
  readonly id: TeacherDailyTodoId
  /** Task text. */
  readonly title: string
  /** Optional local ISO date and time chosen by the teacher. */
  readonly dueAt: string
  /** Whether the teacher marked the task complete. */
  readonly completed: boolean
  /** Mutually exclusive list that owns the task. */
  readonly category: TeacherDailyTodoCategory
  /** Color marker shown for important and urgent tasks. */
  readonly color: TeacherDailyTodoColor
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Last edit time in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** One independently editable quick note. */
export interface TeacherQuickNote {
  /** Stable identity. */
  readonly id: TeacherQuickNoteId
  /** Teacher-authored note content. */
  readonly content: string
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Last edit time in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** One teacher-defined grouping for daily ledger entries. */
export interface TeacherLedgerCategory {
  /** Stable identity. */
  readonly id: TeacherLedgerCategoryId
  /** Teacher-facing category name. */
  readonly name: string
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
}

/** One expense recorded below a teacher-defined ledger category. */
export interface TeacherLedgerEntry {
  /** Stable identity. */
  readonly id: TeacherLedgerEntryId
  /** Category that owns this entry. */
  readonly categoryId: TeacherLedgerCategoryId
  /** Teacher-authored expense description. */
  readonly description: string
  /** Non-negative CNY amount stored as integer cents. */
  readonly amountCents: number
  /** Local ISO date and time chosen by the teacher. */
  readonly occurredAt: string
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Last edit time in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** One teacher-authored item attached to a calendar date. */
export interface TeacherCalendarItem {
  /** Stable identity. */
  readonly id: TeacherCalendarItemId
  /** Local ISO calendar date. */
  readonly date: string
  /** Optional local start time. */
  readonly time: string
  /** Item title. */
  readonly title: string
  /** Optional details. */
  readonly details: string
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Last edit time in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** One timetable entry owned by the area of its referenced class. */
export interface TeacherTimetableEntry {
  /** Stable identity. */
  readonly id: TeacherTimetableEntryId
  /** Timetable-owned class receiving the lesson or study session. */
  readonly classId: TeacherClassId
  /** Regular lesson, morning study, or evening study. */
  readonly kind: TeacherTimetableEntryKind
  /** Weekday using Monday as one. */
  readonly weekday: TeacherWeekday
  /** One-based slot within the selected row family. */
  readonly period: number
  /** Optional local start time. */
  readonly startTime: string
  /** Optional local end time. */
  readonly endTime: string
  /** Course or study-session label. */
  readonly subject: string
  /** Teacher responsible for the entry. */
  readonly teacherName: string
  /** Optional classroom or location. */
  readonly location: string
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Last edit time in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** Raster formats accepted by the question workspace. */
export type TeacherQuestionImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

/** One cropped question image owned by a paper batch. */
export interface TeacherQuestionImage {
  /** Stable identity used to derive its server-side file name. */
  readonly id: TeacherQuestionImageId
  /** One-based question number within the paper. */
  readonly questionNo: number
  /** Safe display file name. */
  readonly fileName: string
  /** Encoded raster format. */
  readonly mediaType: TeacherQuestionImageMediaType
  /** Intrinsic pixel width. */
  readonly width: number
  /** Intrinsic pixel height. */
  readonly height: number
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Last image edit time in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** One uploaded paper and its persisted question crops. */
export interface TeacherQuestionBatch {
  /** Stable identity. */
  readonly id: TeacherQuestionBatchId
  /** Teacher-facing batch name. */
  readonly name: string
  /** Original PDF display name. */
  readonly sourceName: string
  /** Teacher-entered page selection. */
  readonly pageRange: string
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Question images in numeric order. */
  readonly images: readonly TeacherQuestionImage[]
}

/** One durable nested directory below a roster student. */
export interface TeacherQuestionFolder {
  /** Stable identity used by hierarchy interactions and assignment targets. */
  readonly id: TeacherQuestionFolderId
  /** Student whose hierarchy owns this folder. */
  readonly studentId: TeacherStudentId
  /** Parent folder; omission places the folder directly below the student. */
  readonly parentId?: TeacherQuestionFolderId
  /** Teacher-facing directory name. */
  readonly name: string
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Last metadata update time in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** Independent question-image copy assigned to one roster student. */
export interface TeacherQuestionAssignment {
  /** Stable identity used to derive its server-side file name. */
  readonly id: TeacherQuestionAssignmentId
  /** Student owning the copy. */
  readonly studentId: TeacherStudentId
  /** Source batch image retained for traceability. */
  readonly sourceImageId: TeacherQuestionImageId
  /** Optional nested destination folder below the owning student. */
  readonly folderId?: TeacherQuestionFolderId
  /** Safe display file name. */
  readonly fileName: string
  /** Safe path below the configured student root, fixed at assignment time. */
  readonly relativePath: string
  /** Encoded raster format. */
  readonly mediaType: TeacherQuestionImageMediaType
  /** Intrinsic pixel width. */
  readonly width: number
  /** Intrinsic pixel height. */
  readonly height: number
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Last image edit time in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** Complete durable workbench data. */
export interface TeacherWorkbenchState {
  /** Daily tasks in creation order. */
  readonly dailyTodos: readonly TeacherDailyTodo[]
  /** Quick notes in creation order. */
  readonly quickNotes: readonly TeacherQuickNote[]
  /** Ledger categories in creation order. */
  readonly ledgerCategories: readonly TeacherLedgerCategory[]
  /** Ledger entries in creation order. */
  readonly ledgerEntries: readonly TeacherLedgerEntry[]
  /** Teacher-authored calendar items. */
  readonly calendarItems: readonly TeacherCalendarItem[]
  /** Timetable entries grouped by their owning class usage. */
  readonly timetableEntries: readonly TeacherTimetableEntry[]
  /** Roster, normal-timetable, and grade-timetable classes in display order. */
  readonly classes: readonly TeacherClass[]
  /** Students in import or creation order. */
  readonly students: readonly TeacherStudent[]
  /** Lesson-preparation links. */
  readonly resources: readonly TeacherLessonResource[]
  /** Observation and teaching-record templates. */
  readonly templates: readonly TeacherRecordTemplate[]
  /** Authored observation and teaching records. */
  readonly records: readonly TeacherRecord[]
  /** Imported exams in creation order. */
  readonly exams: readonly TeacherExam[]
  /** Persisted paper batches available for browsing and assignment. */
  readonly questionBatches: readonly TeacherQuestionBatch[]
  /** Durable nested folders created below roster students. */
  readonly questionFolders: readonly TeacherQuestionFolder[]
  /** Independent student copies created from batch images. */
  readonly questionAssignments: readonly TeacherQuestionAssignment[]
}

/** Revisioned durable document returned by every successful Remote call. */
export interface TeacherWorkbenchDocument {
  /** Monotonic compare-and-set revision. */
  readonly revision: number
  /** Complete immutable workbench state. */
  readonly state: TeacherWorkbenchState
}

/** Empty request accepted when reading the current workbench document. */
export type TeacherWorkbenchReadRequest = Record<never, never>

/** Replace the workbench document after observing its current revision. */
export interface TeacherWorkbenchWriteRequest {
  /** Revision returned by the most recent accepted read or write. */
  readonly expectedRevision: number
  /** Complete replacement state. */
  readonly state: TeacherWorkbenchState
}

/** A successful workbench operation. */
export interface TeacherWorkbenchSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Current immutable document. */
  readonly value: TeacherWorkbenchDocument
}

/** The caller wrote against an older document revision. */
export interface TeacherWorkbenchRevisionConflict {
  /** Stable failure code. */
  readonly code: 'revision-conflict'
  /** Current document for client-side reconciliation. */
  readonly current: TeacherWorkbenchDocument
}

/** The submitted state violates a relationship not expressible in TypeScript. */
export interface TeacherWorkbenchInvalidState {
  /** Stable failure code. */
  readonly code: 'invalid-state'
  /** Concise validation diagnostic. */
  readonly message: string
}

/** A rejected write whose authoritative document remains unchanged. */
export interface TeacherWorkbenchRejected {
  /** Failure discriminant. */
  readonly ok: false
  /** Business failure. */
  readonly error: TeacherWorkbenchRevisionConflict | TeacherWorkbenchInvalidState
}

/** Read result. */
export type TeacherWorkbenchReadResult = TeacherWorkbenchSuccess
/** Compare-and-set write result. */
export type TeacherWorkbenchWriteResult = TeacherWorkbenchSuccess | TeacherWorkbenchRejected

/** Destination selected before timetable extraction starts. */
export type TeacherTimetableNormalizeTarget = 'class' | 'grade' | 'study'

/** Existing timetable context supplied to the normalization agent. */
export interface TeacherTimetableNormalizeDefaults {
  /** Class selected in the current timetable view, when one applies. */
  readonly className: string
  /** Classes already configured for the selected grade. */
  readonly classNames: readonly string[]
  /** Grade selected in the current timetable view. */
  readonly grade: string
  /** Entry family implied by the current timetable view. */
  readonly kind: TeacherTimetableEntryKind
  /** Timetable destination whose content rules the agent must follow. */
  readonly target: TeacherTimetableNormalizeTarget
  /** Teacher name configured for the workbench. */
  readonly teacherName: string
}

/** Normalize one OCR document through a one-shot structured-output agent. */
export interface TeacherTimetableNormalizeRequest {
  /** Live root session that owns the short-lived child agent. */
  readonly parentSessionId: SessionId
  /** Uploaded file name used only as task context. */
  readonly fileName: string
  /** MinerU Markdown, including discarded text when available. */
  readonly markdown: string
  /** Original raster source offered directly when the configured tool model accepts image input. */
  readonly image?: {
    /** Browser-declared raster media type, verified by the attachment service. */
    readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
    /** Canonical base64-encoded source bytes. */
    readonly contentBase64: string
  }
  /** Current workbench defaults and known class names. */
  readonly defaults: TeacherTimetableNormalizeDefaults
}

/** One normalized row accepted by the timetable import review. */
export interface TeacherTimetableNormalizedEntry {
  /** Class display name. */
  readonly className: string
  /** Grade display name. */
  readonly grade: string
  /** Entry family. */
  readonly kind: TeacherTimetableEntryKind
  /** Monday-based weekday. */
  readonly weekday: TeacherWeekday
  /** One-based lesson period. */
  readonly period: number
  /** Optional local start time in HH:mm form. */
  readonly startTime: string
  /** Optional local end time in HH:mm form. */
  readonly endTime: string
  /** Course or study-subject name. */
  readonly subject: string
  /** Optional teacher name. */
  readonly teacherName: string
  /** Optional classroom or location. */
  readonly location: string
}

/** Stable failure codes for timetable normalization. */
export type TeacherTimetableNormalizeErrorCode =
  | 'invalid-request'
  | 'session-unavailable'
  | 'tool-model-unavailable'
  | 'vision-unavailable'
  | 'source-too-large'
  | 'timed-out'
  | 'model-failed'
  | 'invalid-output'

/** Rejected timetable normalization. */
export interface TeacherTimetableNormalizeRejected {
  /** Failure discriminant. */
  readonly ok: false
  /** Stable failure and concise diagnostic. */
  readonly error: {
    readonly code: TeacherTimetableNormalizeErrorCode
    readonly message: string
  }
}

/** Successful timetable normalization. */
export interface TeacherTimetableNormalizeSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Rows ready for editable browser review. */
  readonly value: {
    readonly items: readonly TeacherTimetableNormalizedEntry[]
  }
}

/** Timetable normalization result. */
export type TeacherTimetableNormalizeResult = TeacherTimetableNormalizeSuccess | TeacherTimetableNormalizeRejected

/** Browser-supplied OCR element used only as evidence for question boundaries. */
export interface TeacherQuestionLayoutElement {
  /** Provider-normalized content family. */
  readonly type: 'text' | 'equation' | 'image' | 'table' | 'other'
  /** Reading-order text assembled by the OCR provider. */
  readonly text: string
  /** Left, top, right, and bottom coordinates in page units. */
  readonly bbox: readonly [number, number, number, number]
}

/** One selected OCR page supplied to the question-boundary agent. */
export interface TeacherQuestionLayoutPage {
  /** Zero-based index in the original PDF. */
  readonly pageIndex: number
  /** Page width in OCR coordinates. */
  readonly width: number
  /** Page height in OCR coordinates. */
  readonly height: number
  /** Elements in provider reading order. */
  readonly elements: readonly TeacherQuestionLayoutElement[]
}

/** Detect semantic question boundaries in an already extracted PDF layout. */
export interface TeacherQuestionSegmentRequest {
  /** Live root session that owns the short-lived child agent. */
  readonly parentSessionId: SessionId
  /** Original PDF display name used only as task context. */
  readonly fileName: string
  /** Exact selected pages and their OCR geometry. */
  readonly pages: readonly TeacherQuestionLayoutPage[]
  /** Extra vertical page units retained around accepted boundaries. */
  readonly padding: number
}

/** One source-page slice contributing pixels to a question crop. */
export interface TeacherQuestionPageRegion {
  /** Zero-based index in the original PDF. */
  readonly pageIndex: number
  /** Inclusive crop left in OCR page units. */
  readonly left: number
  /** Inclusive crop top in OCR page units. */
  readonly top: number
  /** Exclusive crop right in OCR page units. */
  readonly right: number
  /** Exclusive crop bottom in OCR page units. */
  readonly bottom: number
  /** OCR page width used for proportional browser rendering. */
  readonly pageWidth: number
  /** OCR page height used for proportional browser rendering. */
  readonly pageHeight: number
}

/** One top-level question accepted by the segmentation validator. */
export interface TeacherSegmentedQuestion {
  /** Unique source-order display number assigned after boundary validation. */
  readonly questionNo: number
  /** Original PDF page containing the accepted top-level question marker. */
  readonly headPageIndex: number
  /** Zero-based processing group that owns this question. */
  readonly groupIndex: number
  /** Ordered page slices joined into one raster by the browser. */
  readonly regions: readonly TeacherQuestionPageRegion[]
}

/** Stable question-segmentation failure codes. */
export type TeacherQuestionSegmentErrorCode =
  | 'invalid-request'
  | 'session-unavailable'
  | 'tool-model-unavailable'
  | 'source-too-large'
  | 'timed-out'
  | 'model-failed'
  | 'invalid-output'

/** Rejected semantic question-boundary detection. */
export interface TeacherQuestionSegmentRejected {
  /** Failure discriminant. */
  readonly ok: false
  /** Stable failure and concise diagnostic. */
  readonly error: {
    readonly code: TeacherQuestionSegmentErrorCode
    readonly message: string
  }
}

/** Successful semantic question-boundary detection. */
export interface TeacherQuestionSegmentSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Validated crop regions in source order. */
  readonly value: {
    /** Number of semantic page groups processed for this request. */
    readonly groupCount: number
    /** Maximum decoded image bytes sent in one automatic save part. */
    readonly maxSaveBatchBytes: number
    readonly questions: readonly TeacherSegmentedQuestion[]
  }
}

/** Semantic question-boundary result returned to the browser. */
export type TeacherQuestionSegmentResult = TeacherQuestionSegmentSuccess | TeacherQuestionSegmentRejected

/** Stable weather-provider failure codes presented by the workbench UI. */
export type TeacherWeatherErrorCode = 'location-not-found' | 'provider-unavailable' | 'invalid-response'

/** One provider-local hour in the next-twelve-hours forecast. */
export interface TeacherWeatherHour {
  /** Provider-local ISO time. */
  readonly time: string
  /** Air temperature in degrees Celsius. */
  readonly temperature: number
  /** WMO weather interpretation code. */
  readonly weatherCode: number
  /** Probability of precipitation as a percentage. */
  readonly precipitationProbability: number
}

/** Validated weather data rendered by the compact and expanded panels. */
export interface TeacherWeatherForecast {
  /** Resolved location and administrative areas. */
  readonly location: string
  /** Provider timezone for all returned timestamps. */
  readonly timezone: string
  /** Current provider-local ISO time. */
  readonly observedAt: string
  /** Current air temperature in degrees Celsius. */
  readonly temperature: number
  /** Current apparent temperature in degrees Celsius. */
  readonly apparentTemperature: number
  /** Current relative humidity as a percentage. */
  readonly humidity: number
  /** Current precipitation in millimetres. */
  readonly precipitation: number
  /** Current WMO weather interpretation code. */
  readonly weatherCode: number
  /** Current wind speed in kilometres per hour. */
  readonly windSpeed: number
  /** Today's maximum air temperature in degrees Celsius. */
  readonly maximumTemperature: number
  /** Today's minimum air temperature in degrees Celsius. */
  readonly minimumTemperature: number
  /** Today's maximum precipitation probability as a percentage. */
  readonly precipitationProbability: number
  /** Provider-local sunrise time. */
  readonly sunrise: string
  /** Provider-local sunset time. */
  readonly sunset: string
  /** Up to twelve consecutive forecast hours. */
  readonly hours: readonly TeacherWeatherHour[]
}

/** Location lookup request accepted by the weather Remote. */
export interface TeacherWeatherRequest {
  /** Non-empty district, county, or city search text. */
  readonly location: string
}

/** Successful weather lookup. */
export interface TeacherWeatherSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Validated current conditions and forecast. */
  readonly value: TeacherWeatherForecast
}

/** Weather lookup failure safe to send to the browser. */
export interface TeacherWeatherFailure {
  /** Stable failure code. */
  readonly code: TeacherWeatherErrorCode
  /** Concise diagnostic. */
  readonly message: string
}

/** Rejected weather lookup. */
export interface TeacherWeatherRejected {
  /** Failure discriminant. */
  readonly ok: false
  /** Provider or lookup failure. */
  readonly error: TeacherWeatherFailure
}

/** Weather lookup result returned by the Host Remote. */
export type TeacherWeatherResult = TeacherWeatherSuccess | TeacherWeatherRejected

/** Browser-produced question crop accepted by the Host. */
export interface TeacherQuestionImageUpload {
  /** One-based question number within the new batch. */
  readonly questionNo: number
  /** Display file name; the Host derives the storage path from generated ids. */
  readonly fileName: string
  /** Encoded raster format. */
  readonly mediaType: TeacherQuestionImageMediaType
  /** Intrinsic pixel width. */
  readonly width: number
  /** Intrinsic pixel height. */
  readonly height: number
  /** Canonical base64 raster bytes. */
  readonly contentBase64: string
}

/** Atomic paper-batch save request. */
export interface TeacherQuestionBatchSaveRequest {
  /** Existing paper batch that receives this bounded continuation part. */
  readonly appendToBatchId?: TeacherQuestionBatchId
  /** Teacher-facing batch name. */
  readonly name: string
  /** Original PDF display name. */
  readonly sourceName: string
  /** Teacher-entered page selection. */
  readonly pageRange: string
  /** Ordered question crops; an empty batch is rejected. */
  readonly images: readonly TeacherQuestionImageUpload[]
}

/** A stored batch image or independent student copy. */
export type TeacherQuestionImageTarget =
  | { readonly kind: 'batch'; readonly id: TeacherQuestionImageId }
  | { readonly kind: 'assignment'; readonly id: TeacherQuestionAssignmentId }

/** Read one stored question image. */
export interface TeacherQuestionImageReadRequest {
  /** Exact image to read. */
  readonly target: TeacherQuestionImageTarget
}

/** Browser-safe stored image bytes. */
export interface TeacherQuestionImagePayload {
  /** Display file name. */
  readonly fileName: string
  /** Encoded raster format. */
  readonly mediaType: TeacherQuestionImageMediaType
  /** Intrinsic pixel width. */
  readonly width: number
  /** Intrinsic pixel height. */
  readonly height: number
  /** Canonical base64 raster bytes. */
  readonly contentBase64: string
}

/** Replace one stored image after browser-side editing. */
export interface TeacherQuestionImageReplaceRequest extends TeacherQuestionImagePayload {
  /** Exact image to replace. */
  readonly target: TeacherQuestionImageTarget
}

/** Delete one image or assignment copy. */
export interface TeacherQuestionImageDeleteRequest {
  /** Exact image to delete. */
  readonly target: TeacherQuestionImageTarget
}

/** Delete one paper batch and every owned crop. */
export interface TeacherQuestionBatchDeleteRequest {
  /** Batch to delete. */
  readonly batchId: TeacherQuestionBatchId
}

/** Copy selected batch images into one student's question collection. */
export interface TeacherQuestionAssignRequest {
  /** Destination roster student. */
  readonly studentId: TeacherStudentId
  /** Optional nested folder below the destination student. */
  readonly folderId?: TeacherQuestionFolderId
  /** Source batch images in requested order. */
  readonly imageIds: readonly TeacherQuestionImageId[]
}

/** Replace one student's temporary Office-generation image selection. */
export interface TeacherQuestionTemporarySaveRequest {
  /** Roster student that owns every selected assignment. */
  readonly studentId: TeacherStudentId
  /** Ordered student-image copies to snapshot into temporary storage. */
  readonly assignmentIds: readonly TeacherQuestionAssignmentId[]
}

/** Query temporary Office-generation selections for roster students. */
export interface TeacherQuestionTemporaryListRequest {
  /** Students whose temporary image counts should be returned. */
  readonly studentIds: readonly TeacherStudentId[]
}

/** One available temporary Office-generation selection. */
export interface TeacherQuestionTemporarySelection {
  /** Roster student that owns the selection. */
  readonly studentId: TeacherStudentId
  /** Naturally ordered image count in temporary storage. */
  readonly imageCount: number
}

/** Stable question-workspace operation failure. */
export interface TeacherQuestionFailure {
  /** Machine-readable failure family. */
  readonly code: 'invalid-request' | 'not-found' | 'file-too-large' | 'storage-failure' | 'generation-failure'
  /** User-safe diagnostic. */
  readonly message: string
}

/** Successful state-changing question operation. */
export interface TeacherQuestionMutationSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Committed workbench document. */
  readonly value: {
    readonly document: TeacherWorkbenchDocument
    /** Present when the operation created a batch. */
    readonly batchId?: TeacherQuestionBatchId
  }
}

/** Rejected question operation. */
export interface TeacherQuestionRejected {
  /** Failure discriminant. */
  readonly ok: false
  /** Stable failure. */
  readonly error: TeacherQuestionFailure
}

/** Result of a state-changing question operation. */
export type TeacherQuestionMutationResult = TeacherQuestionMutationSuccess | TeacherQuestionRejected

/** Successful stored-image read. */
export interface TeacherQuestionImageReadSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Stored image metadata and bytes. */
  readonly value: TeacherQuestionImagePayload
}

/** Stored-image read result. */
export type TeacherQuestionImageReadResult = TeacherQuestionImageReadSuccess | TeacherQuestionRejected

/** Successful temporary-selection save. */
export interface TeacherQuestionTemporarySaveSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Stored selection and copied-image count. */
  readonly value: TeacherQuestionTemporarySelection
}

/** Temporary-selection save result. */
export type TeacherQuestionTemporarySaveResult = TeacherQuestionTemporarySaveSuccess | TeacherQuestionRejected

/** Successful temporary-selection availability query. */
export interface TeacherQuestionTemporaryListSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Students that currently have at least one staged image. */
  readonly value: readonly TeacherQuestionTemporarySelection[]
}

/** Temporary-selection availability result. */
export type TeacherQuestionTemporaryListResult = TeacherQuestionTemporaryListSuccess | TeacherQuestionRejected

/** One printable document generated from stored question images. */
export interface TeacherQuestionDocumentRequest {
  /** Output document family. */
  readonly kind: 'word' | 'ppt'
  /** Document title. */
  readonly title: string
  /** Images in output order. */
  readonly targets: readonly TeacherQuestionImageTarget[]
  /** Optional student name printed below the title. */
  readonly studentName: string
  /** Whether to print the current local date. */
  readonly includeDate: boolean
}

/** One browser-selected image used only while generating an Office artifact. */
export interface TeacherQuestionDocumentImageUpload {
  /** Display file name. */
  readonly fileName: string
  /** Natural-sort key relative to the selected directory. */
  readonly relativePath: string
  /** Base64 source bytes; the Host detects and normalizes the image format. */
  readonly contentBase64: string
}

/** Generate one Office artifact directly from a browser-selected image directory. */
export interface TeacherQuestionUploadedDocumentRequest {
  /** Output document family. */
  readonly kind: 'word' | 'ppt'
  /** Selected directory name and output file stem. */
  readonly folderName: string
  /** Naturally ordered source images. */
  readonly images: readonly TeacherQuestionDocumentImageUpload[]
}

/** Per-student options for class Office generation. */
export interface TeacherQuestionStudentDocumentOptions {
  /** Roster student whose assigned images should be rendered. */
  readonly studentId: TeacherStudentId
  /** Optional Word title for this student. */
  readonly title: string
  /** Whether this student's Word document prints their name. */
  readonly includeName: boolean
  /** Whether this student's Word document prints the current local date. */
  readonly includeDate: boolean
}

/** Generate one independent Office document per selected student. */
export interface TeacherQuestionBatchDocumentRequest {
  /** Output document family. */
  readonly kind: 'word' | 'ppt'
  /** Assigned images by default; temporary selections reproduce the legacy batch workflow. */
  readonly source?: 'assigned' | 'temporary'
  /** Students and their independent Word metadata choices. */
  readonly students: readonly TeacherQuestionStudentDocumentOptions[]
}

/** Downloadable generated artifact. */
export interface TeacherQuestionDocumentPayload {
  /** Safe suggested download name. */
  readonly fileName: string
  /** Browser download media type. */
  readonly mediaType: string
  /** Canonical base64 artifact bytes. */
  readonly contentBase64: string
}

/** Successful document generation. */
export interface TeacherQuestionDocumentSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Generated artifact. */
  readonly value: TeacherQuestionDocumentPayload
}

/** Document generation result. */
export type TeacherQuestionDocumentResult = TeacherQuestionDocumentSuccess | TeacherQuestionRejected

/** One student skipped during class Office generation. */
export interface TeacherQuestionDocumentSkipped {
  /** Requested roster identity. */
  readonly studentId: TeacherStudentId
  /** Current roster display name when available. */
  readonly name: string
  /** User-safe reason for skipping this student. */
  readonly reason: string
}

/** Successful class Office generation. */
export interface TeacherQuestionBatchDocumentSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Independent artifacts and students that could not be generated. */
  readonly value: {
    readonly artifacts: readonly TeacherQuestionDocumentPayload[]
    readonly skipped: readonly TeacherQuestionDocumentSkipped[]
  }
}

/** Class Office generation result. */
export type TeacherQuestionBatchDocumentResult = TeacherQuestionBatchDocumentSuccess | TeacherQuestionRejected
