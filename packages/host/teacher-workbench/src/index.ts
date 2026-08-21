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
  readQuestionImage,
  replaceQuestionImage,
  saveTemporaryQuestionSelection,
  TeacherQuestionMediaError,
  type TeacherQuestionMediaConfig,
} from './question-media.ts'
import { normalizeTimetableWithAgent } from './timetable-agent.ts'
import type {
  TeacherQuestionAssignRequest,
  TeacherQuestionBatchId,
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
  TeacherQuestionImageTarget,
  TeacherQuestionMutationResult,
  TeacherQuestionRejected,
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
  TeacherWorkbenchWriteRequest,
  TeacherWorkbenchWriteResult,
  TeacherWeatherRequest,
  TeacherWeatherResult,
} from './types.ts'

const TEACHER_WORKBENCH_SETTINGS_NAMESPACE = settingsNamespace('teacher-workbench')
const DEFAULT_QUESTION_IMAGE_BYTES = 25 * 1024 * 1024
const DEFAULT_QUESTION_BATCH_BYTES = 300 * 1024 * 1024
const DEFAULT_TIMETABLE_SOURCE_CHARACTERS = 500_000
const DEFAULT_TIMETABLE_ENTRIES = 1_000
const DEFAULT_TIMETABLE_AGENT_TIMEOUT_MS = 300_000
const DEFAULT_TIMETABLE_VISION_AGENT_TIMEOUT_MS = 45_000

export type * from './types.ts'
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
  teacherQuickNoteSchema,
  teacherQuestionFolderSchema,
  teacherRecordSchema,
  teacherRecordTemplateSchema,
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

/** Host weather-provider and question-media configuration. */
export interface Config {
  /** Nominatim-compatible endpoint used to resolve districts, counties, and cities. */
  geocodingEndpoint: string
  /** Maximum number of resolved location queries cached in memory. */
  geocodingCacheEntries: number
  /** Root containing immutable paper batches and their cropped images. */
  segmentsRoot: string
  /** Root containing grade/class/student assignment copies. */
  studentsRoot: string
  /** Maximum decoded bytes accepted for one question image. */
  maxQuestionImageBytes: number
  /** Maximum decoded bytes accepted for one complete paper batch. */
  maxQuestionBatchBytes: number
  /** Maximum MinerU characters admitted to one timetable-agent prompt. */
  maxTimetableSourceCharacters: number
  /** Maximum structured rows accepted from one timetable-agent run. */
  maxTimetableEntries: number
  /** Wall-clock deadline for one timetable-agent run. */
  timetableAgentTimeoutMs: number
  /** Wall-clock deadline for one direct-vision timetable-agent run. */
  timetableVisionAgentTimeoutMs: number
}

/** Host service owning the revisioned workbench document. */
export class TeacherWorkbenchService extends TypertRemoteService {
  static inject = ['storageDomain']
  static Config: z<Config> = z.object({
    geocodingEndpoint: z.string().pattern(/^https?:\/\/.+/u).default(DEFAULT_WEATHER_GEOCODING_ENDPOINT),
    geocodingCacheEntries: z.natural().min(1).max(4_096).default(DEFAULT_WEATHER_GEOCODING_CACHE_ENTRIES),
    segmentsRoot: z.string().default(''),
    studentsRoot: z.string().default(''),
    maxQuestionImageBytes: z.natural().min(1_024).max(200 * 1024 * 1024).default(DEFAULT_QUESTION_IMAGE_BYTES),
    maxQuestionBatchBytes: z.natural().min(1_024).max(2 * 1024 * 1024 * 1024).default(DEFAULT_QUESTION_BATCH_BYTES),
    maxTimetableSourceCharacters: z.natural().min(1_000).max(1_000_000).default(DEFAULT_TIMETABLE_SOURCE_CHARACTERS),
    maxTimetableEntries: z.natural().min(1).max(10_000).default(DEFAULT_TIMETABLE_ENTRIES),
    timetableAgentTimeoutMs: z.natural().min(1_000).max(3_600_000).default(DEFAULT_TIMETABLE_AGENT_TIMEOUT_MS),
    timetableVisionAgentTimeoutMs: z.natural().min(1_000).max(3_600_000).default(DEFAULT_TIMETABLE_VISION_AGENT_TIMEOUT_MS),
  })

  private global?: DomainGlobal<TeacherWorkbenchDocument>
  private operationTail: Promise<void> = Promise.resolve()
  private acceptingWrites = true
  private readonly weatherProvider: TeacherWeatherProvider
  private configSource: () => Config

  /**
   * @param ctx - Host context carrying the storage-domain facility.
   * @param config - geocoding endpoint and cache policy.
   */
  constructor(ctx: Context, config: Config = {
    geocodingEndpoint: DEFAULT_WEATHER_GEOCODING_ENDPOINT,
    geocodingCacheEntries: DEFAULT_WEATHER_GEOCODING_CACHE_ENTRIES,
    segmentsRoot: '',
    studentsRoot: '',
    maxQuestionImageBytes: DEFAULT_QUESTION_IMAGE_BYTES,
    maxQuestionBatchBytes: DEFAULT_QUESTION_BATCH_BYTES,
    maxTimetableSourceCharacters: DEFAULT_TIMETABLE_SOURCE_CHARACTERS,
    maxTimetableEntries: DEFAULT_TIMETABLE_ENTRIES,
    timetableAgentTimeoutMs: DEFAULT_TIMETABLE_AGENT_TIMEOUT_MS,
    timetableVisionAgentTimeoutMs: DEFAULT_TIMETABLE_VISION_AGENT_TIMEOUT_MS,
  }) {
    super(ctx, 'teacherWorkbench')
    this.weatherProvider = new TeacherWeatherProvider(config)
    this.configSource = () => config
    installSettingsSection(ctx, TEACHER_WORKBENCH_SETTINGS_NAMESPACE, TeacherWorkbenchService.Config, config, {
      setSource: (source) => { this.configSource = source },
      onChange: () => {},
    })
  }

  /** Open and own the durable singleton. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(teacherWorkbenchDomainSpec)
    this.ctx.effect(() => async () => {
      this.acceptingWrites = false
      await this.operationTail
      await domain.close()
    }, 'teacher-workbench.domainClose')
    this.global = domain.global
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
      await global.set(next)
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
   * Persist a browser-rendered paper batch and commit its metadata.
   * @param request - batch metadata and ordered raster payloads.
   * @returns the committed document and generated batch id, or a stable failure.
   */
  @Remote('saveQuestionBatch')
  saveQuestionBatch(request: TeacherQuestionBatchSaveRequest): Promise<TeacherQuestionMutationResult> {
    return this.enqueueQuestionMutation(async () => {
      const persisted = await persistQuestionBatch(this.questionMediaConfig(), request, Date.now())
      try {
        const document = await this.commitQuestionState(state => ({
          ...state,
          questionBatches: [...state.questionBatches, persisted.batch],
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
      return Object.freeze({
        ok: true,
        value: Object.freeze(await readQuestionImage(this.questionMediaConfig(), this.requireGlobal().get().state, request.target)),
      })
    } catch (error) {
      return questionRejected(error)
    }
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
      await deleteQuestionBatchFiles(this.questionMediaConfig(), request.batchId).catch(() => {})
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
  async saveTemporaryQuestionSelection(
    request: TeacherQuestionTemporarySaveRequest,
  ): Promise<TeacherQuestionTemporarySaveResult> {
    try {
      return Object.freeze({
        ok: true,
        value: Object.freeze(await saveTemporaryQuestionSelection(
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
    dailyTodos: Object.freeze(state.dailyTodos.map(item => Object.freeze({ ...item }))),
    quickNotes: Object.freeze(state.quickNotes.map(item => Object.freeze({ ...item }))),
    ledgerCategories: Object.freeze(state.ledgerCategories.map(item => Object.freeze({ ...item }))),
    ledgerEntries: Object.freeze(state.ledgerEntries.map(item => Object.freeze({ ...item }))),
    calendarItems: Object.freeze(state.calendarItems.map(item => Object.freeze({ ...item }))),
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
    questionFolders: Object.freeze(state.questionFolders.map(item => Object.freeze({ ...item }))),
    questionAssignments: Object.freeze(state.questionAssignments.map(item => Object.freeze({ ...item }))),
  })
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
