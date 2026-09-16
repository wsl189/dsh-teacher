# Teacher Workbench

English | [中文](teacher-workbench.zh.md)

The teacher-workbench subsystem owns the durable teacher document and the Host operations used by its browser and model-facing Consumers. [`ctx.teacherWorkbench`](../../packages/host/teacher-workbench) exposes the same revisioned state and question-media operations to both surfaces, so Daily Management, Timetable, Student Roster, Score Analysis, and Question Cutting do not maintain parallel stores.

Source: [`packages/host/teacher-workbench/src/types.ts`](../../packages/host/teacher-workbench/src/types.ts) and the [Host package reference](../../packages/host/teacher-workbench/README.md).

## Persistence and Filesystem Roots

The service stores one schema-validated document through `ctx.storageDomain` and accepts writes with compare-and-set revisions. Timers for durable mobile reminders are reconstructed after startup and after each accepted write; delivery targets contain only provider ids, display labels, and connection state.

`segmentsRoot` and `studentsRoot` are the live authoritative roots for question-library and student media. Browsing projects every non-hidden directory and supported image currently under those roots, including items not created by DSH. Every projected item supports the same applicable create, rename, delete, edit, assignment, temporary-selection, and document-generation operations; the Host resolves its opaque id again and verifies that the target remains under the current configured root before changing the filesystem. Changing either setting switches the visible and mutable tree without copying content from the previous root.

`TeacherQuestionLibraryFolder.physicalName` retains the exact disk name of a directory adopted from a current-root scan. Folder paths use those preserved segments through saves, reloads, and subtree operations; entries without that field derive a safe segment from their display name. Each stored physical name is validated as one non-hidden directory segment.

Conversation-uploaded source documents are retained under the private content-addressed `sourcesRoot`. Source staging returns an opaque id, OCR layout drives reviewed question segmentation, and generated Word or PowerPoint files are written under `generatedRoot`; raw source bytes and server filesystem paths do not enter the Session log.

## Operations

Example collection has an independent SQLite-routed domain and no roster references. `TeacherExample` carries directory order, tags, descriptions, pen strokes, and independent question/explanation `TeacherExampleDocument` metadata; `TeacherExampleCatalog` omits all file bytes. `TeacherExampleUpdateRequest` changes only submitted fields. `TeacherExampleDocumentRequest` explicitly selects a `TeacherExampleDocumentKind`; `TeacherExampleUploadRequest.files` supplies the ordered fragments of that document; the upload replaces its original and clears its old Word file. `TeacherExampleFileRequest` selects an original or Word artifact, returned as `TeacherExampleFile`; each operation returns a discriminated `TeacherExampleResult`. `TeacherExampleExportRequest` supplies ordered question identities and a paired/grouped `TeacherExampleExportLayout` for one Word download containing only original questions and explanations. [The Host reference](../../packages/host/teacher-workbench/README.md#example-collection) owns persistence, retry, source replacement, and export guarantees.

The Remote surface includes revisioned document reads and writes, weather lookup, timetable normalization, notification-target discovery, uploaded-source staging, OCR-backed question segmentation and crop review, question-media browsing and directory mutation, image persistence and assignment, temporary selections, and single or batch document generation. The model-facing companion package consumes these operations through semantic tools and owns their prompt, schema, tool-result, and Session-log effects.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * Remove a reusable preset without changing tags already assigned to questions.
 * @param request - preset name; repeated deletion is idempotent.
 * @returns its normalized name after persistence.
 */
@Remote('deleteExampleTag') deleteExampleTag(request: { readonly name: string }): Promise<TeacherExampleResult<string>>

/**
 * Delete one collected question and its files.
 * @param request - question to delete with both documents’ originals and Word files.
 * @returns the deleted identity.
 */
@Remote('deleteExample') deleteExample(request: TeacherExampleRequest): Promise<TeacherExampleResult<TeacherExampleId>>

/**
 * Retain ordered fragments as one collected question source before OCR.
 * @param request - images/PDFs in reading order, owning question, and question or explanation selection.
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
 * Load an editable Word document with immutable equation and image references.
 * @param request - question or explanation to edit.
 * @returns content and optimistic source/Word revision tokens.
 */
@Remote('readExampleWordEditor') readExampleWordEditor(request: TeacherExampleDocumentRequest): Promise<TeacherExampleResult<TeacherExampleWordEditor>>

/**
 * Save manual Word edits without overwriting a newer source or Word revision.
 * @param request - edited paragraphs and the revisions from the editor load.
 * @returns metadata and editor content from the committed Word revision.
 */
@Remote('saveExampleWordEditor') saveExampleWordEditor(request: TeacherExampleWordSaveRequest): Promise<TeacherExampleResult<TeacherExampleWordSaved>>

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
 * Accumulate selected student-image snapshots for Office generation; an empty selection clears them.
 * @param request - student identity and assignment ids to add or refresh.
 * @returns total staged-image count or a stable failure that preserves the previous selection.
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
 * Write one generated Office file to the operator-selected Host directory.
 * @param request - absolute directory and generated artifact; existing files receive a numbered suffix.
 * @returns the saved absolute path or a stable failure; no parent directory is created.
 */
@Remote('saveQuestionDocument') async saveQuestionDocument(request: TeacherQuestionDocumentSaveRequest): Promise<TeacherQuestionDocumentSaveResult>

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
