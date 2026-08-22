# @deepseek-ai/dsh-tool-teacher-workbench

English | [中文](README.zh.md)

Model-facing Consumer for the durable teacher workbench. The plugin registers one authoritative section reader, one stored-question image reader, and five semantic mutation tools over `ctx.teacherWorkbench`. Daily Management covers tasks, memos, ledger data, and calendar items; Timetable covers the independent Week and Grade class catalogs and their entries; Student Roster covers roster classes and students; Score Analysis covers roster-linked exams; Question Cutting covers staged-PDF segmentation, question media and folders, assignment, and Office generation from stored images or an ordinary local image directory. Every state mutation uses the Host service's schema-validated compare-and-set document rather than a parallel agent store.

The standard Web composition mounts the plugin after `@deepseek-ai/dsh-host-teacher-workbench` and the MinerU-backed OCR service. Conversation PDF uploads supply a private Host source id, while roster, timetable, and score imports use the logged OCR Markdown injected with the user prompt. Opening the browser workbench or changing its active module refreshes the same Host document and displays accepted tool changes.

## Extension Points

The package consumes `ctx.tools`, `ctx.fs`, and `ctx.teacherWorkbench`. When `ctx.attachments` is mounted, it also registers the stored-question image reader and resolves `ctx.llm` at execution time to require an image-capable model route. Local-directory generation resolves and reads nested images through `ctx.fs`; PDF segmentation also resolves the optional `ctx.ocr` service at execution time and fails clearly when layout extraction is unavailable. The package provides no service or event vocabulary of its own.

## Model Experience

### Ordinary-conversation workbench operations

#### What the model sees

The model receives the seven schemas in the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-teacher-workbench). `teacher_workbench_read` returns stable ids for one section and includes credential-free `notificationTargets` in the Daily Management result. `teacher_question_image_read` resolves one stored batch or assignment image, reports its source dimensions, and returns a durable image attachment so an image-capable model can choose source-pixel coordinates. The Question Cutting mutation tool can then rotate, crop, or erase up to 32 rectangles by filling each region with a sampled surrounding color; crop and erase replace only the selected stored image, and invalid or out-of-bounds regions fail before replacement. `save_todo`, `save_note`, `save_ledger_entry`, and `save_calendar_item` accept an optional reminder containing an exact returned platform and bot id plus a one-time or repeating rule; memo and ledger payloads use `remindAt` for the independent reminder deadline. Unknown targets and elapsed occurrences fail without committing an item. The five mutation tools select an explicit action and action-specific data, return the committed revision and summary, and include created ids where relevant. Timetable saves and imports require `view=week` for Today, Week, and Study or `view=grade` for the explicit Grade view, reject class ids from the other catalog and duplicate imported slots, and return read-back confirmation for the affected view. PDF segmentation additionally uses the opaque source id injected with an uploaded PDF; source bytes and Host paths are absent from model context. `generate_folder_document` accepts a local directory path and needs no student assignment, while `generate_document` uses stored batch or assignment targets. `generate_student_documents` matches the Question Cutting UI when its optional fields are omitted: temporary images, an empty Word title, and no name or date; `source: 'assigned'` explicitly selects every assigned image. Generated Word and PowerPoint results contain private Host output paths.

#### Token effect

The seven stable schemas extend each model request in a composition that mounts this Consumer. Section reads and direct mutations add bounded JSON tool results. Each successful stored-image read also adds one durable image attachment to the tool result and later conversation history. PDF segmentation also incurs MinerU layout extraction and the Host-owned question-boundary child calls; Office generation makes no additional model request.

#### KV Cache effect

Stable names, descriptions, and schemas form a reusable request prefix until the package or tool presentation changes. Uploaded OCR text, workbench reads, and tool results vary in later request content. Question-boundary children use caches independent of the parent conversation.

## Known Limitations and Deferred Work

- **One deployment-global workbench** — tools share the Host service's current single-document scope; per-user authorization requires a future storage ownership model.
- **Retained PDF sources need expiry** — content-addressed source objects are deduplicated and integrity-checked, but automatic garbage collection is not implemented.
- **Generated Office files are Host paths** — Word and PowerPoint output is saved privately and reported by absolute path; direct browser download handoff is not implemented.
- **OCR and model interpretation can be wrong** — imported tables and semantic question boundaries should be reviewed in the workbench before consequential use.
