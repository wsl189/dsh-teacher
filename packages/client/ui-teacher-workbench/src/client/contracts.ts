/** Component-facing workbench contracts. */

import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  OcrExtractResult,
  OcrLayoutRequest,
  OcrLayoutResult,
  TeacherCalendarItemId,
  TeacherClassId,
  TeacherDailyTodoId,
  TeacherExamId,
  TeacherLessonResourceId,
  TeacherLedgerCategoryId,
  TeacherLedgerEntryId,
  TeacherRecordId,
  TeacherRecordTemplateId,
  TeacherQuickNoteId,
  TeacherQuestionAssignRequest,
  TeacherQuestionBatchDeleteRequest,
  TeacherQuestionBatchDocumentRequest,
  TeacherQuestionBatchDocumentResult,
  TeacherQuestionBatchSaveRequest,
  TeacherQuestionDocumentRequest,
  TeacherQuestionDocumentResult,
  TeacherQuestionImageDeleteRequest,
  TeacherQuestionImageReadRequest,
  TeacherQuestionImageReadResult,
  TeacherQuestionImageReplaceRequest,
  TeacherQuestionFolderId,
  TeacherQuestionTemporaryListRequest,
  TeacherQuestionTemporaryListResult,
  TeacherQuestionTemporarySaveRequest,
  TeacherQuestionTemporarySaveResult,
  TeacherQuestionUploadedDocumentRequest,
  TeacherStudentId,
  TeacherTimetableEntryId,
  TeacherTimetableNormalizeDefaults,
  TeacherTimetableNormalizeResult,
  TeacherWeatherForecast,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type {
  TeacherCalendarImportInput,
  TeacherCalendarItemInput,
  TeacherClassInput,
  TeacherDailyTodoInput,
  TeacherExamInput,
  TeacherLessonResourceInput,
  TeacherLedgerCategoryInput,
  TeacherLedgerEntryInput,
  TeacherRecordInput,
  TeacherRecordTemplateInput,
  TeacherQuickNoteInput,
  TeacherQuestionFolderInput,
  TeacherStudentInput,
  TeacherTimetableEntryInput,
  TeacherTimetableImportInput,
  TeacherWorkbenchActionResult,
  TeacherWorkbenchSnapshot,
} from './controller.ts'
import type { StudentImportRow } from './import-data.ts'
import type { TeacherWorkbenchExtractOptions } from './extract-document.ts'

/** Semantic commands available to the workbench modules. */
export interface TeacherWorkbenchCommands {
  /** Save a daily task. */
  saveDailyTodo: (input: TeacherDailyTodoInput) => Promise<TeacherWorkbenchActionResult>
  /** Toggle a daily task's completion state. */
  toggleDailyTodo: (id: TeacherDailyTodoId) => Promise<TeacherWorkbenchActionResult>
  /** Delete a daily task. */
  deleteDailyTodo: (id: TeacherDailyTodoId) => Promise<TeacherWorkbenchActionResult>
  /** Save a quick note. */
  saveQuickNote: (input: TeacherQuickNoteInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete a quick note. */
  deleteQuickNote: (id: TeacherQuickNoteId) => Promise<TeacherWorkbenchActionResult>
  /** Save a ledger category. */
  saveLedgerCategory: (input: TeacherLedgerCategoryInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete a ledger category and its entries. */
  deleteLedgerCategory: (id: TeacherLedgerCategoryId) => Promise<TeacherWorkbenchActionResult>
  /** Save a ledger entry. */
  saveLedgerEntry: (input: TeacherLedgerEntryInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete a ledger entry. */
  deleteLedgerEntry: (id: TeacherLedgerEntryId) => Promise<TeacherWorkbenchActionResult>
  /** Save a calendar item. */
  saveCalendarItem: (input: TeacherCalendarItemInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete a calendar item. */
  deleteCalendarItem: (id: TeacherCalendarItemId) => Promise<TeacherWorkbenchActionResult>
  /** Extract an uploaded document through the shared Host OCR runtime. */
  extractDocument: (file: File, options?: TeacherWorkbenchExtractOptions) => Promise<OcrExtractResult>
  /** Reconstruct OCR timetable text through the configured tool model. */
  normalizeTimetable: (
    fileName: string,
    markdown: string,
    defaults: TeacherTimetableNormalizeDefaults,
    image?: File,
  ) => Promise<TeacherTimetableNormalizeResult>
  /** Extract page geometry for deterministic question cutting. */
  extractQuestionLayout: (file: File, pageRange?: OcrLayoutRequest['pageRange']) => Promise<OcrLayoutResult>
  /** Persist reviewed school-calendar rows in one write. */
  importCalendarItems: (inputs: readonly TeacherCalendarImportInput[]) => Promise<TeacherWorkbenchActionResult>
  /** Save one durable timetable entry. */
  saveTimetableEntry: (input: TeacherTimetableEntryInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete one durable timetable entry. */
  deleteTimetableEntry: (id: TeacherTimetableEntryId) => Promise<TeacherWorkbenchActionResult>
  /** Persist reviewed timetable rows in one write. */
  importTimetableEntries: (inputs: readonly TeacherTimetableImportInput[]) => Promise<TeacherWorkbenchActionResult>
  /** Save a class. */
  saveClass: (input: TeacherClassInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete a class and its owned roster data. */
  deleteClass: (id: TeacherClassId) => Promise<TeacherWorkbenchActionResult>
  /** Save a student. */
  saveStudent: (input: TeacherStudentInput) => Promise<TeacherWorkbenchActionResult>
  /** Merge imported roster rows. */
  importStudents: (classId: TeacherClassId, rows: readonly StudentImportRow[]) => Promise<TeacherWorkbenchActionResult>
  /** Delete a student. */
  deleteStudent: (id: TeacherStudentId) => Promise<TeacherWorkbenchActionResult>
  /** Create one nested directory below a student or another question folder. */
  createQuestionFolder: (input: TeacherQuestionFolderInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete one nested question directory and all descendants. */
  deleteQuestionFolder: (id: TeacherQuestionFolderId) => Promise<TeacherWorkbenchActionResult>
  /** Save a lesson-preparation resource. */
  saveResource: (input: TeacherLessonResourceInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete a lesson-preparation resource. */
  deleteResource: (id: TeacherLessonResourceId) => Promise<TeacherWorkbenchActionResult>
  /** Save an observation or teaching-record template. */
  saveTemplate: (input: TeacherRecordTemplateInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete a template and its records. */
  deleteTemplate: (id: TeacherRecordTemplateId) => Promise<TeacherWorkbenchActionResult>
  /** Save a teaching record. */
  saveRecord: (input: TeacherRecordInput) => Promise<TeacherWorkbenchActionResult>
  /** Toggle a teaching record's status. */
  toggleRecord: (id: TeacherRecordId) => Promise<TeacherWorkbenchActionResult>
  /** Delete a teaching record. */
  deleteRecord: (id: TeacherRecordId) => Promise<TeacherWorkbenchActionResult>
  /** Save an imported exam. */
  saveExam: (input: TeacherExamInput) => Promise<TeacherWorkbenchActionResult>
  /** Delete an exam. */
  deleteExam: (id: TeacherExamId) => Promise<TeacherWorkbenchActionResult>
  /** Persist one rendered paper batch. */
  saveQuestionBatch: (request: TeacherQuestionBatchSaveRequest) => Promise<TeacherWorkbenchActionResult>
  /** Read one question raster. */
  readQuestionImage: (request: TeacherQuestionImageReadRequest) => Promise<TeacherQuestionImageReadResult>
  /** Replace one browser-edited question raster. */
  replaceQuestionImage: (request: TeacherQuestionImageReplaceRequest) => Promise<TeacherWorkbenchActionResult>
  /** Delete one question raster. */
  deleteQuestionImage: (request: TeacherQuestionImageDeleteRequest) => Promise<TeacherWorkbenchActionResult>
  /** Delete one complete paper batch. */
  deleteQuestionBatch: (request: TeacherQuestionBatchDeleteRequest) => Promise<TeacherWorkbenchActionResult>
  /** Copy selected batch images to one student. */
  assignQuestions: (request: TeacherQuestionAssignRequest) => Promise<TeacherWorkbenchActionResult>
  /** Snapshot selected student images for temporary Word/PPT generation. */
  saveTemporaryQuestionSelection: (request: TeacherQuestionTemporarySaveRequest) => Promise<TeacherQuestionTemporarySaveResult>
  /** List students with temporary Word/PPT images. */
  listTemporaryQuestionSelections: (request: TeacherQuestionTemporaryListRequest) => Promise<TeacherQuestionTemporaryListResult>
  /** Generate one Word or PowerPoint file. */
  generateQuestionDocument: (request: TeacherQuestionDocumentRequest) => Promise<TeacherQuestionDocumentResult>
  /** Generate one Word or PowerPoint file from a browser-selected image directory. */
  generateUploadedQuestionDocument: (request: TeacherQuestionUploadedDocumentRequest) => Promise<TeacherQuestionDocumentResult>
  /** Generate one independent Office file per selected student. */
  generateStudentDocuments: (request: TeacherQuestionBatchDocumentRequest) => Promise<TeacherQuestionBatchDocumentResult>
}

/** Registration-side inject face for the full workbench surface. */
export interface TeacherWorkbenchInjected extends TeacherWorkbenchCommands {
  hooks: {
    /** Durable workbench object-layer snapshot. */
    workbench: HostObservable<TeacherWorkbenchSnapshot>
    /** Durable teacher identity and analysis settings. */
    teacherSettings: SettingsScope<TeacherWorkbenchSettings>
  }
  /** Load or retry the durable document. */
  ensure: () => Promise<TeacherWorkbenchActionResult>
  /** Close the workbench when explicit Session navigation takes over the main area. */
  subscribeSessionNavigation: (listener: () => void) => () => void
  /** Persist the teacher-name filter in the feature settings scope. */
  setTeacherName: (name: string) => Promise<void>
  /** Persist the weather location query in the feature settings scope. */
  setWeatherLocation: (location: string) => Promise<void>
  /** Load validated weather through the DSH Host. */
  loadWeather: (location: string, signal?: AbortSignal) => Promise<TeacherWeatherForecast>
}

/** Registration-side inject face for the settings row. */
export interface TeacherWorkbenchSettingsInjected {
  hooks: {
    /** Durable teacher-workbench settings scope. */
    teacherSettings: SettingsScope<TeacherWorkbenchSettings>
  }
  /** Persist one scalar setting field. */
  setSetting: (field: keyof TeacherWorkbenchSettings, value: string | number) => Promise<void>
}
