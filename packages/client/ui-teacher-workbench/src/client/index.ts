/**
 * Teacher-workbench browser plugin: sidebar disclosure, full teaching surface,
 * durable object layer, and feature-owned dsh settings row.
 * @module @deepseek-ai/dsh-client-ui-teacher-workbench/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  QUESTION_CUTTING_SETTINGS_NAMESPACE,
  TEACHER_WORKBENCH_SETTINGS_NAMESPACE,
  type QuestionCuttingSettings,
  type TeacherWorkbenchSettings,
} from '../settings.ts'
import { TeacherWorkbenchController } from './controller.ts'
import { QuestionCuttingController } from './question-cutting-controller.ts'
import type { TeacherWorkbenchInjected, TeacherWorkbenchSettingsInjected } from './contracts.ts'
import { bytesToBase64, extractWorkbenchDocument, extractWorkbenchLayout } from './extract-document.ts'
import { fetchTeacherWeather } from './weather.ts'
import { createTeacherWorkbenchViewStore } from './view-store.ts'
import { SidebarWorkbench } from './SidebarWorkbench.tsx'
import { WorkbenchSurface } from './WorkbenchSurface.tsx'
import { TeacherWorkbenchSettingsRow } from './TeacherWorkbenchSettingsRow.tsx'
import { en, zh, type TeacherWorkbenchKey } from './locales.ts'

export type {
  TeacherCalendarImportInput,
  TeacherCalendarItemInput,
  TeacherClassInput,
  TeacherDailyTodoInput,
  TeacherExamInput,
  TeacherLessonResourceInput,
  TeacherLedgerCategoryInput,
  TeacherLedgerEntryInput,
  TeacherNoticeInput,
  TeacherNoticeTemplateInput,
  TeacherRecordInput,
  TeacherRecordTemplateInput,
  TeacherQuickNoteInput,
  TeacherSeatingLayoutInput,
  TeacherStudentInput,
  TeacherTimetableEntryInput,
  TeacherTimetableImportInput,
  TeacherWorkbenchActionResult,
  TeacherWorkbenchControllerOptions,
  TeacherWorkbenchRemote,
  TeacherWorkbenchSnapshot,
} from './controller.ts'
export { TeacherWorkbenchController } from './controller.ts'
export type { TeacherWorkbenchCommands, TeacherWorkbenchInjected, TeacherWorkbenchSettingsInjected } from './contracts.ts'
export type { TeacherWorkbenchKey } from './locales.ts'
export type { TeacherWorkbenchModule, TeacherWorkbenchViewState } from './view-store.ts'
export type { SidebarWorkbenchProps } from './SidebarWorkbench.tsx'
export type { WorkbenchSurfaceProps } from './WorkbenchSurface.tsx'
export type { TeacherWorkbenchSettingsRowProps } from './TeacherWorkbenchSettingsRow.tsx'
export type { QuestionWorkbenchProps } from './QuestionWorkbench.tsx'
export type {
  QuestionCuttingEnqueueRequest,
  QuestionCuttingFailureCode,
  QuestionCuttingJob,
  QuestionCuttingStage,
  QuestionCuttingView,
} from './question-cutting-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Teacher-workbench feature copy. */
    teacherWorkbench: TeacherWorkbenchKey
  }
}

/** Dictionary namespace owned by the feature. */
const NS = 'teacherWorkbench'

/** Services required by the browser plugin. */
export const inject = [
  'slots', 'locale', 'connection', 'remote', 'remote.ocr', 'remote.speech', 'remote.teacherWorkbench', 'sessions', 'settingsScope',
]

/**
 * Register the sidebar entry, main surface, and settings row.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-teacher-workbench: dictionaries')
  const settings = ctx.settingsScope.bind<TeacherWorkbenchSettings>({
    namespace: TEACHER_WORKBENCH_SETTINGS_NAMESPACE,
  })
  const questionCuttingSettings = ctx.settingsScope.bind<QuestionCuttingSettings>({
    namespace: QUESTION_CUTTING_SETTINGS_NAMESPACE,
  })
  const controller = new TeacherWorkbenchController(ctx.remote.teacherWorkbench)
  const questionCutting = new QuestionCuttingController({
    extractLayout: (file, pageIndexes, renderScale, progress) => (
      extractWorkbenchLayout(file, ctx.remote.ocr, pageIndexes, renderScale, progress)
    ),
    resolveSegmentation: () => {
      const parentSessionId = ctx.sessions.list.getSnapshot().current
      if (parentSessionId === undefined) return undefined
      return (layout, padding, pagePreviews, corePageIndexes) => ctx.remote.teacherWorkbench.segmentQuestions({
        parentSessionId,
        fileName: layout.name,
        pages: layout.pages,
        corePageIndexes,
        pagePreviews,
        padding,
      }).then(carried => carried.ok
        ? carried.value
        : {
          ok: false as const,
          error: { code: 'tool-model-unavailable' as const, message: carried.error.message },
        })
        .catch((error: unknown) => ({
          ok: false as const,
          error: {
            code: 'tool-model-unavailable' as const,
            message: error instanceof Error ? error.message : String(error),
          },
        }))
    },
    resolveCropReview: () => {
      const parentSessionId = ctx.sessions.list.getSnapshot().current
      if (parentSessionId === undefined) return undefined
      return request => ctx.remote.teacherWorkbench.reviewQuestionCrops({
        ...request,
        parentSessionId,
      }).then(carried => carried.ok
        ? carried.value
        : {
          ok: false as const,
          error: { code: 'tool-model-unavailable' as const, message: carried.error.message },
        })
        .catch((error: unknown) => ({
          ok: false as const,
          error: {
            code: 'tool-model-unavailable' as const,
            message: error instanceof Error ? error.message : String(error),
          },
        }))
    },
    saveBatch: request => controller.saveQuestionBatch(request),
  })
  const viewStore = createTeacherWorkbenchViewStore()

  ctx.effect(() => async () => {
    await questionCutting.dispose()
    controller.dispose()
  }, 'ui-teacher-workbench: object layer and question-cutting queue')
  ctx.on('connection/reset', () => {
    if (controller.getSnapshot().status !== 'cold') void controller.resync()
  })

  const surfaceInjected = (): TeacherWorkbenchInjected => ({
    hooks: { workbench: controller, teacherSettings: settings, questionCuttingSettings, questionCutting },
    ensure: () => controller.refresh(),
    subscribeSessionNavigation: listener => ctx.on('sessions/navigate', () => { listener() }),
    setTeacherName: name => settings.set('teacherName', name),
    setWeatherLocation: location => settings.set('weatherLocation', location),
    setQuestionCuttingReasoningEnabled: enabled => (
      questionCuttingSettings.set('questionSegmentationReasoningEnabled', enabled)
    ),
    loadWeather: (location, signal) => fetchTeacherWeather(location, ctx.remote.teacherWorkbench, signal),
    listNotificationTargets: () => controller.listNotificationTargets(),
    transcribeVoice: async (audio) => {
      const carried = await ctx.remote.speech.transcribe({
        mediaType: audio.type,
        contentBase64: bytesToBase64(new Uint8Array(await audio.arrayBuffer())),
      })
      if (!carried.ok) throw speechRemoteError('provider-failure', carried.error.message)
      if (!carried.value.ok) throw speechRemoteError(carried.value.error.code, carried.value.error.message)
      return carried.value.value.text
    },
    saveDailyTodo: input => controller.saveDailyTodo(input),
    toggleDailyTodo: id => controller.toggleDailyTodo(id),
    deleteDailyTodo: id => controller.deleteDailyTodo(id),
    saveQuickNote: input => controller.saveQuickNote(input),
    deleteQuickNote: id => controller.deleteQuickNote(id),
    saveLedgerCategory: input => controller.saveLedgerCategory(input),
    deleteLedgerCategory: id => controller.deleteLedgerCategory(id),
    saveLedgerEntry: input => controller.saveLedgerEntry(input),
    deleteLedgerEntry: id => controller.deleteLedgerEntry(id),
    saveCalendarItem: input => controller.saveCalendarItem(input),
    deleteCalendarItem: id => controller.deleteCalendarItem(id),
    extractDocument: (file, options) => extractWorkbenchDocument(file, ctx.remote.ocr, options),
    normalizeTimetable: async (fileName, markdown, defaults, image) => {
      const parentSessionId = ctx.sessions.list.getSnapshot().current
      return parentSessionId === undefined
        ? Promise.resolve({
          ok: false as const,
          error: { code: 'session-unavailable' as const, message: 'no current session' },
        })
        : ctx.remote.teacherWorkbench.normalizeTimetable({
          parentSessionId,
          fileName,
          markdown,
          defaults,
          ...(image === undefined ? {} : {
            image: {
              mediaType: image.type as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
              contentBase64: bytesToBase64(new Uint8Array(await image.arrayBuffer())),
            },
          }),
        })
          .then(carried => carried.ok
            ? carried.value
            : {
              ok: false as const,
              error: { code: 'tool-model-unavailable' as const, message: carried.error.message },
            })
          .catch((error: unknown) => ({
            ok: false as const,
            error: {
              code: 'tool-model-unavailable' as const,
              message: error instanceof Error ? error.message : String(error),
            },
          }))
    },
    enqueueQuestionCutting: (request) => { questionCutting.enqueue(request) },
    importCalendarItems: inputs => controller.importCalendarItems(inputs),
    saveTimetableEntry: input => controller.saveTimetableEntry(input),
    deleteTimetableEntry: id => controller.deleteTimetableEntry(id),
    importTimetableEntries: inputs => controller.importTimetableEntries(inputs),
    saveClass: input => controller.saveClass(input),
    deleteClass: id => controller.deleteClass(id),
    saveStudent: input => controller.saveStudent(input),
    importStudents: (classId, rows) => controller.importStudents(classId, rows),
    deleteStudent: id => controller.deleteStudent(id),
    createQuestionFolder: input => controller.createQuestionFolder(input),
    createQuestionLibraryFolder: input => controller.createQuestionLibraryFolder(input),
    renameQuestionLibraryFolder: (id, name) => controller.renameQuestionLibraryFolder(id, name),
    deleteQuestionLibraryFolder: id => controller.deleteQuestionLibraryFolder(id),
    deleteQuestionFolder: id => controller.deleteQuestionFolder(id),
    saveResource: input => controller.saveResource(input),
    deleteResource: id => controller.deleteResource(id),
    saveTemplate: input => controller.saveTemplate(input),
    deleteTemplate: id => controller.deleteTemplate(id),
    saveRecord: input => controller.saveRecord(input),
    toggleRecord: id => controller.toggleRecord(id),
    deleteRecord: id => controller.deleteRecord(id),
    saveNoticeTemplate: input => controller.saveNoticeTemplate(input),
    deleteNoticeTemplate: id => controller.deleteNoticeTemplate(id),
    saveNotice: input => controller.saveNotice(input),
    deleteNotice: id => controller.deleteNotice(id),
    saveSeatingLayout: input => controller.saveSeatingLayout(input),
    saveExam: input => controller.saveExam(input),
    deleteExam: id => controller.deleteExam(id),
    saveQuestionBatch: request => controller.saveQuestionBatch(request),
    readQuestionImage: request => controller.readQuestionImage(request),
    browseQuestionMedia: () => controller.browseQuestionMedia(),
    createQuestionMediaDirectory: request => controller.createQuestionMediaDirectory(request),
    deleteQuestionMediaDirectory: request => controller.deleteQuestionMediaDirectory(request),
    renameQuestionMediaDirectory: request => controller.renameQuestionMediaDirectory(request),
    replaceQuestionImage: request => controller.replaceQuestionImage(request),
    deleteQuestionImage: request => controller.deleteQuestionImage(request),
    deleteQuestionBatch: request => controller.deleteQuestionBatch(request),
    assignQuestions: request => controller.assignQuestions(request),
    saveTemporaryQuestionSelection: request => controller.saveTemporaryQuestionSelection(request),
    listTemporaryQuestionSelections: request => controller.listTemporaryQuestionSelections(request),
    generateQuestionDocument: request => controller.generateQuestionDocument(request),
    generateUploadedQuestionDocument: request => controller.generateUploadedQuestionDocument(request),
    generateStudentDocuments: request => controller.generateStudentDocuments(request),
  })
  const settingsInjected = (): TeacherWorkbenchSettingsInjected => ({
    hooks: { teacherSettings: settings },
    setSetting: (field, value) => settings.set(field, value),
  })

  ctx.slots.inject('sidebar.primary.section', () => ctx.slots.register({
    name: 'sidebar.primary.section',
    id: 'teacher-workbench',
    order: 10,
    locale: NS,
    store: viewStore,
  }, SidebarWorkbench))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'teacher-workbench',
    order: 20,
    locale: NS,
    store: viewStore,
    inject: surfaceInjected,
  }, WorkbenchSurface))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'teacher-workbench',
    order: 45,
    locale: NS,
    inject: settingsInjected,
  }, TeacherWorkbenchSettingsRow))
}

function speechRemoteError(code: string, message: string): Error {
  const error = new Error(message)
  error.name = code
  return error
}
