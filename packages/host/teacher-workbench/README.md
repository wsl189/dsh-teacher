# @deepseek-ai/dsh-host-teacher-workbench

English | [中文](README.zh.md)

Host-owned persistence, question media, document generation, weather access, and timetable normalization for the Web teacher workbench. The plugin stores one schema-validated, revisioned document through `ctx.storageDomain` and exposes `teacherWorkbench/read` plus compare-and-set `teacherWorkbench/write` Remote methods. Dedicated question Remotes atomically save, read, replace, delete, assign, and render stored images without sending server paths to the browser. `teacherWorkbench/weather` resolves a configured district, county, or city through a Nominatim-compatible endpoint, fetches the forecast from Open-Meteo, validates both responses, and returns stable lookup, availability, or response errors without requiring the browser to contact either provider directly. When browser-side MinerU reconciliation finds no entries, `teacherWorkbench/normalizeTimetable` starts a short-lived child agent loop under the current session, selects `ctx.agentDefaultModel.currentToolSelection()`, exposes run-scoped source, matrix-submission, and line-splice patch tools, and accepts only a token for a matrix validated in that run before the browser may review rows.

The version-8 document contains daily tasks, quick notes, ledger categories and entries, dated calendar items, normalized weekly timetable entries, lesson resources, classes and students, exams, family-notice templates and saved drafts, reusable record templates, authored teaching and headteacher records, class seating layouts, paper-batch metadata, nested student question folders, and student question assignments. Each seating layout belongs to one roster class, contains exactly one slot for every configured row and column, and may reference only that class's students without duplicate occupants; deleting a class removes its layout, while deleting a student clears that student's seat. Ledger entries reference one durable category, store a required local date and time, and represent CNY amounts as non-negative integer cents; deleting a category removes its entries in the same revisioned write. Every class belongs to exactly one catalog: roster classes own students and exams and supply Question Cutting and seating, normal timetable classes are selectable by Today, Week, and Morning/Evening Study, and grade-timetable classes are selectable only by Grade. The schema rejects ledger, student, exam, seating, or timetable references whose owner is absent or crosses those catalogs, while identical class display names may retain independent identities in each catalog. Each timetable entry occupies one unique class/type/weekday/period slot; deleting a class also removes its schedule. Question folders and assignments reference durable students and source images; deleting a folder, student, class, image, or batch removes its dependent metadata and best-effort cleans its owned files. Daily-management, teaching, and headteacher edits share one revision, so concurrent browser windows use the same compare-and-set conflict handling. Browser code never writes Local Storage; every accepted mutation lands in the storage backend selected for the `teacher_workbench` domain.

## Question Image Storage and Output

`teacherWorkbench/saveQuestionBatch` validates PNG, JPEG, or WebP payloads, generates opaque ids, and commits one bounded save part only after every image has reached owned storage. The first part creates the paper batch; a continuation names that opaque batch id, must repeat its source metadata, and appends files and image metadata to the same library entry. Large source papers are not subject to one part's aggregate byte ceiling because the browser saves successive semantic page groups and further divides a group by decoded image bytes when needed. `readQuestionImage`, `replaceQuestionImage`, `deleteQuestionImage`, and `deleteQuestionBatch` resolve files only from validated metadata and configured roots. `assignQuestions` creates independent copies below a sanitized academic-year/class/student hierarchy and any selected nested folder, so later editing or deleting one student's copy cannot change the source batch or another student's work.

`generateQuestionDocument` builds a downloadable Word or PowerPoint document from selected batch or assignment images. `generateUploadedQuestionDocument` accepts browser-selected directory images without persisting them. `saveTemporaryQuestionSelection` replaces one student's previous temporary selection with independent image snapshots, while `listTemporaryQuestionSelections` reports which requested students have staged images. Every Office path orders images by the authoritative source question number, falls back to a question number parsed from the display file name, and only then uses natural file-name ordering; temporary-manifest reads reapply the same rule so selections staged by older versions are corrected at generation time. `generateStudentDocuments` returns one independent Word or PowerPoint artifact per eligible roster student, with per-student Word title, name, and date choices plus an explicit skipped list; its temporary source reads only those snapshots and removes each student's selection after successful generation. Word output preserves the reference A4 margins and metadata flow; PowerPoint output preserves one top-left, non-upscaled image per 13.333-by-7.5-inch slide. Image dimensions, decoded byte limits, target references, containment, file names, and generated output are validated on the Host; temporary selections are isolated from the durable document.

## Configuration

| Field | Meaning |
|---|---|
| `segmentsRoot` | Root for immutable paper-batch directories and cropped question images. |
| `studentsRoot` | Root for readable grade/class/student assignment copies. |
| `maxQuestionImageBytes` | Maximum decoded size of one accepted question image. |
| `maxQuestionBatchBytes` | Maximum combined decoded size of one automatically saved part; the Web default is 96 MiB and it is not a whole-PDF limit. |
| `questionSegmentationBatchPages` | Selected pages owned by one semantic segmentation group; the default is 20. |
| `questionSegmentationAgentTimeoutMs` | Wall-clock deadline for one question-segmentation child; the Web default is 60 minutes. |
| `geocodingEndpoint` | Nominatim-compatible location-search endpoint. |
| `geocodingCacheEntries` | Maximum number of resolved locations retained in memory. |
| `maxTimetableSourceCharacters` | Maximum MinerU characters admitted to one timetable-agent request. |
| `maxTimetableEntries` | Maximum structured timetable rows accepted from one run. |
| `timetableAgentTimeoutMs` | Wall-clock deadline for a text/OCR timetable-agent run. |
| `timetableVisionAgentTimeoutMs` | Wall-clock deadline for a direct-vision timetable-agent run. |

The first four fields are available in **Settings → Plugins → Plugin configuration → Question workspace storage** under the `teacher-workbench` settings namespace. The Web bundle defaults the roots to `~/.dsh/teacher-workbench/segments` and `~/.dsh/teacher-workbench/students`.

## Extension Points

The plugin provides `ctx.teacherWorkbench`. Browser consumers use the generated Remote contribution through `@deepseek-ai/dsh-api-remotes` rather than importing Host runtime code.

`geocodingEndpoint` selects the Nominatim-compatible search endpoint, and `geocodingCacheEntries` bounds the in-memory location cache. Cache misses are serialized at no more than one geocoding request per second; repeat weather refreshes reuse the resolved coordinates while fetching current forecast data again.

## Model Experience

### Timetable normalization child

#### What the model sees

A fresh child receives the upload name, a destination captured when extraction starts, current class/grade/type/teacher defaults, known class names, a run-scoped source tool, a matrix-submission tool, a line-splice patch tool, and a compact final-output schema. A vision-capable route receives one overview plus overlapping enlarged views of a raster source; extracted PDF and Office content and image fallback use compact MinerU regions through the source tool. The child inspects the source, submits one complete source-oriented matrix, and repairs rejected draft lines through 1-based splices while the Host preserves every unlisted line and block. The final output contains only the token for a matrix accepted in that run. The parser tolerates an axis or fields keyword joined to its first argument by an opening parenthesis, but semantic and dimension failures still require an explicit draft repair. The Host accepts repeated local period headers in chronological data order and assigns their later rows distinct periods without assuming source coordinates. Class, Grade, and Study destinations change relevant record semantics but do not prescribe a document layout. Every uploaded string is untrusted data, ordinary tools remain hidden, and the result is returned to browser review rather than the parent conversation.

#### Token effect

Each attempt pays for an independent child run plus source, submission, and patch calls. The selected tool model's configured `contextWindow` and `maxTokens` govern every request; the timetable plugin does not replace either value. Raster uploads start enhanced OCR concurrently with direct vision so a direct timeout or invalid result can immediately start a text child. The Web bundle gives both direct vision and text children a 60-minute wall-clock deadline.

#### KV Cache effect

Independent of the parent conversation cache. Reuse requires the same tool-model route, fixed persona and schema, defaults, and MinerU source; changed source data establishes a different suffix or prefix according to the provider.

### Question-segmentation child

#### What the model sees

A fresh child receives a layout-neutral segmentation skill, the selected PDF page indexes, element count, bounded source-chunk count, one run-scoped OCR source tool, one run-scoped boundary-submission tool, and `structured_output`. Source chunks expose opaque element ids, page dimensions, element type, bounding box, and extracted text; they never expose a page-template label or a preselected question boundary. The child must inspect every chunk, infer and describe the current source's question-head convention, submit every top-level question head, keep subquestions and page continuations under their owning question, explicitly reassign interleaved-column or figure elements when source order differs from visual ownership, and exclude titles, instructions, section headings, and answers. The inferred convention may use any numbering syntax, repeat or restart local labels, change between chapters, or identify unnumbered exercises from recurring semantic starts. An excluded recognized section heading also excludes its continuation elements up to the next accepted head on that page, preventing multi-line section instructions from entering the preceding crop. The Host does not interpret printed numbers; it sorts accepted heads by authoritative OCR ordinal and rejects unknown ids, duplicate ownership, answer leakage, unexcluded recognized section headings, empty crops, and drafts that omit mandatory source inspection, then assigns one unique display number in normalized source order. Only a run-scoped token for an accepted draft can become the structured result; the Host derives and clamps every crop rectangle from validated OCR geometry.

#### Token effect

Each cut pays for one independent child run per semantic page group plus one call per bounded source chunk, one or more complete boundary submissions, and one final structured-output call in each child. The Web bundle assigns 20 selected pages to each group and inspects one adjacent selected page on each available side, so a cross-group question remains whole and only the group containing its inferred head saves it. A child admits at most 50 inspected pages, 5,000 OCR elements, 300 questions, five distinct drafts, and 60 minutes. Source calls return at most 18,000 serialized characters apiece so dense layouts do not enter one oversized tool result. The selected tool model's configured context and output limits remain authoritative.

#### KV Cache effect

Independent of the parent conversation cache. The fixed skill and schemas form a reusable prefix, while the run-specific tool names and OCR source establish a different request suffix for each cut.

## Known Limitations and Deferred Work

- **Whole-document writes** — compare-and-set keeps cross-module edits atomic, but very large school-wide datasets should move to independently revisioned tables before multi-user deployment.
- **JSON base64 media transport** — browser reads, replacements, and generated downloads carry complete payloads in memory; configured per-image and per-save-part limits bound each request, but streaming is not exposed.
- **Weather requires Host network access** — location queries go to the configured geocoder and Open-Meteo supplies current conditions plus the next twelve hours; either provider or the Host outbound network can be unavailable without affecting saved workbench data.
- **Question cutting requires recoverable OCR evidence** — the child handles arbitrary or absent numbering, columns, page breaks, subquestions, and figures without fixed page coordinates, but it cannot recover a question whose text and non-text OCR elements are all absent.
