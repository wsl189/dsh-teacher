/** Plugin-lifetime browser queue for PDF question cutting and progress projection. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  OcrLayoutDocument,
  OcrLayoutResult,
  TeacherQuestionBatchId,
  TeacherQuestionBatchSaveRequest,
  TeacherQuestionCropReviewRequest,
  TeacherQuestionCropReviewResult,
  TeacherQuestionImageUpload,
  TeacherQuestionLayoutElementId,
  TeacherQuestionLibraryFolderId,
  TeacherQuestionPagePreview,
  TeacherQuestionSegmentSuccess,
  TeacherQuestionSegmentResult,
  TeacherSegmentedQuestion,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchActionResult } from './controller.ts'
import {
  partitionQuestionUploads,
  renderQuestionCrops,
  renderQuestionPagePreviews,
} from './question-segmentation.ts'

type MaximumQuestionWidthRatio = TeacherQuestionSegmentSuccess['value']['maxQuestionWidthRatio']

/** Visible lifecycle stage for one queued PDF. */
export type QuestionCuttingStage =
  | 'queued'
  | 'extracting'
  | 'segmenting'
  | 'reviewing'
  | 'rendering'
  | 'saving'
  | 'completed'
  | 'failed'

/** Stable failure family rendered by the Question Cutting center panel. */
export type QuestionCuttingFailureCode = 'no-session' | 'no-questions' | 'operation-failed'

/** Immutable progress row for one browser-held PDF. */
export interface QuestionCuttingJob {
  /** Browser-local stable React key. */
  readonly key: string
  /** Original PDF display name. */
  readonly fileName: string
  /** Current processing stage. */
  readonly stage: QuestionCuttingStage
  /** Monotonic integer completion percentage from zero through one hundred. */
  readonly progress: number
  /** Epoch milliseconds when the PDF entered the queue. */
  readonly queuedAt: number
  /** Epoch milliseconds when the queue worker started this PDF. */
  readonly startedAt?: number
  /** Epoch milliseconds when this PDF completed or failed. */
  readonly finishedAt?: number
  /** Number of question images committed so far. */
  readonly savedCount: number
  /** Number of semantic questions detected after segmentation. */
  readonly questionCount?: number
  /** Stable failure family for a terminal failed row. */
  readonly failureCode?: QuestionCuttingFailureCode
  /** Provider or persistence diagnostic for an operation failure. */
  readonly failureMessage?: string
}

/** Complete queue projection shared across workbench module and Session navigation. */
export interface QuestionCuttingView {
  /** Jobs in upload order, including terminal rows for the current browser-plugin lifetime. */
  readonly jobs: readonly QuestionCuttingJob[]
}

/** Initial progress projection for isolated component rendering. */
export const EMPTY_QUESTION_CUTTING_VIEW: QuestionCuttingView = Object.freeze({ jobs: Object.freeze([]) })

/** Input captured when the page-range sheet starts one background cut. */
export interface QuestionCuttingEnqueueRequest {
  /** Browser-held source PDF retained until its task settles. */
  readonly file: File
  /** Exact zero-based pages selected in the sheet. */
  readonly pageIndexes: readonly number[]
  /** Display label persisted with the resulting paper batch. */
  readonly pageRange: string
  /** Optional explicit leaf destination; omission delegates PDF-name directory creation to the Host. */
  readonly folderId?: TeacherQuestionLibraryFolderId
  /** PDF.js scale for OCR fallback and final crop pixels. */
  readonly renderScale: number
  /** MinerU layout units retained around accepted boundaries. */
  readonly padding: number
}

type QuestionSegmentationRunner = (
  layout: OcrLayoutDocument,
  padding: number,
  pagePreviews: readonly TeacherQuestionPagePreview[],
) => Promise<TeacherQuestionSegmentResult>

type QuestionCropReviewRunner = (
  request: Omit<TeacherQuestionCropReviewRequest, 'parentSessionId'>,
) => Promise<TeacherQuestionCropReviewResult>

interface QuestionCuttingControllerDependencies {
  extractLayout: (
    file: File,
    pageIndexes: readonly number[],
    renderScale: number,
    progress: (completedPages: number, totalPages: number) => void,
  ) => Promise<OcrLayoutResult>
  resolveSegmentation: () => QuestionSegmentationRunner | undefined
  resolveCropReview: () => QuestionCropReviewRunner | undefined
  saveBatch: (request: TeacherQuestionBatchSaveRequest) => Promise<TeacherWorkbenchActionResult>
}

type RenderCrops = (
  file: File,
  layout: OcrLayoutDocument,
  questions: readonly TeacherSegmentedQuestion[],
  maxQuestionWidthRatio: MaximumQuestionWidthRatio,
  renderScale: number,
  progress: (completedQuestions: number, totalQuestions: number) => void,
) => Promise<TeacherQuestionImageUpload[]>

interface QuestionCuttingControllerOptions {
  readonly key?: () => string
  readonly now?: () => number
  readonly renderCrops?: RenderCrops
  readonly renderPagePreviews?: typeof renderQuestionPagePreviews
  readonly partitionUploads?: typeof partitionQuestionUploads
}

interface PendingQuestionCuttingJob {
  readonly key: string
  readonly request: QuestionCuttingEnqueueRequest
  readonly segmentQuestions?: QuestionSegmentationRunner
  readonly reviewCrops?: QuestionCropReviewRunner
}

function maximumQuestionWidthRatio(questions: readonly TeacherSegmentedQuestion[]): number {
  const regions = questions.flatMap(question => question.regions)
  return regions.length === 0
    ? 1
    : Math.max(...regions.map(region => (region.right - region.left) / region.pageWidth))
}

function adjacentInspectionPages(
  layout: OcrLayoutDocument,
  corePageIndexes: readonly number[],
): readonly number[] {
  const core = new Set(corePageIndexes)
  const positions = layout.pages.flatMap((page, index) => core.has(page.pageIndex) ? [index] : [])
  const first = Math.min(...positions)
  const last = Math.max(...positions)
  if (!Number.isFinite(first) || !Number.isFinite(last)) throw new Error('question group has no source layout page')
  return layout.pages
    .slice(Math.max(0, first - 1), Math.min(layout.pages.length, last + 2))
    .map(page => page.pageIndex)
}

function replaceQuestionGroup(
  current: readonly TeacherSegmentedQuestion[],
  groupIndex: number,
  replacement: readonly TeacherSegmentedQuestion[],
  groupCount: number,
): TeacherSegmentedQuestion[] {
  if (replacement.some(question => question.groupIndex !== groupIndex)) {
    throw new Error('reviewed question group identity is inconsistent')
  }
  const merged: TeacherSegmentedQuestion[] = []
  for (let index = 0; index < groupCount; index += 1) {
    merged.push(...(index === groupIndex
      ? replacement
      : current.filter(question => question.groupIndex === index)))
  }
  return merged.map((question, index) => ({ ...question, questionNo: index + 1 }))
}

function affectedQuestions(
  after: readonly TeacherSegmentedQuestion[],
  affected: readonly TeacherQuestionLayoutElementId[],
): TeacherSegmentedQuestion[] {
  const ids = new Set<TeacherQuestionLayoutElementId>(affected)
  return after.filter(question => ids.has(question.sourceHeadId))
}

class QuestionCuttingFailure extends Error {
  constructor(readonly code: Exclude<QuestionCuttingFailureCode, 'operation-failed'>, message: string) {
    super(message)
    this.name = 'QuestionCuttingFailure'
  }
}

/**
 * Sequential browser queue whose worker outlives the Question Cutting component.
 *
 * Navigation only removes subscribers; accepted tasks retain their PDF and captured
 * parent Session until settlement. Disposal stops admitting work, drops tasks that
 * have not started, closes notifications, and waits for the active task to settle.
 */
export class QuestionCuttingController implements HostObservable<QuestionCuttingView> {
  private view = EMPTY_QUESTION_CUTTING_VIEW
  private readonly listeners = new Set<() => void>()
  private readonly pending: PendingQuestionCuttingJob[] = []
  private worker: Promise<void> | null = null
  private disposed = false
  private readonly createKey: () => string
  private readonly now: () => number
  private readonly renderCrops: RenderCrops
  private readonly renderPagePreviews: typeof renderQuestionPagePreviews
  private readonly partitionUploads: typeof partitionQuestionUploads

  /**
   * @param dependencies - OCR, captured-session segmentation, and durable-save operations.
   * @param options - deterministic test clocks, keys, and browser-render adapters.
   */
  constructor(
    private readonly dependencies: QuestionCuttingControllerDependencies,
    options: QuestionCuttingControllerOptions = {},
  ) {
    this.createKey = options.key ?? (() => globalThis.crypto.randomUUID())
    this.now = options.now ?? (() => Date.now())
    this.renderCrops = options.renderCrops ?? renderQuestionCrops
    this.renderPagePreviews = options.renderPagePreviews ?? renderQuestionPagePreviews
    this.partitionUploads = options.partitionUploads ?? partitionQuestionUploads
  }

  /** @returns the current immutable queue projection. */
  getSnapshot = (): QuestionCuttingView => this.view

  /**
   * Subscribe to projection replacement.
   * @param listener - React-compatible change listener.
   * @returns disposer for this listener.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Capture one PDF and its current parent Session, then start or extend the queue.
   * @param request - selected pages, destination, and rendering settings.
   * @throws when the plugin controller is disposing.
   */
  enqueue(request: QuestionCuttingEnqueueRequest): void {
    if (this.disposed) throw new Error('question cutting controller is disposed')
    const key = this.createKey()
    const queuedAt = this.now()
    const segmentQuestions = this.dependencies.resolveSegmentation()
    const reviewCrops = this.dependencies.resolveCropReview()
    this.pending.push({
      key,
      request,
      ...(segmentQuestions === undefined ? {} : { segmentQuestions }),
      ...(reviewCrops === undefined ? {} : { reviewCrops }),
    })
    this.publish(Object.freeze({
      jobs: Object.freeze([...this.view.jobs, Object.freeze({
        key,
        fileName: request.file.name,
        stage: 'queued' as const,
        progress: 0,
        queuedAt,
        savedCount: 0,
      })]),
    }))
    this.startWorker()
  }

  /** Stop accepting tasks and await the active operation before returning. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      await this.worker
      return
    }
    this.disposed = true
    this.pending.length = 0
    this.listeners.clear()
    await this.worker
  }

  private startWorker(): void {
    if (this.worker !== null || this.disposed) return
    const worker = this.drain().finally(() => {
      if (this.worker === worker) this.worker = null
      if (!this.disposed && this.pending.length > 0) this.startWorker()
    })
    this.worker = worker
  }

  private async drain(): Promise<void> {
    while (!this.disposed) {
      const task = this.pending.shift()
      if (task === undefined) return
      await this.execute(task)
    }
  }

  private async execute(task: PendingQuestionCuttingJob): Promise<void> {
    const startedAt = this.now()
    this.replaceJob(task.key, job => ({
      ...job,
      stage: 'extracting',
      progress: 3,
      startedAt,
    }))
    let savedCount = 0
    try {
      if (task.segmentQuestions === undefined) {
        throw new QuestionCuttingFailure('no-session', 'question cutting requires an active parent Session')
      }
      const extracted = await this.dependencies.extractLayout(
        task.request.file,
        task.request.pageIndexes,
        task.request.renderScale,
        (completedPages, totalPages) => {
          const fraction = totalPages === 0 ? 0 : completedPages / totalPages
          this.updateProgress(task.key, 'extracting', 5 + Math.floor(fraction * 35))
        },
      )
      if (!extracted.ok) throw new Error(extracted.error.message)
      const exactPages = new Set(task.request.pageIndexes)
      const layout: OcrLayoutDocument = {
        ...extracted.value,
        pages: extracted.value.pages.filter(page => exactPages.has(page.pageIndex)),
      }
      const pagePreviews = await this.renderPagePreviews(
        task.request.file,
        layout.pages.map(page => page.pageIndex),
        task.request.renderScale,
      )
      this.updateProgress(task.key, 'segmenting', 42)
      const segmented = await task.segmentQuestions(layout, task.request.padding, pagePreviews)
      if (!segmented.ok) throw new Error(segmented.error.message)
      let questions = [...segmented.value.questions]
      this.replaceJob(task.key, job => ({ ...job, questionCount: questions.length }))

      const baseName = task.request.file.name.replace(/\.pdf$/iu, '')
      const groupCount = segmented.value.groupCount
      if (task.reviewCrops === undefined) {
        throw new QuestionCuttingFailure('no-session', 'question crop review requires an active parent Session')
      }
      let outputWidthRatio = segmented.value.maxQuestionWidthRatio
      for (const group of segmented.value.groups) {
        let groupQuestions = questions.filter(question => question.groupIndex === group.groupIndex)
        let reviewQuestions = groupQuestions
        let recutAttempt = 0
        for (;;) {
          this.updateProgress(
            task.key,
            'reviewing',
            Math.floor(50 + 22 * (
              group.groupIndex * (segmented.value.maxRecutAttempts + 1) + recutAttempt
            ) / (groupCount * (segmented.value.maxRecutAttempts + 1))),
          )
          const crops = await this.renderCrops(
            task.request.file,
            layout,
            reviewQuestions,
            outputWidthRatio,
            task.request.renderScale,
            () => {},
          )
          const localPageIndexes = recutAttempt === 0 || reviewQuestions.length === 0
            ? group.corePageIndexes
            : [...new Set(reviewQuestions.flatMap(question => (
              question.regions.map(region => region.pageIndex)
            )))]
          const previewPages = new Set(adjacentInspectionPages(layout, localPageIndexes))
          const inspectionPages = new Set(group.inspectionPageIndexes)
          const reviewed = await task.reviewCrops({
            fileName: layout.name,
            groupIndex: group.groupIndex,
            corePageIndexes: group.corePageIndexes,
            recutAttempt,
            reviewQuestionIds: reviewQuestions.map(question => question.sourceHeadId),
            pages: layout.pages.filter(page => inspectionPages.has(page.pageIndex)),
            pagePreviews: pagePreviews.filter(preview => (
              previewPages.has(preview.pageIndex) && inspectionPages.has(preview.pageIndex)
            )),
            questions: groupQuestions,
            crops,
            padding: task.request.padding,
          })
          if (!reviewed.ok) throw new Error(reviewed.error.message)
          if (reviewed.value.decision === 'accepted') break
          if (reviewed.value.decision === 'revised') {
            questions = replaceQuestionGroup(
              questions,
              group.groupIndex,
              reviewed.value.questions,
              groupCount,
            )
            groupQuestions = questions.filter(question => question.groupIndex === group.groupIndex)
            this.replaceJob(task.key, job => ({ ...job, questionCount: questions.length }))
            outputWidthRatio = maximumQuestionWidthRatio(questions)
          }
          recutAttempt += 1
          if (recutAttempt >= segmented.value.maxRecutAttempts) break
          reviewQuestions = affectedQuestions(
            groupQuestions,
            reviewed.value.affectedQuestionIds,
          )
          if (reviewQuestions.length === 0) break
        }
      }

      if (questions.length === 0) throw new QuestionCuttingFailure('no-questions', 'no complete questions were detected')

      let savedBatchId: TeacherQuestionBatchId | undefined
      for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
        const groupQuestions = questions.filter(question => question.groupIndex === groupIndex)
        if (groupQuestions.length === 0) continue
        const groupStart = 74 + 25 * groupIndex / groupCount
        const groupSpan = 25 / groupCount
        this.updateProgress(task.key, 'rendering', Math.floor(groupStart))
        const crops = await this.renderCrops(
          task.request.file,
          layout,
          groupQuestions,
          outputWidthRatio,
          task.request.renderScale,
          (completedQuestions, totalQuestions) => {
            const fraction = totalQuestions === 0 ? 0 : completedQuestions / totalQuestions
            this.updateProgress(task.key, 'rendering', Math.floor(groupStart + groupSpan * 0.6 * fraction))
          },
        )
        const parts = this.partitionUploads(crops, segmented.value.maxSaveBatchBytes)
        let savedInGroup = 0
        for (const images of parts) {
          const saved = await this.dependencies.saveBatch({
            ...(savedBatchId === undefined ? {} : { appendToBatchId: savedBatchId }),
            destination: task.request.folderId === undefined
              ? { kind: 'source-folder' }
              : { kind: 'library-folder', folderId: task.request.folderId },
            name: baseName,
            sourceName: task.request.file.name,
            pageRange: task.request.pageRange,
            images,
          })
          if (!saved.ok) throw new Error(saved.error.message)
          savedBatchId = saved.batchId ?? savedBatchId
          if (savedBatchId === undefined) throw new Error('question batch id is missing after save')
          savedCount += images.length
          savedInGroup += images.length
          this.replaceJob(task.key, job => ({ ...job, savedCount }))
          this.updateProgress(
            task.key,
            'saving',
            Math.floor(groupStart + groupSpan * (0.6 + 0.4 * savedInGroup / groupQuestions.length)),
          )
        }
      }
      if (savedBatchId === undefined) throw new Error('question batch was not created')
      this.replaceJob(task.key, job => ({
        ...job,
        stage: 'completed',
        progress: 100,
        savedCount,
        finishedAt: this.now(),
      }))
    } catch (error) {
      this.replaceJob(task.key, job => ({
        ...job,
        stage: 'failed',
        savedCount,
        finishedAt: this.now(),
        ...(error instanceof QuestionCuttingFailure
          ? { failureCode: error.code }
          : {
            failureCode: 'operation-failed' as const,
            failureMessage: error instanceof Error ? error.message : String(error),
          }),
      }))
    }
  }

  private updateProgress(key: string, stage: QuestionCuttingStage, progress: number): void {
    this.replaceJob(key, job => ({
      ...job,
      stage,
      progress: Math.max(job.progress, Math.min(99, Math.max(0, Math.floor(progress)))),
    }))
  }

  private replaceJob(key: string, replace: (job: QuestionCuttingJob) => QuestionCuttingJob): void {
    this.publish(Object.freeze({
      jobs: Object.freeze(this.view.jobs.map(job => job.key === key ? Object.freeze(replace(job)) : job)),
    }))
  }

  private publish(view: QuestionCuttingView): void {
    this.view = view
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-teacher-workbench] question-cutting subscriber threw:', error)
      }
    }
  }
}
