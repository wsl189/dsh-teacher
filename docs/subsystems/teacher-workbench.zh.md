# 教师工作台

[English](teacher-workbench.md) | 中文

教师工作台子系统负责持久化教师文档，以及浏览器端和面向模型的 Consumer 共用的 Host 操作。[`ctx.teacherWorkbench`](../../packages/host/teacher-workbench) 向两个表层公开同一份带修订号的状态与试题媒体操作，因此日常管理、课程表、学生名册、成绩分析和试题切割不会维护并行存储。

来源：[`packages/host/teacher-workbench/src/types.ts`](../../packages/host/teacher-workbench/src/types.ts) 与 [Host 包参考](../../packages/host/teacher-workbench/README.zh.md)。

## 持久化与文件系统根目录

该服务通过 `ctx.storageDomain` 存储一份经 schema 校验的文档，并以比较后写入的修订号接受修改。持久化移动提醒的定时器会在启动后及每次写入成功后重建；投递目标只包含提供方 id、显示标签和连接状态。

`segmentsRoot` 与 `studentsRoot` 分别是试题库和学生媒体当前生效的权威根目录。浏览操作会投影这些根目录中当前存在的所有非隐藏目录与受支持图片，包括并非由 DSH 创建的项目。每个投影项目都能使用适用的新建、重命名、删除、编辑、分发、临时选择与文档生成功能；Host 会再次解析其不透明 id，并在修改文件系统前确认目标仍位于当前配置的根目录内。修改任一设置都会切换可见且可操作的目录树，不会从旧根目录复制内容。

`TeacherQuestionLibraryFolder.physicalName` 保留从当前根目录扫描并纳入持久化关系的目录的准确磁盘名称。保存、重新加载和子树操作都使用这些保留的名称解析目录路径；未携带该字段的条目则从显示名称派生安全的路径段。每个持久化物理名称都必须通过单个非隐藏目录名称的校验。

对话上传的源文档保存在私有的内容寻址 `sourcesRoot` 下。暂存操作返回不透明 id，OCR 版面用于经过复核的试题分割，生成的 Word 或 PowerPoint 文件写入 `generatedRoot`；源文件原始字节与服务器文件系统路径不会进入 Session 日志。

## 操作

点例收集使用独立的 SQLite 路由域，没有名册引用。`TeacherExample` 包含目录顺序、标签、描述、笔迹，以及独立的题目与解析 `TeacherExampleDocument` 元数据；`TeacherExampleCatalog` 不包含文件字节。`TeacherExampleUpdateRequest` 仅修改提交的字段。`TeacherExampleDocumentRequest` 显式选择 `TeacherExampleDocumentKind`；`TeacherExampleUploadRequest` 仅替换该文档的原件并清除其旧 Word 文件。`TeacherExampleFileRequest` 选择原件或 Word 产物，以 `TeacherExampleFile` 返回；每项操作返回带判别字段的 `TeacherExampleResult`。`TeacherExampleExportRequest` 提供有序的题目标识和逐题或集中排列的 `TeacherExampleExportLayout`，用于下载仅包含题目与解析原文的 Word。[Host 参考](../../packages/host/teacher-workbench/README.zh.md#example-collection) 定义持久化、重试、原件替换和导出保证。

Remote 表层包含带修订号的文档读写、天气查询、课程表整理、通知目标发现、上传来源暂存、基于 OCR 的试题分割与裁剪复核、试题媒体浏览与目录修改、图片持久化与分发、临时选集，以及单份或批量文档生成。面向模型的配套包通过语义工具消费这些操作，并负责相应提示词、schema、工具结果与 Session 日志效果。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteacherworkbench--teacherworkbenchservice"></a>

### `ctx.teacherWorkbench` — `TeacherWorkbenchService`

Host service owning the revisioned workbench document.

```ts cordis-catalog
/**
 * Read the current immutable workbench document.
 * @param _request - Empty request object retained for a uniform Remote signature.
 * @returns the current revision and state.
 */
@Remote('read') read(_request: TeacherWorkbenchReadRequest): Promise<TeacherWorkbenchReadResult>

/**
 * List collected question metadata and tags.
 * @param _request - empty directory-list request.
 * @returns saved questions and reusable tags without file bytes.
 */
@Remote('listExamples') listExamples(_request: Record<never, never>): Promise<TeacherExampleResult<TeacherExampleCatalog>>

/**
 * Create one numeric question directory.
 * @param _request - empty creation request.
 * @returns a new numeric directory with empty question and explanation documents, tags, and description.
 */
@Remote('createExample') createExample(_request: Record<never, never>): Promise<TeacherExampleResult<TeacherExample>>

/**
 * Save collected question metadata.
 * @param request - question identity and changed metadata fields.
 * @returns the saved question; concurrent OCR preserves these edits.
 */
@Remote('updateExample') updateExample(request: TeacherExampleUpdateRequest): Promise<TeacherExampleResult<TeacherExample>>

/**
 * Add a reusable collection tag.
 * @param request - reusable tag name.
 * @returns its normalized name after persistence.
 */
@Remote('addExampleTag') addExampleTag(request: { readonly name: string }): Promise<TeacherExampleResult<string>>

/**
 * Delete one collected question and its files.
 * @param request - question to delete with both documents’ originals and Word files.
 * @returns the deleted identity.
 */
@Remote('deleteExample') deleteExample(request: TeacherExampleRequest): Promise<TeacherExampleResult<TeacherExampleId>>

/**
 * Retain a collected question source before OCR.
 * @param request - original image or PDF, owning question, and question or explanation selection.
 * @returns the saved source metadata, ready for OCR.
 */
@Remote('uploadExample') uploadExample(request: TeacherExampleUploadRequest): Promise<TeacherExampleResult<TeacherExample>>

/**
 * Run MinerU OCR, proofread it against the original through the tool model, and generate Word.
 * @param request - question or explanation whose current original needs recognition.
 * @returns the saved Word status; failures retain the original and any existing Word for retry.
 */
@Remote('recognizeExample') recognizeExample(request: TeacherExampleDocumentRequest): Promise<TeacherExampleResult<TeacherExample>>

/**
 * Read a collected file, restoring missing Word illustrations from its source and retaining uniform typography.
 * @param request - selected question or explanation and its original or Word file.
 * @returns the saved file for preview or download.
 */
@Remote('readExampleFile') readExampleFile(request: TeacherExampleFileRequest): Promise<TeacherExampleResult<TeacherExampleFile>>

/**
 * Export selected questions and explanations as one editable Word document.
 * @param request - ordered question identities and paired or grouped explanation placement; no headings, tags, or descriptions are added.
 * @returns the compiled Word file; unfinished uploaded documents prevent export.
 */
@Remote('exportExamplesWord') exportExamplesWord(request: TeacherExampleExportRequest): Promise<TeacherExampleResult<TeacherExampleFile>>

/**
 * List dsh-im bots that may receive reminder notifications.
 * @param _request - Empty request object retained for a uniform Remote signature.
 * @returns Credential-free platform and bot identities with live connection state.
 */
@Remote('listNotificationTargets') listNotificationTargets(_request: Record<never, never>): Promise<readonly TeacherNotificationTarget[]>

/**
 * Project active workbench reminders for an optional shared scheduled-task list.
 * @returns Credential-free task rows derived from the current durable document.
 */
listScheduledReminders(): readonly TeacherScheduledReminderTask[]

/**
 * Replace the complete state after comparing the observed revision.
 * @param request - observed revision and replacement state.
 * @returns the committed document or an explicit conflict/validation failure.
 */
@Remote('write') write(request: TeacherWorkbenchWriteRequest): Promise<TeacherWorkbenchWriteResult>

/**
 * Retain one browser-uploaded document for a later agent workbench operation.
 * @param request - original metadata and base64 bytes.
 * @returns a durable content-addressed source reference or stable failure.
 */
@Remote('stageSource') async stageSource(request: TeacherWorkbenchSourceStageRequest): Promise<TeacherWorkbenchSourceStageResult>

/**
 * Resolve a configured location and fetch validated weather from the Host.
 * @param request - district, county, or city selected in dsh settings.
 * @returns current conditions, twelve forecast hours, or a stable failure.
 */
@Remote('weather') weather(request: TeacherWeatherRequest): Promise<TeacherWeatherResult>

/**
 * Recognize an upload with an independent child using the configured tool model.
 * @param request - Original image or OCR evidence and the selected timetable destination.
 * @returns structured rows for browser review or a stable failure.
 */
@Remote('normalizeTimetable') normalizeTimetable(request: TeacherTimetableNormalizeRequest): Promise<TeacherTimetableNormalizeResult>

/**
 * Detect complete top-level question boundaries through the configured tool model.
 * @param request - selected OCR pages, captured reasoning choice, and crop padding.
 * @returns validated source-page crop regions or a stable failure.
 */
@Remote('segmentQuestions') async segmentQuestions(request: TeacherQuestionSegmentRequest): Promise<TeacherQuestionSegmentResult>

/**
 * Visually review preliminary question crops and correct one processing group when needed.
 * @param request - crop evidence, current group regions, and captured reasoning choice.
 * @returns accepted preliminary regions or one Host-validated corrected group.
 */
@Remote('reviewQuestionCrops') async reviewQuestionCrops(request: TeacherQuestionCropReviewRequest): Promise<TeacherQuestionCropReviewResult>

/**
 * Persist one browser-rendered paper-batch part and commit its metadata.
 * @param request - batch metadata and ordered raster payloads.
 * @returns the committed document and generated batch id, or a stable failure.
 */
@Remote('saveQuestionBatch') saveQuestionBatch(request: TeacherQuestionBatchSaveRequest): Promise<TeacherQuestionMutationResult>

/**
 * Read one paper crop or student assignment copy.
 * @param request - exact metadata-backed image target.
 * @returns validated image bytes or a stable failure.
 */
@Remote('readQuestionImage') async readQuestionImage(request: TeacherQuestionImageReadRequest): Promise<TeacherQuestionImageReadResult>

/**
 * Scan the currently configured batch and student roots for visible images.
 * @param _request - empty request retained for a uniform Remote signature.
 * @returns filesystem-backed collections or a stable storage failure.
 */
@Remote('browseQuestionMedia') async browseQuestionMedia(_request: TeacherQuestionMediaBrowseRequest): Promise<TeacherQuestionMediaBrowseResult>

/**
 * Create one physical child directory selected through the current configured-root projection.
 * @param request - opaque scanned parent or question-library root and safe child name.
 * @returns the unchanged durable document or a stable failure.
 */
@Remote('createQuestionMediaDirectory') createQuestionMediaDirectory( request: TeacherQuestionMediaDirectoryCreateRequest, ): Promise<TeacherQuestionMutationResult>

/**
 * Delete one current-root directory and update matching durable relationships.
 * @param request - opaque directory target from the latest scan or durable state.
 * @returns the committed or unchanged durable document, or a stable failure.
 */
@Remote('deleteQuestionMediaDirectory') deleteQuestionMediaDirectory( request: TeacherQuestionMediaDirectoryDeleteRequest, ): Promise<TeacherQuestionMutationResult>

/**
 * Rename one current-root directory and update matching durable metadata.
 * @param request - opaque directory target and safe replacement name.
 * @returns the committed or unchanged durable document, or a stable failure.
 */
@Remote('renameQuestionMediaDirectory') renameQuestionMediaDirectory( request: TeacherQuestionMediaDirectoryRenameRequest, ): Promise<TeacherQuestionMutationResult>

/**
 * Replace one stored raster after browser-side editing.
 * @param request - exact target plus replacement raster payload.
 * @returns the committed document or a stable failure.
 */
@Remote('replaceQuestionImage') replaceQuestionImage(request: TeacherQuestionImageReplaceRequest): Promise<TeacherQuestionMutationResult>

/**
 * Delete one paper crop or independent student copy.
 * @param request - exact image target to remove.
 * @returns the committed document or a stable failure.
 */
@Remote('deleteQuestionImage') deleteQuestionImage(request: TeacherQuestionImageDeleteRequest): Promise<TeacherQuestionMutationResult>

/**
 * Delete one complete paper batch and every assignment derived from it.
 * @param request - durable batch identity to remove.
 * @returns the committed document or a stable failure.
 */
@Remote('deleteQuestionBatch') deleteQuestionBatch(request: TeacherQuestionBatchDeleteRequest): Promise<TeacherQuestionMutationResult>

/**
 * Copy selected paper crops into one student's durable image collection.
 * @param request - destination student and ordered source image ids.
 * @returns the committed document or a stable failure.
 */
@Remote('assignQuestions') assignQuestions(request: TeacherQuestionAssignRequest): Promise<TeacherQuestionMutationResult>

/**
 * Snapshot selected student images into temporary Office-generation storage.
 * @param request - student identity and ordered assignment ids.
 * @returns copied-image count or a stable failure.
 */
@Remote('saveTemporaryQuestionSelection') saveTemporaryQuestionSelection( request: TeacherQuestionTemporarySaveRequest, ): Promise<TeacherQuestionTemporarySaveResult>

/**
 * List roster students that currently have temporary Office-generation images.
 * @param request - student identities to inspect.
 * @returns available student selections or a stable failure.
 */
@Remote('listTemporaryQuestionSelections') async listTemporaryQuestionSelections( request: TeacherQuestionTemporaryListRequest, ): Promise<TeacherQuestionTemporaryListResult>

/**
 * Build one Word or PowerPoint artifact from selected stored images.
 * @param request - output family, optional Word metadata, and ordered image targets.
 * @returns a downloadable artifact or a stable failure.
 */
@Remote('generateQuestionDocument') async generateQuestionDocument(request: TeacherQuestionDocumentRequest): Promise<TeacherQuestionDocumentResult>

/**
 * Build one Word or PowerPoint file from a browser-selected image directory.
 * @param request - selected directory name, ordered images, and output family.
 * @returns a downloadable artifact or a stable failure.
 */
@Remote('generateUploadedQuestionDocument') async generateUploadedQuestionDocument( request: TeacherQuestionUploadedDocumentRequest, ): Promise<TeacherQuestionDocumentResult>

/**
 * Build one independent Word or PowerPoint file per selected student.
 * @param request - output family and independent per-student Word options.
 * @returns independent artifacts, skipped students, or a stable failure.
 */
@Remote('generateStudentDocuments') async generateStudentDocuments(request: TeacherQuestionBatchDocumentRequest): Promise<TeacherQuestionBatchDocumentResult>

/**
 * Resolve storage policy at call time so settings changes affect later tool operations.
 * @returns the current source-document and generated-output policy.
 */
sourceConfig(): TeacherWorkbenchSourceConfig

/**
 * Resolve source-image limits for conversation-requested Office generation.
 * @returns current per-image and aggregate decoded-byte limits.
 */
questionDocumentLimits(): { readonly maxImageBytes: number; readonly maxBatchBytes: number }
```

Source: [`packages/host/teacher-workbench/src/index.ts`](../../packages/host/teacher-workbench/src/index.ts)
<!-- END GENERATED cordis-surface -->
