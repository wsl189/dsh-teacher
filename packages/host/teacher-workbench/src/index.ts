/**
 * Durable Remote service for the teacher workbench.
 * @module @deepseek-ai/dsh-host-teacher-workbench
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import {
  teacherWorkbenchDomainSpec,
  teacherWorkbenchStateSchema,
} from './spec.ts'
import {
  DEFAULT_WEATHER_GEOCODING_CACHE_ENTRIES,
  DEFAULT_WEATHER_GEOCODING_ENDPOINT,
  TeacherWeatherProvider,
} from './weather.ts'
import {
  deleteQuestionBatchFiles,
  deleteQuestionImageFile,
  generateQuestionDocument,
  generateStudentDocuments as generateStudentOfficeDocuments,
  generateUploadedQuestionDocument,
  listTemporaryQuestionSelections,
  persistQuestionAssignments,
  persistQuestionBatch,
  prepareDurableQuestionDirectoryRename,
  prepareDurableQuestionLibraryDirectoryDelete,
  prepareQuestionStateDirectories,
  readQuestionImage,
  replaceQuestionImage,
  saveTemporaryQuestionSelection,
  TeacherQuestionMediaError,
  type PersistedTemporaryQuestionSelection,
  type TeacherQuestionMediaConfig,
} from './question-media.ts'
import {
  discoverQuestionMedia,
  discoveredQuestionTargetKey,
  readDiscoveredQuestionFile,
  type DiscoveredQuestionFile,
} from './question-media-browser.ts'
import {
  createDiscoveredQuestionDirectory,
  deleteDiscoveredQuestionDirectory,
  discoveredQuestionDirectoryTargetKey,
  renameDiscoveredQuestionDirectory,
  resolveDiscoveredQuestionDirectory,
  type DiscoveredQuestionDirectory,
} from './question-media-directories.ts'
import { normalizeTimetableWithAgent } from './timetable-agent.ts'
import { segmentQuestionsInBatches } from './question-segmentation-batches.ts'
import { registerQuestionSegmentationSkill } from './question-segmentation-skill.ts'
import {
  listScheduledReminderTasks,
  listMobileNotificationTargets,
  TeacherReminderRuntime,
  type ReminderOccurrence,
  type TeacherScheduledReminderTask,
} from './mobile-reminders.ts'
import {
  stageWorkbenchSource,
  TeacherWorkbenchSourceError,
  type TeacherWorkbenchSourceConfig,
} from './source-documents.ts'
import type {
  TeacherNotificationTarget,
  TeacherQuestionAssignRequest,
  TeacherQuestionBatchId,
  TeacherQuestionBatchDeleteRequest,
  TeacherQuestionBatchDocumentRequest,
  TeacherQuestionBatchDocumentResult,
  TeacherQuestionBatchSaveRequest,
  TeacherQuestionDocumentRequest,
  TeacherQuestionDocumentResult,
  TeacherQuestionImageDeleteRequest,
  TeacherQuestionMediaBrowseRequest,
  TeacherQuestionMediaBrowseResult,
  TeacherQuestionImageReadRequest,
  TeacherQuestionImageReadResult,
  TeacherQuestionImageReplaceRequest,
  TeacherQuestionImageTarget,
  TeacherQuestionMediaDirectoryCreateRequest,
  TeacherQuestionMediaDirectoryDeleteRequest,
  TeacherQuestionMediaDirectoryRenameRequest,
  TeacherQuestionMutationResult,
  TeacherQuestionRejected,
  TeacherQuestionSegmentRequest,
  TeacherQuestionSegmentResult,
  TeacherQuestionTemporaryListRequest,
  TeacherQuestionTemporaryListResult,
  TeacherQuestionTemporarySaveRequest,
  TeacherQuestionTemporarySaveResult,
  TeacherQuestionUploadedDocumentRequest,
  TeacherTimetableNormalizeRequest,
  TeacherTimetableNormalizeResult,
  TeacherWorkbenchDocument,
  TeacherWorkbenchInvalidState,
  TeacherWorkbenchReadRequest,
  TeacherWorkbenchReadResult,
  TeacherWorkbenchRevisionConflict,
  TeacherWorkbenchState,
  TeacherWorkbenchSourceStageRequest,
  TeacherWorkbenchSourceStageResult,
  TeacherWorkbenchWriteRequest,
  TeacherWorkbenchWriteResult,
  TeacherWeatherRequest,
  TeacherWeatherResult,
} from './types.ts'

const TEACHER_WORKBENCH_SETTINGS_NAMESPACE = settingsNamespace('teacher-workbench')
const DEFAULT_QUESTION_IMAGE_BYTES = 25 * 1024 * 1024
const DEFAULT_QUESTION_BATCH_BYTES = 96 * 1024 * 1024
const DEFAULT_TIMETABLE_SOURCE_CHARACTERS = 500_000
const DEFAULT_TIMETABLE_ENTRIES = 1_000
const DEFAULT_TIMETABLE_AGENT_TIMEOUT_MS = 60 * 60 * 1000
const DEFAULT_TIMETABLE_VISION_AGENT_TIMEOUT_MS = 60 * 60 * 1000
const DEFAULT_QUESTION_LAYOUT_PAGES = 50
const DEFAULT_QUESTION_SEGMENTATION_BATCH_PAGES = 20
const DEFAULT_QUESTION_LAYOUT_ELEMENTS = 5_000
const DEFAULT_QUESTION_SOURCE_CHUNK_CHARACTERS = 18_000
const DEFAULT_SEGMENTED_QUESTIONS = 300
const DEFAULT_QUESTION_BOUNDARY_SUBMISSIONS = 5
const DEFAULT_QUESTION_SEGMENTATION_AGENT_TIMEOUT_MS = 60 * 60 * 1000
const DEFAULT_SOURCE_DOCUMENT_BYTES = 100 * 1024 * 1024
const DEFAULT_REMINDER_RETRY_MS = 60_000

export type * from './types.ts'
export { registerTeacherWorkbenchTools } from './agent-tools.ts'
export {
  INITIAL_TEACHER_WORKBENCH_DOCUMENT,
  INITIAL_TEACHER_WORKBENCH_STATE,
  teacherCalendarItemSchema,
  teacherClassSchema,
  teacherDailyTodoSchema,
  teacherExamSchema,
  teacherLessonResourceSchema,
  teacherLedgerCategorySchema,
  teacherLedgerEntrySchema,
  teacherNoticeSchema,
  teacherNoticeTemplateSchema,
  teacherQuickNoteSchema,
  teacherQuestionFolderSchema,
  teacherQuestionLibraryFolderSchema,
  teacherRecordSchema,
  teacherRecordTemplateSchema,
  teacherSeatingLayoutSchema,
  teacherWorkbenchDocumentSchema,
  teacherWorkbenchDomainSpec,
  teacherWorkbenchStateSchema,
  teacherStudentSchema,
  teacherTimetableEntrySchema,
} from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable teacher-workbench Remote service. */
    teacherWorkbench: TeacherWorkbenchService
  }
}

/** Host persistence, document-source, question-media, and provider configuration. */
export interface Config {
  /** Delay before retrying a mobile reminder after an unavailable or rejected delivery. */
  reminderRetryMs?: number
  /** Nominatim-compatible endpoint used to resolve districts, counties, and cities. */
  geocodingEndpoint: string
  /** Maximum number of resolved location queries cached in memory. */
  geocodingCacheEntries: number
  /** Root containing durable question-library directories and direct cropped-image files. */
  segmentsRoot: string
  /** Root containing grade/class/student assignment copies. */
  studentsRoot: string
  /** Root containing content-addressed documents uploaded through conversation. */
  sourcesRoot: string
  /** Root receiving documents generated by agent workbench tools. */
  generatedRoot: string
  /** Maximum decoded bytes retained for one uploaded source document. */
  maxSourceDocumentBytes: number
  /** Maximum decoded bytes accepted for one question image. */
  maxQuestionImageBytes: number
  /** Maximum decoded bytes accepted for one automatically saved part. */
  maxQuestionBatchBytes: number
  /** Maximum MinerU characters admitted to one timetable-agent prompt. */
  maxTimetableSourceCharacters: number
  /** Maximum structured rows accepted from one timetable-agent run. */
  maxTimetableEntries: number
  /** Wall-clock deadline for one timetable-agent run. */
  timetableAgentTimeoutMs: number
  /** Wall-clock deadline for one direct-vision timetable-agent run. */
  timetableVisionAgentTimeoutMs: number
  /** Maximum selected PDF pages admitted to one question-segmentation agent run. */
  maxQuestionLayoutPages: number
  /** Selected PDF pages owned by one automatic question-segmentation group. */
  questionSegmentationBatchPages: number
  /** Maximum OCR elements admitted to one question-segmentation agent run. */
  maxQuestionLayoutElements: number
  /** Maximum serialized OCR characters returned by one question-layout tool call. */
  maxQuestionSourceChunkCharacters: number
  /** Maximum questions accepted from one question-segmentation agent run. */
  maxSegmentedQuestions: number
  /** Maximum complete boundary drafts admitted to one question-segmentation agent run. */
  maxQuestionBoundarySubmissions: number
  /** Wall-clock deadline for one question-segmentation agent run. */
  questionSegmentationAgentTimeoutMs: number
}

/** Host service owning the revisioned workbench document. */
export class TeacherWorkbenchService extends TypertRemoteService {
  static inject = ['storageDomain']
  static Config: z<Config> = z.object({
    geocodingEndpoint: z.string().pattern(/^https?:\/\/.+/u).default(DEFAULT_WEATHER_GEOCODING_ENDPOINT),
    geocodingCacheEntries: z.natural().min(1).max(4_096).default(DEFAULT_WEATHER_GEOCODING_CACHE_ENTRIES),
    segmentsRoot: z.string().default(''),
    studentsRoot: z.string().default(''),
    sourcesRoot: z.string().default(''),
    generatedRoot: z.string().default(''),
    maxSourceDocumentBytes: z.natural().min(1_024).max(2 * 1024 * 1024 * 1024).default(DEFAULT_SOURCE_DOCUMENT_BYTES),
    maxQuestionImageBytes: z.natural().min(1_024).max(200 * 1024 * 1024).default(DEFAULT_QUESTION_IMAGE_BYTES),
    maxQuestionBatchBytes: z.natural().min(1_024).max(2 * 1024 * 1024 * 1024).default(DEFAULT_QUESTION_BATCH_BYTES),
    maxTimetableSourceCharacters: z.natural().min(1_000).max(1_000_000).default(DEFAULT_TIMETABLE_SOURCE_CHARACTERS),
    maxTimetableEntries: z.natural().min(1).max(10_000).default(DEFAULT_TIMETABLE_ENTRIES),
    timetableAgentTimeoutMs: z.natural().min(1_000).max(3_600_000).default(DEFAULT_TIMETABLE_AGENT_TIMEOUT_MS),
    timetableVisionAgentTimeoutMs: z.natural().min(1_000).max(3_600_000).default(DEFAULT_TIMETABLE_VISION_AGENT_TIMEOUT_MS),
    maxQuestionLayoutPages: z.natural().min(1).max(1_000).default(DEFAULT_QUESTION_LAYOUT_PAGES),
    questionSegmentationBatchPages: z.natural().min(1).max(998).default(DEFAULT_QUESTION_SEGMENTATION_BATCH_PAGES),
    maxQuestionLayoutElements: z.natural().min(1).max(100_000).default(DEFAULT_QUESTION_LAYOUT_ELEMENTS),
    maxQuestionSourceChunkCharacters: z.natural().min(4_000).max(100_000)
      .default(DEFAULT_QUESTION_SOURCE_CHUNK_CHARACTERS),
    maxSegmentedQuestions: z.natural().min(1).max(10_000).default(DEFAULT_SEGMENTED_QUESTIONS),
    maxQuestionBoundarySubmissions: z.natural().min(1).max(20).default(DEFAULT_QUESTION_BOUNDARY_SUBMISSIONS),
    questionSegmentationAgentTimeoutMs: z.natural().min(1_000).max(3_600_000)
      .default(DEFAULT_QUESTION_SEGMENTATION_AGENT_TIMEOUT_MS),
    reminderRetryMs: z.natural().min(1_000).max(3_600_000).default(DEFAULT_REMINDER_RETRY_MS),
  })

  private global?: DomainGlobal<TeacherWorkbenchDocument>
  private operationTail: Promise<void> = Promise.resolve()
  private acceptingWrites = true
  private readonly weatherProvider: TeacherWeatherProvider
  private readonly reminderRuntime: TeacherReminderRuntime
  private configSource: () => Config
  private discoveredQuestionFiles: ReadonlyMap<string, DiscoveredQuestionFile> = new Map()
  private discoveredQuestionDirectories: ReadonlyMap<string, DiscoveredQuestionDirectory> = new Map()

  /**
   * @param ctx - Host context carrying the storage-domain facility.
   * @param config - geocoding endpoint and cache policy.
   */
  constructor(ctx: Context, config: Config = {
    geocodingEndpoint: DEFAULT_WEATHER_GEOCODING_ENDPOINT,
    geocodingCacheEntries: DEFAULT_WEATHER_GEOCODING_CACHE_ENTRIES,
    segmentsRoot: '',
    studentsRoot: '',
    sourcesRoot: '',
    generatedRoot: '',
    maxSourceDocumentBytes: DEFAULT_SOURCE_DOCUMENT_BYTES,
    maxQuestionImageBytes: DEFAULT_QUESTION_IMAGE_BYTES,
    maxQuestionBatchBytes: DEFAULT_QUESTION_BATCH_BYTES,
    maxTimetableSourceCharacters: DEFAULT_TIMETABLE_SOURCE_CHARACTERS,
    maxTimetableEntries: DEFAULT_TIMETABLE_ENTRIES,
    timetableAgentTimeoutMs: DEFAULT_TIMETABLE_AGENT_TIMEOUT_MS,
    timetableVisionAgentTimeoutMs: DEFAULT_TIMETABLE_VISION_AGENT_TIMEOUT_MS,
    maxQuestionLayoutPages: DEFAULT_QUESTION_LAYOUT_PAGES,
    questionSegmentationBatchPages: DEFAULT_QUESTION_SEGMENTATION_BATCH_PAGES,
    maxQuestionLayoutElements: DEFAULT_QUESTION_LAYOUT_ELEMENTS,
    maxQuestionSourceChunkCharacters: DEFAULT_QUESTION_SOURCE_CHUNK_CHARACTERS,
    maxSegmentedQuestions: DEFAULT_SEGMENTED_QUESTIONS,
    maxQuestionBoundarySubmissions: DEFAULT_QUESTION_BOUNDARY_SUBMISSIONS,
    questionSegmentationAgentTimeoutMs: DEFAULT_QUESTION_SEGMENTATION_AGENT_TIMEOUT_MS,
    reminderRetryMs: DEFAULT_REMINDER_RETRY_MS,
  }) {
    super(ctx, 'teacherWorkbench')
    this.weatherProvider = new TeacherWeatherProvider(config)
    this.configSource = () => config
    this.reminderRuntime = new TeacherReminderRuntime(
      ctx,
      () => this.requireGlobal().get().state,
      occurrence => this.markReminderDelivered(occurrence),
      config.reminderRetryMs ?? DEFAULT_REMINDER_RETRY_MS,
    )
    installSettingsSection(ctx, TEACHER_WORKBENCH_SETTINGS_NAMESPACE, TeacherWorkbenchService.Config, config, {
      setSource: (source) => { this.configSource = source },
      onChange: () => {},
    })
    registerQuestionSegmentationSkill(ctx)
  }

  /** Open and own the durable singleton. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(teacherWorkbenchDomainSpec)
    this.ctx.effect(() => async () => {
      await this.reminderRuntime.dispose()
      this.acceptingWrites = false
      await this.operationTail
      await domain.close()
    }, 'teacher-workbench.domainClose')
    this.global = domain.global
    this.reminderRuntime.requestDrive()
  }

  /**
   * Read the current immutable workbench document.
   * @param _request - Empty request object retained for a uniform Remote signature.
   * @returns the current revision and state.
   */
  @Remote('read')
  read(_request: TeacherWorkbenchReadRequest): Promise<TeacherWorkbenchReadResult> {
    return Promise.resolve(success(snapshotDocument(this.requireGlobal().get())))
  }

  /**
   * List dsh-im bots that may receive reminder notifications.
   * @param _request - Empty request object retained for a uniform Remote signature.
   * @returns Credential-free platform and bot identities with live connection state.
   */
  @Remote('listNotificationTargets')
  listNotificationTargets(_request: Record<never, never>): Promise<readonly TeacherNotificationTarget[]> {
    return listMobileNotificationTargets(this.ctx)
  }

  /**
   * Project active workbench reminders for an optional shared scheduled-task list.
   * @returns Credential-free task rows derived from the current durable document.
   */
  listScheduledReminders(): readonly TeacherScheduledReminderTask[] {
    return listScheduledReminderTasks(this.requireGlobal().get().state, Date.now())
  }

  /**
   * Replace the complete state after comparing the observed revision.
   * @param request - observed revision and replacement state.
   * @returns the committed document or an explicit conflict/validation failure.
   */
  @Remote('write')
  write(request: TeacherWorkbenchWriteRequest): Promise<TeacherWorkbenchWriteResult> {
    if (!this.acceptingWrites) {
      return Promise.reject(new Error('teacher-workbench: service is disposing'))
    }
    const operation = this.operationTail.then(async () => {
      const global = this.requireGlobal()
      const current = global.get()
      if (request.expectedRevision !== current.revision) {
        return rejected({ code: 'revision-conflict', current: snapshotDocument(current) })
      }
      const parsed = teacherWorkbenchStateSchema.safeParse(request.state)
      if (!parsed.success) {
        return rejected({
          code: 'invalid-state',
          message: parsed.error.issues.map(issue => issue.message).join('; '),
        })
      }
      const next = snapshotDocument({ revision: current.revision + 1, state: parsed.data })
      const preparedDirectories = await prepareQuestionStateDirectories(this.questionMediaConfig(), parsed.data)
      try {
        await global.set(next)
      } catch (error) {
        await preparedDirectories.rollback()
        throw error
      }
      this.discoveredQuestionFiles = new Map()
      this.discoveredQuestionDirectories = new Map()
      this.reminderRuntime.requestDrive()
      const retainedAssignments = new Set(parsed.data.questionAssignments.map(item => item.id))
      const removedAssignments = current.state.questionAssignments.filter(item => !retainedAssignments.has(item.id))
      await Promise.all(removedAssignments.map(async (assignment) => {
        await deleteQuestionImageFile(this.questionMediaConfig(), current.state, {
          kind: 'assignment',
          id: assignment.id,
        }).catch(() => {})
      }))
      return success(snapshotDocument(next))
    })
    this.operationTail = operation.then(() => {}, () => {})
    return operation
  }

  /**
   * Retain one browser-uploaded document for a later agent workbench operation.
   * @param request - original metadata and base64 bytes.
   * @returns a durable content-addressed source reference or stable failure.
   */
  @Remote('stageSource')
  async stageSource(request: TeacherWorkbenchSourceStageRequest): Promise<TeacherWorkbenchSourceStageResult> {
    try {
      return Object.freeze({ ok: true, value: await stageWorkbenchSource(this.sourceConfig(), request) })
    } catch (error) {
      const failure = error instanceof TeacherWorkbenchSourceError
        ? { code: error.code, message: error.message }
        : { code: 'storage-failure' as const, message: '无法保存工作台源文件' }
      return Object.freeze({ ok: false, error: Object.freeze(failure) })
    }
  }

  /**
   * Resolve a configured location and fetch validated weather from the Host.
   * @param request - district, county, or city selected in dsh settings.
   * @returns current conditions, twelve forecast hours, or a stable failure.
   */
  @Remote('weather')
  weather(request: TeacherWeatherRequest): Promise<TeacherWeatherResult> {
    return this.weatherProvider.fetch(request.location)
  }

  /**
   * Reconstruct MinerU timetable text through the configured tool model.
   * @param request - live parent session, OCR source, and current timetable defaults.
   * @returns structured rows for browser review or a stable failure.
   */
  @Remote('normalizeTimetable')
  normalizeTimetable(request: TeacherTimetableNormalizeRequest): Promise<TeacherTimetableNormalizeResult> {
    return normalizeTimetableWithAgent(this.ctx, request, this.configSource())
  }

  /**
   * Detect complete top-level question boundaries through the configured tool model.
   * @param request - live parent session, selected OCR pages, and crop padding.
   * @returns validated source-page crop regions or a stable failure.
   */
  @Remote('segmentQuestions')
  segmentQuestions(request: TeacherQuestionSegmentRequest): Promise<TeacherQuestionSegmentResult> {
    return segmentQuestionsInBatches(this.ctx, request, this.configSource())
  }

  /**
   * Persist one browser-rendered paper-batch part and commit its metadata.
   * @param request - batch metadata and ordered raster payloads.
   * @returns the committed document and generated batch id, or a stable failure.
   */
  @Remote('saveQuestionBatch')
  saveQuestionBatch(request: TeacherQuestionBatchSaveRequest): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const current = this.requireGlobal().get()
      const existingBatch = request.appendToBatchId === undefined
        ? undefined
        : current.state.questionBatches.find(batch => batch.id === request.appendToBatchId)
      if (request.appendToBatchId !== undefined && existingBatch === undefined) {
        throw new TeacherQuestionMediaError('not-found', '待追加的试卷批次不存在')
      }
      const persisted = await persistQuestionBatch(
        this.questionMediaConfig(),
        current.state,
        request,
        Date.now(),
        existingBatch,
      )
      try {
        const document = await this.commitQuestionState(state => ({
          ...state,
          questionLibraryFolders: persisted.createdFolder === undefined
            ? state.questionLibraryFolders
            : [...state.questionLibraryFolders, persisted.createdFolder],
          questionBatches: existingBatch === undefined
            ? [...state.questionBatches, persisted.batch]
            : state.questionBatches.map(batch => batch.id === persisted.batch.id ? persisted.batch : batch),
        }))
        return questionMutationSuccess(document, persisted.batch.id)
      } catch (error) {
        await persisted.rollback()
        throw error
      }
    })
  }

  /**
   * Read one paper crop or student assignment copy.
   * @param request - exact metadata-backed image target.
   * @returns validated image bytes or a stable failure.
   */
  @Remote('readQuestionImage')
  async readQuestionImage(request: TeacherQuestionImageReadRequest): Promise<TeacherQuestionImageReadResult> {
    try {
      const config = this.questionMediaConfig()
      const discovered = this.discoveredQuestionFiles.get(discoveredQuestionTargetKey(request.target))
      return Object.freeze({
        ok: true,
        value: Object.freeze(discovered === undefined
          ? await readQuestionImage(config, this.requireGlobal().get().state, request.target)
          : await readDiscoveredQuestionFile(discovered, config.maxImageBytes)),
      })
    } catch (error) {
      return questionRejected(error)
    }
  }

  /**
   * Scan the currently configured batch and student roots for visible images.
   * @param _request - empty request retained for a uniform Remote signature.
   * @returns filesystem-backed collections or a stable storage failure.
   */
  @Remote('browseQuestionMedia')
  async browseQuestionMedia(_request: TeacherQuestionMediaBrowseRequest): Promise<TeacherQuestionMediaBrowseResult> {
    try {
      const discovered = await discoverQuestionMedia(this.questionMediaConfig(), this.requireGlobal().get().state)
      this.discoveredQuestionFiles = discovered.files
      this.discoveredQuestionDirectories = discovered.directories
      return Object.freeze({ ok: true, value: discovered.value })
    } catch (error) {
      return questionRejected(error)
    }
  }

  /**
   * Create one physical child directory selected through the current configured-root projection.
   * @param request - opaque scanned parent or question-library root and safe child name.
   * @returns the unchanged durable document or a stable failure.
   */
  @Remote('createQuestionMediaDirectory')
  createQuestionMediaDirectory(
    request: TeacherQuestionMediaDirectoryCreateRequest,
  ): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const current = this.requireGlobal().get()
      await createDiscoveredQuestionDirectory(
        this.questionMediaConfig(),
        this.discoveredQuestionDirectories,
        request,
      )
      this.discoveredQuestionDirectories = new Map()
      return questionMutationSuccess(current)
    })
  }

  /**
   * Delete one external directory or one durable question-library hierarchy.
   * @param request - opaque directory target from the latest scan or durable state.
   * @returns the committed or unchanged durable document, or a stable failure.
   */
  @Remote('deleteQuestionMediaDirectory')
  deleteQuestionMediaDirectory(
    request: TeacherQuestionMediaDirectoryDeleteRequest,
  ): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const current = this.requireGlobal().get()
      if (request.target.kind === 'library-folder'
        && current.state.questionLibraryFolders.some(folder => folder.id === request.target.id)) {
        const prepared = await prepareDurableQuestionLibraryDirectoryDelete(
          this.questionMediaConfig(),
          current.state,
          request.target.id,
        )
        let document: TeacherWorkbenchDocument
        try {
          document = await this.commitQuestionState(() => prepared.state)
        } catch (error) {
          await prepared.rollback()
          throw error
        }
        const retainedAssignments = new Set(prepared.state.questionAssignments.map(assignment => assignment.id))
        const removedAssignments = current.state.questionAssignments.filter(
          assignment => !retainedAssignments.has(assignment.id),
        )
        await prepared.commit().catch(() => {
          // The committed state remains valid when removing the detached residue fails.
        })
        await Promise.all(removedAssignments.map(async (assignment) => {
          await deleteQuestionImageFile(this.questionMediaConfig(), current.state, {
            kind: 'assignment',
            id: assignment.id,
          }).catch(() => {
            // The assignment is already absent from durable state, so an orphaned copy cannot be addressed again.
          })
        }))
        this.discoveredQuestionFiles = new Map()
        this.discoveredQuestionDirectories = new Map()
        return questionMutationSuccess(document)
      }
      const durableTarget = request.target.kind === 'student'
        ? current.state.students.some(student => student.id === request.target.id)
        : request.target.kind === 'student-folder'
          ? current.state.questionFolders.some(folder => folder.id === request.target.id)
          : false
      if (durableTarget) {
        throw new TeacherQuestionMediaError('invalid-request', '持久化学生目录必须通过工作台删除')
      }
      await deleteDiscoveredQuestionDirectory(
        this.questionMediaConfig(),
        this.discoveredQuestionDirectories,
        request,
      )
      this.discoveredQuestionFiles = new Map()
      this.discoveredQuestionDirectories = new Map()
      return questionMutationSuccess(current)
    })
  }

  /**
   * Rename one external, durable student, or durable question-library directory.
   * @param request - opaque directory target and safe replacement name.
   * @returns the committed or unchanged durable document, or a stable failure.
   */
  @Remote('renameQuestionMediaDirectory')
  renameQuestionMediaDirectory(
    request: TeacherQuestionMediaDirectoryRenameRequest,
  ): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const current = this.requireGlobal().get()
      const durableTarget = request.target.kind === 'student'
        ? current.state.students.some(student => student.id === request.target.id)
        : request.target.kind === 'student-folder'
          ? current.state.questionFolders.some(folder => folder.id === request.target.id)
          : current.state.questionLibraryFolders.some(folder => folder.id === request.target.id)
      if (!durableTarget) {
        await renameDiscoveredQuestionDirectory(
          this.questionMediaConfig(),
          this.discoveredQuestionDirectories,
          request,
        )
        this.discoveredQuestionFiles = new Map()
        this.discoveredQuestionDirectories = new Map()
        return questionMutationSuccess(current)
      }
      const discoveredDirectory = this.discoveredQuestionDirectories.get(
        discoveredQuestionDirectoryTargetKey(request.target),
      )
      const physicalDirectory = discoveredDirectory === undefined
        ? undefined
        : await resolveDiscoveredQuestionDirectory(
          this.questionMediaConfig(),
          this.discoveredQuestionDirectories,
          request.target,
        )
      const prepared = await prepareDurableQuestionDirectoryRename(
        this.questionMediaConfig(),
        current.state,
        request,
        Date.now(),
        physicalDirectory,
      )
      try {
        const document = await this.commitQuestionState(() => prepared.state)
        this.discoveredQuestionFiles = new Map()
        this.discoveredQuestionDirectories = new Map()
        return questionMutationSuccess(document)
      } catch (error) {
        await prepared.rollback()
        throw error
      }
    })
  }

  /**
   * Replace one stored raster after browser-side editing.
   * @param request - exact target plus replacement raster payload.
   * @returns the committed document or a stable failure.
   */
  @Remote('replaceQuestionImage')
  replaceQuestionImage(request: TeacherQuestionImageReplaceRequest): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const current = this.requireGlobal().get()
      const persisted = await replaceQuestionImage(this.questionMediaConfig(), current.state, request.target, request)
      try {
        const document = await this.commitQuestionState(state => updateQuestionImageMetadata(
          state,
          request.target,
          persisted.image.width,
          persisted.image.height,
          Date.now(),
        ))
        return questionMutationSuccess(document)
      } catch (error) {
        await persisted.rollback()
        throw error
      }
    })
  }

  /**
   * Delete one paper crop or independent student copy.
   * @param request - exact image target to remove.
   * @returns the committed document or a stable failure.
   */
  @Remote('deleteQuestionImage')
  deleteQuestionImage(request: TeacherQuestionImageDeleteRequest): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const current = this.requireGlobal().get()
      assertQuestionTarget(current.state, request.target)
      const assignmentCopies = request.target.kind === 'batch'
        ? current.state.questionAssignments.filter(item => item.sourceImageId === request.target.id)
        : []
      const document = await this.commitQuestionState(state => removeQuestionTarget(state, request.target))
      await deleteQuestionImageFile(this.questionMediaConfig(), current.state, request.target).catch(() => {})
      await Promise.all(assignmentCopies.map(async (assignment) => {
        await deleteQuestionImageFile(this.questionMediaConfig(), current.state, {
          kind: 'assignment',
          id: assignment.id,
        }).catch(() => {})
      }))
      return questionMutationSuccess(document)
    })
  }

  /**
   * Delete one complete paper batch and every assignment derived from it.
   * @param request - durable batch identity to remove.
   * @returns the committed document or a stable failure.
   */
  @Remote('deleteQuestionBatch')
  deleteQuestionBatch(request: TeacherQuestionBatchDeleteRequest): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const current = this.requireGlobal().get()
      const batch = current.state.questionBatches.find(item => item.id === request.batchId)
      if (batch === undefined) throw new TeacherQuestionMediaError('not-found', '试卷批次不存在')
      const imageIds = new Set(batch.images.map(image => image.id))
      const assignmentCopies = current.state.questionAssignments.filter(item => imageIds.has(item.sourceImageId))
      const document = await this.commitQuestionState(state => ({
        ...state,
        questionBatches: state.questionBatches.filter(item => item.id !== request.batchId),
        questionAssignments: state.questionAssignments.filter(item => !imageIds.has(item.sourceImageId)),
      }))
      await deleteQuestionBatchFiles(this.questionMediaConfig(), current.state, request.batchId).catch(() => {})
      await Promise.all(assignmentCopies.map(async (assignment) => {
        await deleteQuestionImageFile(this.questionMediaConfig(), current.state, {
          kind: 'assignment',
          id: assignment.id,
        }).catch(() => {})
      }))
      return questionMutationSuccess(document)
    })
  }

  /**
   * Copy selected paper crops into one student's durable image collection.
   * @param request - destination student and ordered source image ids.
   * @returns the committed document or a stable failure.
   */
  @Remote('assignQuestions')
  assignQuestions(request: TeacherQuestionAssignRequest): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      if (request.imageIds.length === 0) throw new TeacherQuestionMediaError('invalid-request', '请至少选择一道试题')
      const current = this.requireGlobal().get()
      const student = current.state.students.find(item => item.id === request.studentId)
      if (student === undefined) throw new TeacherQuestionMediaError('not-found', '学生不存在')
      const requested = new Set(request.imageIds)
      if (requested.size !== request.imageIds.length) throw new TeacherQuestionMediaError('invalid-request', '试题选择存在重复项')
      const sourceImages = current.state.questionBatches.flatMap(batch => batch.images).filter(image => requested.has(image.id))
      if (sourceImages.length !== requested.size) throw new TeacherQuestionMediaError('not-found', '部分切题图片不存在')
      const ordered = request.imageIds.map((id) => {
        const image = sourceImages.find(candidate => candidate.id === id)
        if (image === undefined) throw new TeacherQuestionMediaError('not-found', '切题图片不存在')
        return image
      })
      const persisted = await persistQuestionAssignments(
        this.questionMediaConfig(), current.state, student, ordered, Date.now(), request.folderId,
      )
      try {
        const document = await this.commitQuestionState(state => ({
          ...state,
          questionAssignments: [...state.questionAssignments, ...persisted.assignments],
        }))
        return questionMutationSuccess(document)
      } catch (error) {
        await persisted.rollback()
        throw error
      }
    })
  }

  /**
   * Snapshot selected student images into temporary Office-generation storage.
   * @param request - student identity and ordered assignment ids.
   * @returns copied-image count or a stable failure.
   */
  @Remote('saveTemporaryQuestionSelection')
  saveTemporaryQuestionSelection(
    request: TeacherQuestionTemporarySaveRequest,
  ): Promise<TeacherQuestionTemporarySaveResult> {
    if (!this.acceptingWrites) return Promise.reject(new Error('teacher-workbench: service is disposing'))
    const operation = this.operationTail.then(async (): Promise<TeacherQuestionTemporarySaveResult> => {
      const current = this.requireGlobal().get()
      let persisted: PersistedTemporaryQuestionSelection | undefined
      try {
        const savedAt = Date.now()
        persisted = await saveTemporaryQuestionSelection(this.questionMediaConfig(), current.state, request)
        const selected = new Set(request.assignmentIds)
        const document = await this.commitQuestionState(state => ({
          ...state,
          questionAssignments: state.questionAssignments.map((assignment) => {
            if (!selected.has(assignment.id)) return assignment
            return {
              ...assignment,
              temporarySaveCount: assignment.temporarySaveCount + 1,
              lastTemporarySavedAt: savedAt,
            }
          }),
        }))
        await persisted.commit().catch(() => {
          // Backup cleanup is best-effort after the document and active selection have committed.
        })
        return Object.freeze({
          ok: true,
          value: Object.freeze({ ...persisted.selection, document: snapshotDocument(document) }),
        })
      } catch (error) {
        if (persisted !== undefined) {
          await persisted.rollback().catch(() => {
            // Preserve the operation failure when restoring the previous temporary selection also fails.
          })
        }
        return questionRejected(error)
      }
    })
    this.operationTail = operation.then(() => {}, () => {})
    return operation
  }

  /**
   * List roster students that currently have temporary Office-generation images.
   * @param request - student identities to inspect.
   * @returns available student selections or a stable failure.
   */
  @Remote('listTemporaryQuestionSelections')
  async listTemporaryQuestionSelections(
    request: TeacherQuestionTemporaryListRequest,
  ): Promise<TeacherQuestionTemporaryListResult> {
    try {
      return Object.freeze({
        ok: true,
        value: Object.freeze(await listTemporaryQuestionSelections(
          this.questionMediaConfig(),
          this.requireGlobal().get().state,
          request,
        )),
      })
    } catch (error) {
      return questionRejected(error)
    }
  }

  /**
   * Build one Word or PowerPoint artifact from selected stored images.
   * @param request - output family, optional Word metadata, and ordered image targets.
   * @returns a downloadable artifact or a stable failure.
   */
  @Remote('generateQuestionDocument')
  async generateQuestionDocument(request: TeacherQuestionDocumentRequest): Promise<TeacherQuestionDocumentResult> {
    try {
      return Object.freeze({
        ok: true,
        value: Object.freeze(await generateQuestionDocument(
          this.questionMediaConfig(),
          this.requireGlobal().get().state,
          request,
        )),
      })
    } catch (error) {
      return questionRejected(error)
    }
  }

  /**
   * Build one Word or PowerPoint file from a browser-selected image directory.
   * @param request - selected directory name, ordered images, and output family.
   * @returns a downloadable artifact or a stable failure.
   */
  @Remote('generateUploadedQuestionDocument')
  async generateUploadedQuestionDocument(
    request: TeacherQuestionUploadedDocumentRequest,
  ): Promise<TeacherQuestionDocumentResult> {
    try {
      return Object.freeze({
        ok: true,
        value: Object.freeze(await generateUploadedQuestionDocument(this.questionMediaConfig(), request)),
      })
    } catch (error) {
      return questionRejected(error)
    }
  }

  /**
   * Build one independent Word or PowerPoint file per selected student.
   * @param request - output family and independent per-student Word options.
   * @returns independent artifacts, skipped students, or a stable failure.
   */
  @Remote('generateStudentDocuments')
  async generateStudentDocuments(request: TeacherQuestionBatchDocumentRequest): Promise<TeacherQuestionBatchDocumentResult> {
    try {
      return Object.freeze({
        ok: true,
        value: Object.freeze(await generateStudentOfficeDocuments(
          this.questionMediaConfig(),
          this.requireGlobal().get().state,
          request,
        )),
      })
    } catch (error) {
      return questionRejected(error)
    }
  }

  private questionMediaConfig(): TeacherQuestionMediaConfig {
    const config = this.configSource()
    return {
      segmentsRoot: config.segmentsRoot,
      studentsRoot: config.studentsRoot,
      maxImageBytes: config.maxQuestionImageBytes,
      maxBatchBytes: config.maxQuestionBatchBytes,
    }
  }

  /**
   * Resolve storage policy at call time so settings changes affect later tool operations.
   * @returns the current source-document and generated-output policy.
   */
  sourceConfig(): TeacherWorkbenchSourceConfig {
    const config = this.configSource()
    return {
      sourcesRoot: config.sourcesRoot,
      generatedRoot: config.generatedRoot,
      maxSourceDocumentBytes: config.maxSourceDocumentBytes,
    }
  }

  /**
   * Resolve source-image limits for conversation-requested Office generation.
   * @returns current per-image and aggregate decoded-byte limits.
   */
  questionDocumentLimits(): { readonly maxImageBytes: number; readonly maxBatchBytes: number } {
    const config = this.configSource()
    return {
      maxImageBytes: config.maxQuestionImageBytes,
      maxBatchBytes: config.maxQuestionBatchBytes,
    }
  }

  private enqueueQuestionMutation(
    operation: () => Promise<TeacherQuestionMutationResult>,
  ): Promise<TeacherQuestionMutationResult> {
    if (!this.acceptingWrites) return Promise.reject(new Error('teacher-workbench: service is disposing'))
    const pending = this.operationTail.then(async () => {
      try {
        return await operation()
      } catch (error) {
        return questionRejected(error)
      }
    })
    this.operationTail = pending.then(() => {}, () => {})
    return pending
  }

  private async commitQuestionState(
    transform: (state: TeacherWorkbenchState) => TeacherWorkbenchState,
  ): Promise<TeacherWorkbenchDocument> {
    const global = this.requireGlobal()
    const current = global.get()
    const parsed = teacherWorkbenchStateSchema.safeParse(transform(current.state))
    if (!parsed.success) {
      throw new TeacherQuestionMediaError(
        'invalid-request',
        parsed.error.issues.map(issue => issue.message).join('; '),
      )
    }
    const next = snapshotDocument({ revision: current.revision + 1, state: parsed.data })
    await global.set(next)
    return next
  }

  /** Persist one accepted reminder occurrence without racing browser writes. */
  private markReminderDelivered(occurrence: ReminderOccurrence): Promise<void> {
    if (!this.acceptingWrites) return Promise.reject(new Error('teacher-workbench: service is disposing'))
    const operation = this.operationTail.then(async () => {
      const global = this.requireGlobal()
      const current = global.get()
      const rows = occurrence.owner === 'todo'
        ? current.state.dailyTodos
        : occurrence.owner === 'memo'
          ? current.state.quickNotes
          : occurrence.owner === 'ledger'
            ? current.state.ledgerEntries
            : current.state.calendarItems
      if (!rows.some(item => item.id === occurrence.id
        && item.reminder?.configuredAt === occurrence.reminder.configuredAt)) return
      const update = <T extends { readonly id: string; readonly reminder?: { readonly configuredAt: number } }>(item: T): T => {
        if (item.id !== occurrence.id
          || item.reminder === undefined
          || item.reminder.configuredAt !== occurrence.reminder.configuredAt) return item
        return {
          ...item,
          reminder: { ...occurrence.reminder, lastOccurrenceAt: occurrence.occurrenceAt },
        }
      }
      const state: TeacherWorkbenchState = occurrence.owner === 'todo'
        ? { ...current.state, dailyTodos: current.state.dailyTodos.map(update) }
        : occurrence.owner === 'memo'
          ? { ...current.state, quickNotes: current.state.quickNotes.map(update) }
          : occurrence.owner === 'ledger'
            ? { ...current.state, ledgerEntries: current.state.ledgerEntries.map(update) }
            : { ...current.state, calendarItems: current.state.calendarItems.map(update) }
      const parsed = teacherWorkbenchStateSchema.parse(state)
      await global.set(snapshotDocument({ revision: current.revision + 1, state: parsed }))
      this.reminderRuntime.requestDrive()
    })
    this.operationTail = operation.then(() => {}, () => {})
    return operation
  }

  private requireGlobal(): DomainGlobal<TeacherWorkbenchDocument> {
    if (this.global === undefined) throw new Error('teacher-workbench: service is not initialized')
    return this.global
  }
}

/** Copy and freeze a document before it crosses a service boundary. */
function snapshotDocument(document: TeacherWorkbenchDocument): TeacherWorkbenchDocument {
  return Object.freeze({
    revision: document.revision,
    state: snapshotState(document.state),
  })
}

/** Copy and freeze the nested workbench state. */
function snapshotState(state: TeacherWorkbenchState): TeacherWorkbenchState {
  return Object.freeze({
    dailyTodos: Object.freeze(state.dailyTodos.map(item => Object.freeze({
      ...item,
      ...(item.reminder === undefined ? {} : { reminder: snapshotReminder(item.reminder) }),
    }))),
    quickNotes: Object.freeze(state.quickNotes.map(item => Object.freeze({
      ...item,
      ...(item.reminder === undefined ? {} : { reminder: snapshotReminder(item.reminder) }),
    }))),
    ledgerCategories: Object.freeze(state.ledgerCategories.map(item => Object.freeze({ ...item }))),
    ledgerEntries: Object.freeze(state.ledgerEntries.map(item => Object.freeze({
      ...item,
      ...(item.reminder === undefined ? {} : { reminder: snapshotReminder(item.reminder) }),
    }))),
    calendarItems: Object.freeze(state.calendarItems.map(item => Object.freeze({
      ...item,
      ...(item.reminder === undefined ? {} : { reminder: snapshotReminder(item.reminder) }),
    }))),
    timetableEntries: Object.freeze(state.timetableEntries.map(item => Object.freeze({ ...item }))),
    classes: Object.freeze(state.classes.map(item => Object.freeze({ ...item }))),
    students: Object.freeze(state.students.map(item => Object.freeze({
      ...item,
      extras: Object.freeze({ ...item.extras }),
    }))),
    resources: Object.freeze(state.resources.map(item => Object.freeze({ ...item }))),
    templates: Object.freeze(state.templates.map(item => Object.freeze({
      ...item,
      fields: Object.freeze([...item.fields]),
    }))),
    records: Object.freeze(state.records.map(item => Object.freeze({
      ...item,
      values: Object.freeze({ ...item.values }),
    }))),
    noticeTemplates: Object.freeze(state.noticeTemplates.map(item => Object.freeze({ ...item }))),
    notices: Object.freeze(state.notices.map(item => Object.freeze({ ...item }))),
    seatingLayouts: Object.freeze(state.seatingLayouts.map(item => Object.freeze({
      ...item,
      slots: Object.freeze([...item.slots]),
    }))),
    exams: Object.freeze(state.exams.map(item => Object.freeze({
      ...item,
      entries: Object.freeze(item.entries.map(entry => Object.freeze({
        ...entry,
        scores: Object.freeze({ ...entry.scores }),
      }))),
    }))),
    questionBatches: Object.freeze(state.questionBatches.map(batch => Object.freeze({
      ...batch,
      images: Object.freeze(batch.images.map(image => Object.freeze({ ...image }))),
    }))),
    questionLibraryFolders: Object.freeze(state.questionLibraryFolders.map(item => Object.freeze({ ...item }))),
    questionFolders: Object.freeze(state.questionFolders.map(item => Object.freeze({ ...item }))),
    questionAssignments: Object.freeze(state.questionAssignments.map(item => Object.freeze({ ...item }))),
  })
}

function snapshotReminder<T extends { readonly rule: object }>(reminder: T): T {
  return Object.freeze({ ...reminder, rule: Object.freeze({ ...reminder.rule }) })
}

function updateQuestionImageMetadata(
  state: TeacherWorkbenchState,
  target: TeacherQuestionImageTarget,
  width: number,
  height: number,
  updatedAt: number,
): TeacherWorkbenchState {
  assertQuestionTarget(state, target)
  if (target.kind === 'assignment') {
    return {
      ...state,
      questionAssignments: state.questionAssignments.map(item => item.id === target.id
        ? { ...item, width, height, updatedAt }
        : item),
    }
  }
  return {
    ...state,
    questionBatches: state.questionBatches.map(batch => ({
      ...batch,
      images: batch.images.map(image => image.id === target.id
        ? { ...image, width, height, updatedAt }
        : image),
    })),
  }
}

function removeQuestionTarget(
  state: TeacherWorkbenchState,
  target: TeacherQuestionImageTarget,
): TeacherWorkbenchState {
  if (target.kind === 'assignment') {
    return {
      ...state,
      questionAssignments: state.questionAssignments.filter(item => item.id !== target.id),
    }
  }
  return {
    ...state,
    questionBatches: state.questionBatches.map(batch => ({
      ...batch,
      images: batch.images.filter(image => image.id !== target.id),
    })).filter(batch => batch.images.length > 0),
    questionAssignments: state.questionAssignments.filter(item => item.sourceImageId !== target.id),
  }
}

function assertQuestionTarget(state: TeacherWorkbenchState, target: TeacherQuestionImageTarget): void {
  const exists = target.kind === 'batch'
    ? state.questionBatches.some(batch => batch.images.some(image => image.id === target.id))
    : state.questionAssignments.some(item => item.id === target.id)
  if (!exists) throw new TeacherQuestionMediaError('not-found', '试题图片不存在')
}

function questionMutationSuccess(
  document: TeacherWorkbenchDocument,
  batchId?: TeacherQuestionBatchId,
): TeacherQuestionMutationResult {
  return Object.freeze({
    ok: true,
    value: Object.freeze({ document: snapshotDocument(document), ...(batchId === undefined ? {} : { batchId }) }),
  })
}

function questionRejected(error: unknown): TeacherQuestionRejected {
  const failure = error instanceof TeacherQuestionMediaError
    ? { code: error.code, message: error.message }
    : { code: 'storage-failure' as const, message: '试题工作区操作失败' }
  return Object.freeze({ ok: false, error: Object.freeze(failure) })
}

function success(value: TeacherWorkbenchDocument): TeacherWorkbenchReadResult {
  return Object.freeze({ ok: true, value })
}

function rejected(
  error: TeacherWorkbenchRevisionConflict | TeacherWorkbenchInvalidState,
): TeacherWorkbenchWriteResult {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

export default TeacherWorkbenchService
