/** Plugin-lifetime browser queue for PDF question cutting and progress projection. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { mapConcurrently } from '@deepseek-ai/dsh-concurrency'
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
  openQuestionPdfRasterizer,
  partitionQuestionUploads,
  renderQuestionCrops,
  renderQuestionPagePreviews,
  type QuestionPdfRasterizer,
} from './question-segmentation.ts'

type MaximumQuestionWidthRatio = TeacherQuestionSegmentSuccess['value']['maxQuestionWidthRatio']
type QuestionSegmentationGroup = TeacherQuestionSegmentSuccess['value']['groups'][number]

interface ReviewedQuestionGroup {
  readonly questions: readonly TeacherSegmentedQuestion[]
  readonly unverifiedQuestionIds: readonly TeacherQuestionLayoutElementId[]
  readonly unverified: boolean
}

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
export type QuestionCuttingFailureCode = 'operation-failed'

/** Immutable progress row for one browser-held PDF. */
export interface QuestionCuttingJob {
  /** Browser-local stable React key. */
  readonly key: string
  /** Original PDF display name. */
  readonly fileName: string
  /** Teacher-facing selected page range captured when the PDF entered the queue. */
  readonly pageRange: string
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
  /** Number of bounded semantic groups in this PDF. */
  readonly groupCount?: number
  /** Number of groups already reviewed and durably saved when non-empty. */
  readonly completedGroupCount?: number
  /** Number of question crops retained from their latest safe revision after review could not converge. */
  readonly unverifiedQuestionCount?: number
  /** Number of page groups whose boundary or crop review could not be completed. */
  readonly unverifiedGroupCount?: number
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
  /** Total source page count used to admit one continuation page beyond the selection. */
  readonly pageCount: number
  /** Exact zero-based pages selected in the sheet. */
  readonly pageIndexes: readonly number[]
  /** Display label persisted with the resulting paper batch. */
  readonly pageRange: string
  /** Per-PDF reasoning choice retained for every segmentation and review stage. */
  readonly reasoningEnabled: boolean
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
  pagePreviews: readonly TeacherQuestionPagePreview[] | undefined,
  corePageIndexes: readonly number[],
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
  resolveSegmentation: (reasoningEnabled: boolean) => QuestionSegmentationRunner
  resolveCropReview: (reasoningEnabled: boolean) => QuestionCropReviewRunner
  saveBatch: (request: TeacherQuestionBatchSaveRequest) => Promise<TeacherWorkbenchActionResult>
}

type RenderCrops = (
  file: File,
  layout: OcrLayoutDocument,
  questions: readonly TeacherSegmentedQuestion[],
  maxQuestionWidthRatio: MaximumQuestionWidthRatio,
  renderScale: number,
  progress?: (completedQuestions: number, totalQuestions: number) => void,
) => Promise<TeacherQuestionImageUpload[]>

interface QuestionCuttingControllerOptions {
  readonly key?: () => string
  readonly now?: () => number
  readonly renderCrops?: RenderCrops
  readonly renderPagePreviews?: typeof renderQuestionPagePreviews
  readonly openPdfRasterizer?: (file: File) => Promise<QuestionPdfRasterizer>
  readonly partitionUploads?: typeof partitionQuestionUploads
}

interface PendingQuestionCuttingJob {
  readonly key: string
  readonly request: QuestionCuttingEnqueueRequest
  readonly segmentQuestions: QuestionSegmentationRunner
  readonly reviewCrops: QuestionCropReviewRunner
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

function affectedQuestions(
  after: readonly TeacherSegmentedQuestion[],
  affected: readonly TeacherQuestionLayoutElementId[],
): TeacherSegmentedQuestion[] {
  const ids = new Set<TeacherQuestionLayoutElementId>(affected)
  return after.filter(question => ids.has(question.sourceHeadId))
}

function retainedAffectedQuestionIds(
  groupQuestions: readonly TeacherSegmentedQuestion[],
  reviewQuestions: readonly TeacherSegmentedQuestion[],
  affected: readonly TeacherQuestionLayoutElementId[],
): TeacherQuestionLayoutElementId[] {
  const retainedIds = new Set(groupQuestions.map(question => question.sourceHeadId))
  const reported = [...new Set(affected.filter(id => retainedIds.has(id)))]
  if (reported.length > 0) return reported
  return [...new Set(reviewQuestions.map(question => question.sourceHeadId).filter(id => retainedIds.has(id)))]
}

function inspectionPageIndexes(
  corePageIndexes: readonly number[],
  pageCount: number,
): readonly number[] {
  const indexes = new Set(corePageIndexes)
  for (const pageIndex of corePageIndexes) {
    if (pageIndex > 0) indexes.add(pageIndex - 1)
    if (pageIndex + 1 < pageCount) indexes.add(pageIndex + 1)
  }
  return [...indexes].sort((left, right) => left - right)
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
  private readonly openPdfRasterizer: (file: File) => Promise<QuestionPdfRasterizer>
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
    const renderCrops = options.renderCrops ?? renderQuestionCrops
    const renderPagePreviews = options.renderPagePreviews ?? renderQuestionPagePreviews
    this.openPdfRasterizer = options.openPdfRasterizer ?? (
      options.renderCrops === undefined && options.renderPagePreviews === undefined
        ? openQuestionPdfRasterizer
        : file => Promise.resolve({
          pageCount: 0,
          renderPageForOcr: () => Promise.reject(new Error('OCR rasterization is not owned by the cutting controller')),
          renderPagePreviews: (pageIndexes, renderScale) => renderPagePreviews(file, pageIndexes, renderScale),
          renderCrops: (layout, questions, maxQuestionWidthRatio, renderScale, progress) => (
            renderCrops(file, layout, questions, maxQuestionWidthRatio, renderScale, progress)
          ),
          dispose: () => Promise.resolve(),
        })
    )
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
   * Capture one PDF and its reasoning-specific Host runners, then start or extend the queue.
   * @param request - selected pages, destination, and rendering settings.
   * @throws when the plugin controller is disposing.
   */
  enqueue(request: QuestionCuttingEnqueueRequest): void {
    if (this.disposed) throw new Error('question cutting controller is disposed')
    const key = this.createKey()
    const queuedAt = this.now()
    const segmentQuestions = this.dependencies.resolveSegmentation(request.reasoningEnabled)
    const reviewCrops = this.dependencies.resolveCropReview(request.reasoningEnabled)
    this.pending.push({
      key,
      request,
      segmentQuestions,
      reviewCrops,
    })
    this.publish(Object.freeze({
      jobs: Object.freeze([...this.view.jobs, Object.freeze({
        key,
        fileName: request.file.name,
        pageRange: request.pageRange,
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
    let rasterizer: QuestionPdfRasterizer | undefined
    try {
      const extracted = await this.dependencies.extractLayout(
        task.request.file,
        inspectionPageIndexes(task.request.pageIndexes, task.request.pageCount),
        task.request.renderScale,
        (completedPages, totalPages) => {
          const fraction = totalPages === 0 ? 0 : completedPages / totalPages
          this.updateProgress(task.key, 'extracting', 5 + Math.floor(fraction * 35))
        },
      )
      if (!extracted.ok) throw new Error(extracted.error.message)
      const layout: OcrLayoutDocument = {
        ...extracted.value,
        pages: extracted.value.pages,
      }
      this.updateProgress(task.key, 'segmenting', 42)
      const segmented = await task.segmentQuestions(
        layout,
        task.request.padding,
        undefined,
        task.request.pageIndexes,
      )
      if (!segmented.ok) throw new Error(segmented.error.message)
      const groupCount = segmented.value.groupCount
      const reviewCrops = task.reviewCrops
      let questionCount = segmented.value.questions.length
      this.replaceJob(task.key, job => ({
        ...job,
        questionCount,
        groupCount,
        completedGroupCount: 0,
      }))

      const outputWidthRatio = segmented.value.maxQuestionWidthRatio
      const activeRasterizer = await this.openPdfRasterizer(task.request.file)
      rasterizer = activeRasterizer
      const baseName = task.request.file.name.replace(/\.pdf$/iu, '')
      let savedBatchId: TeacherQuestionBatchId | undefined
      let unverifiedQuestionCount = 0
      let unverifiedGroupCount = 0
      let reviewedGroupCount = 0
      let pipelineFailure: { readonly error: unknown } | undefined
      const readPipelineFailure = (): typeof pipelineFailure => pipelineFailure
      const orderedGroups = segmented.value.groups.map((group, groupPosition) => ({
        group,
        groupPosition,
        persisted: Promise.withResolvers<undefined>(),
      }))
      this.updateProgress(task.key, 'reviewing', 50)
      await mapConcurrently(
        orderedGroups,
        segmented.value.maxConcurrentGroups,
        async ({ group, groupPosition, persisted }) => {
          try {
            const initialGroupQuestions = segmented.value.questions.filter(question => (
              question.groupIndex === group.groupIndex
            ))
            let reviewed: ReviewedQuestionGroup
            try {
              const pagePreviews = await activeRasterizer.renderPagePreviews(
                group.inspectionPageIndexes,
                task.request.renderScale,
              )
              reviewed = await this.reviewGroup(
                task,
                reviewCrops,
                activeRasterizer,
                layout,
                group,
                initialGroupQuestions,
                pagePreviews,
                outputWidthRatio,
                segmented.value.maxRecutAttempts,
              )
            } catch {
              reviewed = {
                questions: initialGroupQuestions,
                unverifiedQuestionIds: initialGroupQuestions.map(question => question.sourceHeadId),
                unverified: true,
              }
            }
            reviewedGroupCount += 1
            this.updateProgress(
              task.key,
              'reviewing',
              50 + Math.floor(19 * reviewedGroupCount / groupCount),
            )

            const previousGroup = orderedGroups[groupPosition - 1]
            if (previousGroup !== undefined) await previousGroup.persisted.promise
            const precedingFailure = readPipelineFailure()
            if (precedingFailure !== undefined) throw precedingFailure.error

            unverifiedQuestionCount += reviewed.unverifiedQuestionIds.length
            if (reviewed.unverified) unverifiedGroupCount += 1
            questionCount += reviewed.questions.length - initialGroupQuestions.length
            const groupQuestions = reviewed.questions.map((question, index) => ({
              ...question,
              questionNo: savedCount + index + 1,
            }))
            this.replaceJob(task.key, job => ({
              ...job,
              questionCount,
              ...(unverifiedQuestionCount === 0 ? {} : { unverifiedQuestionCount }),
              ...(unverifiedGroupCount === 0 ? {} : { unverifiedGroupCount }),
            }))

            const groupStart = 70 + 29 * groupPosition / groupCount
            const groupSpan = 29 / groupCount
            this.updateProgress(task.key, 'rendering', Math.floor(groupStart))
            const uploads = groupQuestions.length === 0
              ? []
              : await activeRasterizer.renderCrops(
                layout,
                groupQuestions,
                outputWidthRatio,
                task.request.renderScale,
                (completedQuestions, totalQuestions) => {
                  const fraction = totalQuestions === 0 ? 0 : completedQuestions / totalQuestions
                  this.updateProgress(
                    task.key,
                    'rendering',
                    Math.floor(groupStart + groupSpan * 0.6 * fraction),
                  )
                },
              )
            const parts = uploads.length === 0
              ? []
              : this.partitionUploads(uploads, segmented.value.maxSaveBatchBytes)
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
            this.replaceJob(task.key, job => ({
              ...job,
              completedGroupCount: groupPosition + 1,
            }))
          } catch (error) {
            pipelineFailure ??= { error }
            throw pipelineFailure.error
          } finally {
            persisted.resolve(undefined)
          }
        },
      )
      if (questionCount > 0 && savedBatchId === undefined) throw new Error('question batch was not created')
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
        failureCode: 'operation-failed' as const,
        failureMessage: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      if (rasterizer !== undefined) {
        try {
          await rasterizer.dispose()
        } catch (error) {
          console.error('[ui-teacher-workbench] PDF rasterizer disposal failed:', error)
        }
      }
    }
  }

  private async reviewGroup(
    task: PendingQuestionCuttingJob,
    reviewCrops: QuestionCropReviewRunner,
    rasterizer: QuestionPdfRasterizer,
    layout: OcrLayoutDocument,
    group: QuestionSegmentationGroup,
    initialQuestions: readonly TeacherSegmentedQuestion[],
    pagePreviews: readonly TeacherQuestionPagePreview[],
    outputWidthRatio: MaximumQuestionWidthRatio,
    maxRecutAttempts: number,
  ): Promise<ReviewedQuestionGroup> {
    let groupQuestions = [...initialQuestions]
    let reviewQuestions = groupQuestions
    let recutAttempt = 0
    const retainCurrentQuestions = (
      affectedQuestionIds: readonly TeacherQuestionLayoutElementId[] = reviewQuestions.map(
        question => question.sourceHeadId,
      ),
    ): ReviewedQuestionGroup => ({
      questions: groupQuestions,
      unverifiedQuestionIds: retainedAffectedQuestionIds(
        groupQuestions,
        reviewQuestions,
        affectedQuestionIds,
      ),
      unverified: true,
    })
    for (;;) {
      let reviewed: TeacherQuestionCropReviewResult
      try {
        const crops = await rasterizer.renderCrops(
          layout,
          reviewQuestions,
          outputWidthRatio,
          task.request.renderScale,
        )
        const localPageIndexes = recutAttempt === 0 || reviewQuestions.length === 0
          ? group.corePageIndexes
          : [...new Set(reviewQuestions.flatMap(question => (
            question.regions.map(region => region.pageIndex)
          )))]
        const previewPages = new Set(adjacentInspectionPages(layout, localPageIndexes))
        const inspectionPages = new Set(group.inspectionPageIndexes)
        reviewed = await reviewCrops({
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
      } catch {
        return retainCurrentQuestions()
      }
      if (!reviewed.ok) return retainCurrentQuestions()
      if (reviewed.value.decision === 'accepted') {
        return { questions: groupQuestions, unverifiedQuestionIds: [], unverified: false }
      }
      if (reviewed.value.decision === 'unresolved') {
        return retainCurrentQuestions(reviewed.value.affectedQuestionIds)
      }
      if (reviewed.value.questions.some(question => question.groupIndex !== group.groupIndex)) {
        return retainCurrentQuestions(reviewed.value.affectedQuestionIds)
      }
      if (recutAttempt >= maxRecutAttempts) {
        return retainCurrentQuestions(reviewed.value.affectedQuestionIds)
      }
      groupQuestions = [...reviewed.value.questions]
      recutAttempt += 1
      reviewQuestions = affectedQuestions(groupQuestions, reviewed.value.affectedQuestionIds)
      if (reviewQuestions.length === 0) {
        // A validated removal-only repair leaves no changed pixels to review.
        return { questions: groupQuestions, unverifiedQuestionIds: [], unverified: false }
      }
    }
  }

  private updateProgress(key: string, stage: QuestionCuttingStage, progress: number): void {
    this.replaceJob(key, (job) => {
      const boundedProgress = Math.min(99, Math.max(0, Math.floor(progress)))
      return {
        ...job,
        stage: boundedProgress < job.progress ? job.stage : stage,
        progress: Math.max(job.progress, boundedProgress),
      }
    })
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
