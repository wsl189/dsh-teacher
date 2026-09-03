/**
 * Durable Remote service for the teacher workbench.
 * @module @deepseek-ai/dsh-host-teacher-workbench
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { relative } from 'node:path'
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
  deleteQuestionFile,
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
  replaceQuestionImageFile,
  saveTemporaryQuestionSelection,
  TeacherQuestionMediaError,
  type PersistedTemporaryQuestionSelection,
  type TeacherQuestionMediaConfig,
} from './question-media.ts'
import {
  discoverQuestionMedia,
  discoveredQuestionTargetKey,
  persistDiscoveredQuestionCopies,
  readDiscoveredQuestionFile,
  resolveDiscoveredQuestionFile,
  type DiscoveredQuestionFile,
  type DiscoveredQuestionMedia,
} from './question-media-browser.ts'
import {
  createDiscoveredQuestionDirectory,
  deleteDiscoveredQuestionDirectory,
  discoveredQuestionDirectoryTargetKey,
  prepareDiscoveredQuestionDirectoryDelete,
  renameDiscoveredQuestionDirectory,
  resolveDiscoveredQuestionDirectory,
  type DiscoveredQuestionDirectory,
} from './question-media-directories.ts'
import { normalizeTimetableWithAgent } from './timetable-agent.ts'
import { segmentQuestionsInBatches } from './question-segmentation-batches.ts'
import { reviewQuestionCropsWithAgent } from './question-segmentation-agent.ts'
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
  TeacherQuestionCropReviewRequest,
  TeacherQuestionCropReviewResult,
  TeacherQuestionDocumentRequest,
  TeacherQuestionDocumentResult,
  TeacherQuestionImageDeleteRequest,
  TeacherQuestionMediaBrowseRequest,
  TeacherQuestionMediaBrowseResult,
  TeacherQuestionMediaBrowseValue,
  TeacherQuestionImageReadRequest,
  TeacherQuestionImageReadResult,
  TeacherQuestionImageReplaceRequest,
  TeacherQuestionImageTarget,
  TeacherQuestionLibraryFolderId,
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
const DEFAULT_QUESTION_SEGMENTATION_BATCH_CANDIDATES = 300
const DEFAULT_QUESTION_SEGMENTATION_CONCURRENCY = 2
const DEFAULT_MAX_QUESTION_WIDTH_OUTLIER_EXCESS_RATIO = 0.5
const DEFAULT_QUESTION_LAYOUT_ELEMENTS = 5_000
const DEFAULT_QUESTION_SOURCE_CHUNK_CHARACTERS = 14_000
const DEFAULT_QUESTION_COMPACT_BOUNDARY_CHARACTERS = 24_000
const DEFAULT_QUESTION_SEGMENTATION_INLINE_EVIDENCE = true
const DEFAULT_QUESTION_COMPACT_BOUNDARY_OUTPUT_TOKENS = 32_768
const DEFAULT_QUESTION_COMPACT_REVIEW_OUTPUT_TOKENS = 32_768
const DEFAULT_SEGMENTED_QUESTIONS = 300
const DEFAULT_QUESTION_BOUNDARY_SUBMISSIONS = 5
const DEFAULT_QUESTION_BOUNDARY_AGENT_RUNS = 2
const DEFAULT_QUESTION_REJECTED_TOOL_CALLS = 3
const DEFAULT_QUESTION_AUTO_OWNED_GAP_RATIO = 0.18
const DEFAULT_MIN_QUESTION_REPEATED_IMAGE_PAGES = 3
const DEFAULT_QUESTION_REPEATED_IMAGE_POSITION_TOLERANCE_RATIO = 0.015
const DEFAULT_QUESTION_RECUT_ATTEMPTS = 2
const DEFAULT_QUESTION_VISION_IMAGES_PER_TOOL_CALL = 20
const DEFAULT_QUESTION_SEGMENTATION_REASONING_ENABLED = false
const DEFAULT_QUESTION_SEGMENTATION_AGENT_TIMEOUT_MS = 0
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
  /** Maximum fallible question-head candidates owned by one automatic question-segmentation group. */
  questionSegmentationBatchCandidates: number
  /** Maximum independently owned question groups processed at once. */
  questionSegmentationConcurrency: number
  /** Maximum proportional excess above the median question width before exclusion from shared-width selection. */
  maxQuestionWidthOutlierExcessRatio: number
  /** Maximum OCR elements admitted to one question-segmentation agent run. */
  maxQuestionLayoutElements: number
  /** Maximum serialized OCR characters returned by one question-layout tool call. */
  maxQuestionSourceChunkCharacters: number
  /** Maximum complete OCR characters placed directly in one compact boundary request. */
  maxQuestionCompactBoundaryCharacters: number
  /** Whether eligible OCR source and visual-review sheets travel directly in their respective child requests. */
  questionSegmentationInlineEvidence: boolean
  /** Maximum model output tokens for one compact OCR boundary child. */
  maxQuestionCompactBoundaryOutputTokens: number
  /** Maximum model output tokens for one compact visual review or repair child. */
  maxQuestionCompactReviewOutputTokens: number
  /** Maximum questions accepted from one question-segmentation agent run. */
  maxSegmentedQuestions: number
  /** Maximum complete boundary drafts admitted to one question-segmentation agent run. */
  maxQuestionBoundarySubmissions: number
  /** Maximum fresh child runs used to obtain one accepted result in each boundary or crop-review stage. */
  maxQuestionBoundaryAgentRuns: number
  /** Maximum identical rejected tool results admitted before one child is stopped and safe output is retained. */
  maxQuestionRejectedToolCalls: number
  /** Maximum page-height gap between automatically owned elements before explicit attachment is required. */
  maxQuestionAutoOwnedGapRatio: number
  /** Minimum distinct pages that establish a repeated-position image as page furniture. */
  minQuestionRepeatedImagePages: number
  /** Maximum normalized coordinate drift when matching repeated-position image furniture. */
  questionRepeatedImagePositionToleranceRatio: number
  /** Maximum visual review attempts before the latest safe regions are retained and marked unverified. */
  maxQuestionRecutAttempts: number
  /** Maximum page or crop images returned by one child-agent image-tool call. */
  maxQuestionVisionImagesPerToolCall: number
  /** Default reasoning choice for segmentation and review requests that omit an override. */
  questionSegmentationReasoningEnabled: boolean
  /** Wall-clock deadline for one question-segmentation agent run, or zero to disable it. */
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
    questionSegmentationBatchCandidates: z.natural().min(1).max(10_000)
      .default(DEFAULT_QUESTION_SEGMENTATION_BATCH_CANDIDATES),
    questionSegmentationConcurrency: z.natural().min(1).max(16)
      .default(DEFAULT_QUESTION_SEGMENTATION_CONCURRENCY),
    maxQuestionWidthOutlierExcessRatio: z.number().min(0).max(10)
      .default(DEFAULT_MAX_QUESTION_WIDTH_OUTLIER_EXCESS_RATIO),
    maxQuestionLayoutElements: z.natural().min(1).max(100_000).default(DEFAULT_QUESTION_LAYOUT_ELEMENTS),
    maxQuestionSourceChunkCharacters: z.natural().min(4_000).max(1_000_000)
      .default(DEFAULT_QUESTION_SOURCE_CHUNK_CHARACTERS),
    maxQuestionCompactBoundaryCharacters: z.natural().min(4_000).max(1_000_000)
      .default(DEFAULT_QUESTION_COMPACT_BOUNDARY_CHARACTERS),
    questionSegmentationInlineEvidence: z.boolean()
      .default(DEFAULT_QUESTION_SEGMENTATION_INLINE_EVIDENCE),
    maxQuestionCompactBoundaryOutputTokens: z.natural().min(256).max(32_768)
      .default(DEFAULT_QUESTION_COMPACT_BOUNDARY_OUTPUT_TOKENS),
    maxQuestionCompactReviewOutputTokens: z.natural().min(256).max(32_768)
      .default(DEFAULT_QUESTION_COMPACT_REVIEW_OUTPUT_TOKENS),
    maxSegmentedQuestions: z.natural().min(1).max(10_000).default(DEFAULT_SEGMENTED_QUESTIONS),
    maxQuestionBoundarySubmissions: z.natural().min(1).max(20).default(DEFAULT_QUESTION_BOUNDARY_SUBMISSIONS),
    maxQuestionBoundaryAgentRuns: z.natural().min(1).max(5).default(DEFAULT_QUESTION_BOUNDARY_AGENT_RUNS),
    maxQuestionRejectedToolCalls: z.natural().min(1).max(20)
      .default(DEFAULT_QUESTION_REJECTED_TOOL_CALLS),
    maxQuestionAutoOwnedGapRatio: z.number().min(0.01).max(1).default(DEFAULT_QUESTION_AUTO_OWNED_GAP_RATIO),
    minQuestionRepeatedImagePages: z.natural().min(2).max(1_000)
      .default(DEFAULT_MIN_QUESTION_REPEATED_IMAGE_PAGES),
    questionRepeatedImagePositionToleranceRatio: z.number().min(0).max(0.25)
      .default(DEFAULT_QUESTION_REPEATED_IMAGE_POSITION_TOLERANCE_RATIO),
    maxQuestionRecutAttempts: z.natural().min(1).max(5).default(DEFAULT_QUESTION_RECUT_ATTEMPTS),
    maxQuestionVisionImagesPerToolCall: z.natural().min(1).max(20)
      .default(DEFAULT_QUESTION_VISION_IMAGES_PER_TOOL_CALL),
    questionSegmentationReasoningEnabled: z.boolean()
      .default(DEFAULT_QUESTION_SEGMENTATION_REASONING_ENABLED),
    questionSegmentationAgentTimeoutMs: z.natural().max(3_600_000)
      .default(DEFAULT_QUESTION_SEGMENTATION_AGENT_TIMEOUT_MS),
    reminderRetryMs: z.natural().min(1_000).max(3_600_000).default(DEFAULT_REMINDER_RETRY_MS),
  })

  private global?: DomainGlobal<TeacherWorkbenchDocument>
  private operationTail: Promise<void> = Promise.resolve()
  private acceptingWrites = true
  private readonly weatherProvider: TeacherWeatherProvider
  private readonly reminderRuntime: TeacherReminderRuntime
  private configSource: () => Config
  private questionMediaSettingsRevision = 0
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
    questionSegmentationBatchCandidates: DEFAULT_QUESTION_SEGMENTATION_BATCH_CANDIDATES,
    questionSegmentationConcurrency: DEFAULT_QUESTION_SEGMENTATION_CONCURRENCY,
    maxQuestionWidthOutlierExcessRatio: DEFAULT_MAX_QUESTION_WIDTH_OUTLIER_EXCESS_RATIO,
    maxQuestionLayoutElements: DEFAULT_QUESTION_LAYOUT_ELEMENTS,
    maxQuestionSourceChunkCharacters: DEFAULT_QUESTION_SOURCE_CHUNK_CHARACTERS,
    maxQuestionCompactBoundaryCharacters: DEFAULT_QUESTION_COMPACT_BOUNDARY_CHARACTERS,
    questionSegmentationInlineEvidence: DEFAULT_QUESTION_SEGMENTATION_INLINE_EVIDENCE,
    maxQuestionCompactBoundaryOutputTokens: DEFAULT_QUESTION_COMPACT_BOUNDARY_OUTPUT_TOKENS,
    maxQuestionCompactReviewOutputTokens: DEFAULT_QUESTION_COMPACT_REVIEW_OUTPUT_TOKENS,
    maxSegmentedQuestions: DEFAULT_SEGMENTED_QUESTIONS,
    maxQuestionBoundarySubmissions: DEFAULT_QUESTION_BOUNDARY_SUBMISSIONS,
    maxQuestionBoundaryAgentRuns: DEFAULT_QUESTION_BOUNDARY_AGENT_RUNS,
    maxQuestionRejectedToolCalls: DEFAULT_QUESTION_REJECTED_TOOL_CALLS,
    maxQuestionAutoOwnedGapRatio: DEFAULT_QUESTION_AUTO_OWNED_GAP_RATIO,
    minQuestionRepeatedImagePages: DEFAULT_MIN_QUESTION_REPEATED_IMAGE_PAGES,
    questionRepeatedImagePositionToleranceRatio: DEFAULT_QUESTION_REPEATED_IMAGE_POSITION_TOLERANCE_RATIO,
    maxQuestionRecutAttempts: DEFAULT_QUESTION_RECUT_ATTEMPTS,
    maxQuestionVisionImagesPerToolCall: DEFAULT_QUESTION_VISION_IMAGES_PER_TOOL_CALL,
    questionSegmentationReasoningEnabled: DEFAULT_QUESTION_SEGMENTATION_REASONING_ENABLED,
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
      onChange: () => {
        this.questionMediaSettingsRevision += 1
        this.discoveredQuestionFiles = new Map()
        this.discoveredQuestionDirectories = new Map()
      },
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
      const questionMediaConfig = this.questionMediaConfig()
      const currentQuestionFiles = this.discoveredQuestionFiles
      const currentDirectories = this.discoveredQuestionDirectories
      const preparedDirectories = await prepareQuestionStateDirectories(
        questionMediaConfig,
        parsed.data,
        current.state,
        async (target) => {
          const directory = currentDirectories.get(discoveredQuestionDirectoryTargetKey(target))
          if (directory === undefined) return undefined
          await resolveDiscoveredQuestionDirectory(questionMediaConfig, currentDirectories, target)
          return relative(directory.root, directory.path)
        },
      )
      try {
        await global.set(next)
      } catch (error) {
        await preparedDirectories.rollback()
        throw error
      }
      this.reminderRuntime.requestDrive()
      const retainedAssignments = new Set(parsed.data.questionAssignments.map(item => item.id))
      const removedAssignments = current.state.questionAssignments.filter(item => !retainedAssignments.has(item.id))
      await Promise.all(removedAssignments.map(async (assignment) => {
        await deleteCurrentQuestionFileIfPresent(questionMediaConfig, currentQuestionFiles, {
          kind: 'assignment',
          id: assignment.id,
        }).catch(() => {
          // The durable relation has committed, so a failed current-root residue cleanup is best-effort.
        })
      }))
      this.discoveredQuestionFiles = new Map()
      this.discoveredQuestionDirectories = new Map()
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
   * @param request - live parent session, selected OCR pages, captured reasoning choice, and crop padding.
   * @returns validated source-page crop regions or a stable failure.
   */
  @Remote('segmentQuestions')
  segmentQuestions(request: TeacherQuestionSegmentRequest): Promise<TeacherQuestionSegmentResult> {
    return segmentQuestionsInBatches(this.ctx, request, this.questionSegmentationConfig(request.reasoningEnabled))
  }

  /**
   * Visually review preliminary question crops and correct one processing group when needed.
   * @param request - crop evidence, current group regions, and the same captured reasoning choice.
   * @returns accepted preliminary regions or one Host-validated corrected group.
   */
  @Remote('reviewQuestionCrops')
  reviewQuestionCrops(request: TeacherQuestionCropReviewRequest): Promise<TeacherQuestionCropReviewResult> {
    return reviewQuestionCropsWithAgent(this.ctx, request, this.questionSegmentationConfig(request.reasoningEnabled))
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
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current.state)
      const existingBatch = request.appendToBatchId === undefined
        ? undefined
        : current.state.questionBatches.find(batch => batch.id === request.appendToBatchId)
      if (request.appendToBatchId !== undefined && existingBatch === undefined) {
        throw new TeacherQuestionMediaError('not-found', '待追加的试卷批次不存在')
      }
      if (existingBatch !== undefined
        && !discovered.value.questionBatches.some(batch => batch.id === existingBatch.id)) {
        throw new TeacherQuestionMediaError('not-found', '待追加的试卷批次不在当前试题库目录中')
      }
      const adoptedFolders = request.destination.kind === 'library-folder'
        ? adoptCurrentQuestionLibraryFolder(current.state, discovered.value, request.destination.folderId)
        : []
      const persistenceState: TeacherWorkbenchState = adoptedFolders.length === 0
        ? current.state
        : {
          ...current.state,
          questionLibraryFolders: [...current.state.questionLibraryFolders, ...adoptedFolders],
        }
      const persisted = await persistQuestionBatch(
        config,
        persistenceState,
        request,
        Date.now(),
        existingBatch,
      )
      try {
        const document = await this.commitQuestionState(state => ({
          ...state,
          questionLibraryFolders: [
            ...state.questionLibraryFolders,
            ...adoptedFolders,
            ...(persisted.createdFolder === undefined ? [] : [persisted.createdFolder]),
          ],
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
          : await readDiscoveredQuestionFile(config, discovered, request.target)),
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
      const { discovered } = await this.discoverCurrentQuestionMedia(this.requireGlobal().get().state)
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
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current.state)
      await createDiscoveredQuestionDirectory(
        config,
        discovered.directories,
        request,
      )
      return questionMutationSuccess(current)
    })
  }

  /**
   * Delete one current-root directory and update matching durable relationships.
   * @param request - opaque directory target from the latest scan or durable state.
   * @returns the committed or unchanged durable document, or a stable failure.
   */
  @Remote('deleteQuestionMediaDirectory')
  deleteQuestionMediaDirectory(
    request: TeacherQuestionMediaDirectoryDeleteRequest,
  ): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const current = this.requireGlobal().get()
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current.state)
      await resolveDiscoveredQuestionDirectory(config, discovered.directories, request.target)
      if (request.target.kind === 'library-folder'
        && current.state.questionLibraryFolders.some(folder => folder.id === request.target.id)) {
        const prepared = await prepareDurableQuestionLibraryDirectoryDelete(
          config,
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
          await deleteCurrentQuestionFileIfPresent(config, discovered.files, {
            kind: 'assignment',
            id: assignment.id,
          }).catch(() => {
            // The assignment relation is committed as absent; current-root residue cleanup is best-effort.
          })
        }))
        this.discoveredQuestionFiles = new Map()
        return questionMutationSuccess(document)
      }
      const durableTarget = request.target.kind === 'student'
        ? current.state.students.some(student => student.id === request.target.id)
        : request.target.kind === 'student-folder'
          ? current.state.questionFolders.some(folder => folder.id === request.target.id)
          : request.target.kind === 'class'
            ? current.state.classes.some(item => item.id === request.target.id)
            : false
      if (request.target.kind !== 'library-folder' && durableTarget) {
        const target = request.target
        const prepared = await prepareDiscoveredQuestionDirectoryDelete(
          config,
          discovered.directories,
          request,
        )
        let document: TeacherWorkbenchDocument
        try {
          document = await this.commitQuestionState(state => removeQuestionDirectoryTarget(state, target))
        } catch (error) {
          await prepared.rollback()
          throw error
        }
        await prepared.commit().catch(() => {
          // The committed state remains valid when removing the detached residue fails.
        })
        this.discoveredQuestionFiles = new Map()
        return questionMutationSuccess(document)
      }
      await deleteDiscoveredQuestionDirectory(
        config,
        discovered.directories,
        request,
      )
      this.discoveredQuestionFiles = new Map()
      return questionMutationSuccess(current)
    })
  }

  /**
   * Rename one current-root directory and update matching durable metadata.
   * @param request - opaque directory target and safe replacement name.
   * @returns the committed or unchanged durable document, or a stable failure.
   */
  @Remote('renameQuestionMediaDirectory')
  renameQuestionMediaDirectory(
    request: TeacherQuestionMediaDirectoryRenameRequest,
  ): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const current = this.requireGlobal().get()
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current.state)
      const durableTarget = request.target.kind === 'class'
        ? current.state.classes.some(item => item.id === request.target.id)
        : request.target.kind === 'student'
          ? current.state.students.some(student => student.id === request.target.id)
          : request.target.kind === 'student-folder'
            ? current.state.questionFolders.some(folder => folder.id === request.target.id)
            : current.state.questionLibraryFolders.some(folder => folder.id === request.target.id)
      if (!durableTarget) {
        await renameDiscoveredQuestionDirectory(
          config,
          discovered.directories,
          request,
        )
        this.discoveredQuestionFiles = new Map()
        return questionMutationSuccess(current)
      }
      const physicalDirectory = await resolveDiscoveredQuestionDirectory(
        config,
        discovered.directories,
        request.target,
      )
      const prepared = await prepareDurableQuestionDirectoryRename(
        config,
        current.state,
        request,
        Date.now(),
        physicalDirectory,
      )
      try {
        const document = await this.commitQuestionState(() => prepared.state)
        this.discoveredQuestionFiles = new Map()
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
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current.state)
      const file = discovered.files.get(discoveredQuestionTargetKey(request.target))
      if (file === undefined) throw new TeacherQuestionMediaError('not-found', '试题图片不存在')
      const resolved = await resolveDiscoveredQuestionFile(config, file, request.target)
      const persisted = await replaceQuestionImageFile(config, resolved, request)
      const durableTarget = hasQuestionTarget(current.state, request.target)
      if (!durableTarget) {
        this.discoveredQuestionFiles = new Map()
        return questionMutationSuccess(current)
      }
      try {
        const document = await this.commitQuestionState(state => updateQuestionImageMetadata(
          state,
          request.target,
          persisted.image.width,
          persisted.image.height,
          Date.now(),
        ))
        this.discoveredQuestionFiles = new Map()
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
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current.state)
      const file = discovered.files.get(discoveredQuestionTargetKey(request.target))
      if (file === undefined) throw new TeacherQuestionMediaError('not-found', '试题图片不存在')
      const resolved = await resolveDiscoveredQuestionFile(config, file, request.target)
      if (!hasQuestionTarget(current.state, request.target)) {
        await deleteQuestionFile(resolved)
        this.discoveredQuestionFiles = new Map()
        return questionMutationSuccess(current)
      }
      const assignmentCopies = request.target.kind === 'batch'
        ? current.state.questionAssignments.filter(item => item.sourceImageId === request.target.id)
        : []
      const document = await this.commitQuestionState(state => removeQuestionTarget(state, request.target))
      await deleteQuestionFile(resolved).catch(() => {
        // The image relation is committed as absent; current-root residue cleanup is best-effort.
      })
      await Promise.all(assignmentCopies.map(async (assignment) => {
        await deleteCurrentQuestionFileIfPresent(config, discovered.files, {
          kind: 'assignment',
          id: assignment.id,
        }).catch(() => {
          // The assignment relation is committed as absent; current-root residue cleanup is best-effort.
        })
      }))
      this.discoveredQuestionFiles = new Map()
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
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current.state)
      const batch = discovered.value.questionBatches.find(item => item.id === request.batchId)
      if (batch === undefined) throw new TeacherQuestionMediaError('not-found', '试卷批次不存在')
      const durableBatch = current.state.questionBatches.find(item => item.id === request.batchId)
      if (durableBatch === undefined) {
        await Promise.all(batch.images.map(async (image) => {
          const target = { kind: 'batch' as const, id: image.id }
          const file = discovered.files.get(discoveredQuestionTargetKey(target))
          if (file === undefined) throw new TeacherQuestionMediaError('not-found', '切题图片已变化，请刷新后重试')
          await deleteQuestionFile(await resolveDiscoveredQuestionFile(config, file, target))
        }))
        this.discoveredQuestionFiles = new Map()
        return questionMutationSuccess(current)
      }
      const imageIds = new Set(batch.images.map(image => image.id))
      const assignmentCopies = current.state.questionAssignments.filter(item => imageIds.has(item.sourceImageId))
      const document = await this.commitQuestionState(state => ({
        ...state,
        questionBatches: state.questionBatches.filter(item => item.id !== request.batchId),
        questionAssignments: state.questionAssignments.filter(item => !imageIds.has(item.sourceImageId)),
      }))
      await Promise.all(batch.images.map(async (image) => {
        await deleteCurrentQuestionFileIfPresent(config, discovered.files, {
          kind: 'batch',
          id: image.id,
        }).catch(() => {
          // The batch relation is committed as absent; current-root residue cleanup is best-effort.
        })
      }))
      await Promise.all(assignmentCopies.map(async (assignment) => {
        await deleteCurrentQuestionFileIfPresent(config, discovered.files, {
          kind: 'assignment',
          id: assignment.id,
        }).catch(() => {
          // The assignment relation is committed as absent; current-root residue cleanup is best-effort.
        })
      }))
      this.discoveredQuestionFiles = new Map()
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
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current.state)
      const student = discovered.value.students.find(item => item.id === request.studentId)
      if (student === undefined) throw new TeacherQuestionMediaError('not-found', '学生不存在')
      if (request.folderId !== undefined && !discovered.value.questionFolders.some(
        folder => folder.id === request.folderId && folder.studentId === student.id,
      )) {
        throw new TeacherQuestionMediaError('not-found', '学生试题目录不存在')
      }
      const requested = new Set(request.imageIds)
      if (requested.size !== request.imageIds.length) throw new TeacherQuestionMediaError('invalid-request', '试题选择存在重复项')
      const sourceImages = discovered.value.questionBatches.flatMap(batch => batch.images).filter(
        image => requested.has(image.id),
      )
      if (sourceImages.length !== requested.size) throw new TeacherQuestionMediaError('not-found', '部分切题图片不存在')
      const ordered = request.imageIds.map((id) => {
        const image = sourceImages.find(candidate => candidate.id === id)
        if (image === undefined) throw new TeacherQuestionMediaError('not-found', '切题图片不存在')
        return image
      })
      const durableStudent = current.state.students.some(item => item.id === student.id)
      const durableFolder = request.folderId === undefined
        || current.state.questionFolders.some(folder => folder.id === request.folderId && folder.studentId === student.id)
      const durableImageIds = new Set(current.state.questionBatches.flatMap(batch => batch.images.map(image => image.id)))
      if (!durableStudent || !durableFolder || ordered.some(image => !durableImageIds.has(image.id))) {
        await persistDiscoveredQuestionCopies(
          config,
          discovered.files,
          discovered.directories,
          student.id,
          request.folderId,
          request.imageIds,
        )
        this.discoveredQuestionFiles = new Map()
        return questionMutationSuccess(current)
      }
      const destinationDirectory = await resolveDiscoveredQuestionDirectory(
        config,
        discovered.directories,
        request.folderId === undefined
          ? { kind: 'student', id: student.id }
          : { kind: 'student-folder', id: request.folderId },
      )
      const persisted = await persistQuestionAssignments(
        config, current.state, student, ordered, Date.now(), destinationDirectory, request.folderId,
      )
      try {
        const document = await this.commitQuestionState(state => ({
          ...state,
          questionAssignments: [...state.questionAssignments, ...persisted.assignments],
        }))
        this.discoveredQuestionFiles = new Map()
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
        const { config, discovered } = await this.discoverCurrentQuestionMedia(current.state)
        persisted = await saveTemporaryQuestionSelection(
          config,
          currentQuestionMediaState(current.state, discovered.value),
          request,
        )
        const durableAssignmentIds = new Set(current.state.questionAssignments.map(assignment => assignment.id))
        const selected = new Set(request.assignmentIds.filter(id => durableAssignmentIds.has(id)))
        const document = selected.size === 0
          ? current
          : await this.commitQuestionState(state => ({
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
      const current = this.requireGlobal().get().state
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current)
      return Object.freeze({
        ok: true,
        value: Object.freeze(await listTemporaryQuestionSelections(
          config,
          currentQuestionMediaState(current, discovered.value),
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
      const current = this.requireGlobal().get().state
      const { config, discovered } = await this.discoverCurrentQuestionMedia(current)
      return Object.freeze({
        ok: true,
        value: Object.freeze(await generateStudentOfficeDocuments(
          config,
          currentQuestionMediaState(current, discovered.value),
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

  private rememberQuestionMedia(discovered: DiscoveredQuestionMedia): void {
    this.discoveredQuestionFiles = discovered.files
    this.discoveredQuestionDirectories = discovered.directories
  }

  private async discoverCurrentQuestionMedia(
    state: TeacherWorkbenchState,
  ): Promise<{ readonly config: TeacherQuestionMediaConfig; readonly discovered: DiscoveredQuestionMedia }> {
    const settingsRevision = this.questionMediaSettingsRevision
    const config = this.questionMediaConfig()
    const discovered = await discoverQuestionMedia(config, state)
    if (settingsRevision !== this.questionMediaSettingsRevision) {
      throw new TeacherQuestionMediaError('storage-failure', '试题工作区目录设置已更改，请重试')
    }
    this.rememberQuestionMedia(discovered)
    return { config, discovered }
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

  private questionSegmentationConfig(reasoningEnabled: boolean | undefined): Config {
    const config = this.configSource()
    return {
      ...config,
      questionSegmentationReasoningEnabled: reasoningEnabled ?? config.questionSegmentationReasoningEnabled,
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

/** Overlay current configured-root question collections onto unrelated durable workbench data. */
function currentQuestionMediaState(
  state: TeacherWorkbenchState,
  media: TeacherQuestionMediaBrowseValue,
): TeacherWorkbenchState {
  return {
    ...state,
    classes: [...state.classes.filter(item => item.usage !== 'roster'), ...media.classes],
    students: media.students,
    questionBatches: media.questionBatches,
    questionLibraryFolders: media.questionLibraryFolders,
    questionFolders: media.questionFolders,
    questionAssignments: media.questionAssignments,
  }
}

function adoptCurrentQuestionLibraryFolder(
  state: TeacherWorkbenchState,
  media: TeacherQuestionMediaBrowseValue,
  folderId: TeacherQuestionLibraryFolderId,
): TeacherWorkbenchState['questionLibraryFolders'] {
  const byId = new Map(media.questionLibraryFolders.map(folder => [folder.id, folder] as const))
  const target = byId.get(folderId)
  if (target === undefined) throw new TeacherQuestionMediaError('not-found', '目标试题库目录不在当前设置的根目录中')
  if (media.questionLibraryFolders.some(folder => folder.parentId === target.id)) {
    throw new TeacherQuestionMediaError('invalid-request', '保存目录必须是末级目录')
  }
  const durableIds = new Set(state.questionLibraryFolders.map(folder => folder.id))
  const visited = new Set<TeacherQuestionLibraryFolderId>()
  const adopted: TeacherWorkbenchState['questionLibraryFolders'][number][] = []
  let current = target
  while (true) {
    if (visited.has(current.id)) throw new TeacherQuestionMediaError('invalid-request', '试题库目录存在循环关系')
    visited.add(current.id)
    if (!durableIds.has(current.id)) adopted.unshift(current)
    if (current.parentId === undefined) return adopted
    const parent = byId.get(current.parentId)
    if (parent === undefined) throw new TeacherQuestionMediaError('invalid-request', '试题库目录缺少上级目录')
    current = parent
  }
}

async function deleteCurrentQuestionFileIfPresent(
  config: TeacherQuestionMediaConfig,
  files: ReadonlyMap<string, DiscoveredQuestionFile>,
  target: TeacherQuestionImageTarget,
): Promise<void> {
  const file = files.get(discoveredQuestionTargetKey(target))
  if (file === undefined) return
  await deleteQuestionFile(await resolveDiscoveredQuestionFile(config, file, target))
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

function removeQuestionDirectoryTarget(
  state: TeacherWorkbenchState,
  target: Exclude<
    TeacherQuestionMediaDirectoryDeleteRequest['target'],
    { readonly kind: 'library-folder' }
  >,
): TeacherWorkbenchState {
  switch (target.kind) {
    case 'class': {
      const removedStudents = new Set(state.students
        .filter(student => student.classId === target.id)
        .map(student => student.id))
      return {
        ...state,
        classes: state.classes.filter(item => item.id !== target.id),
        students: state.students.filter(item => item.classId !== target.id),
        timetableEntries: state.timetableEntries.filter(item => item.classId !== target.id),
        exams: state.exams
          .filter(item => item.classId !== target.id)
          .map(item => ({
            ...item,
            entries: item.entries.filter(entry => !removedStudents.has(entry.studentId)),
          })),
        questionFolders: state.questionFolders.filter(item => !removedStudents.has(item.studentId)),
        questionAssignments: state.questionAssignments.filter(item => !removedStudents.has(item.studentId)),
        seatingLayouts: state.seatingLayouts.filter(item => item.classId !== target.id),
      }
    }
    case 'student':
      return {
        ...state,
        students: state.students.filter(item => item.id !== target.id),
        exams: state.exams.map(item => ({
          ...item,
          entries: item.entries.filter(entry => entry.studentId !== target.id),
        })),
        questionFolders: state.questionFolders.filter(item => item.studentId !== target.id),
        questionAssignments: state.questionAssignments.filter(item => item.studentId !== target.id),
        seatingLayouts: state.seatingLayouts.map(item => ({
          ...item,
          slots: item.slots.map(studentId => studentId === target.id ? null : studentId),
        })),
      }
    case 'student-folder': {
      const removed = new Set([target.id])
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
        questionAssignments: state.questionAssignments.filter(
          item => item.folderId === undefined || !removed.has(item.folderId),
        ),
      }
    }
    default:
      return assertNeverQuestionDirectoryTarget(target)
  }
}

function assertNeverQuestionDirectoryTarget(target: never): never {
  throw new TeacherQuestionMediaError('invalid-request', `不支持的试题目录类型: ${JSON.stringify(target)}`)
}

function assertQuestionTarget(state: TeacherWorkbenchState, target: TeacherQuestionImageTarget): void {
  if (!hasQuestionTarget(state, target)) throw new TeacherQuestionMediaError('not-found', '试题图片不存在')
}

function hasQuestionTarget(state: TeacherWorkbenchState, target: TeacherQuestionImageTarget): boolean {
  return target.kind === 'batch'
    ? state.questionBatches.some(batch => batch.images.some(image => image.id === target.id))
    : state.questionAssignments.some(item => item.id === target.id)
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
