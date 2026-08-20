# @deepseek-ai/dsh-host-teacher-workbench

English | [中文](README.zh.md)

Host-owned persistence, question media, document generation, and weather access for the Web teacher workbench. The plugin stores one schema-validated, revisioned document through `ctx.storageDomain` and exposes `teacherWorkbench/read` plus compare-and-set `teacherWorkbench/write` Remote methods. Dedicated question Remotes atomically save, read, replace, delete, assign, and render stored images without sending server paths to the browser. `teacherWorkbench/weather` resolves a configured district, county, or city through a Nominatim-compatible endpoint, fetches the forecast from Open-Meteo, validates both responses, and returns stable lookup, availability, or response errors without requiring the browser to contact either provider directly.

The version-6 document contains daily tasks, quick notes, dated calendar items, normalized weekly timetable entries, lesson resources, classes and students, exams, reusable record templates, authored teaching records, paper-batch metadata, nested student question folders, and student question assignments. Every class belongs to exactly one catalog: roster classes own students and exams and supply Question Cutting, normal timetable classes are selectable by Today, Week, and Morning/Evening Study, and grade-timetable classes are selectable only by Grade. The schema rejects student, exam, or timetable references that cross those catalogs, while identical display names may retain independent identities in each catalog. Each timetable entry occupies one unique class/type/weekday/period slot; deleting a class also removes its schedule. Question folders and assignments reference durable students and source images; deleting a folder, student, class, image, or batch removes its dependent metadata and best-effort cleans its owned files. Daily-management and teaching edits share one revision, so concurrent browser windows use the same compare-and-set conflict handling. Browser code never writes Local Storage; every accepted mutation lands in the storage backend selected for the `teacher_workbench` domain.

## Question Image Storage and Output

`teacherWorkbench/saveQuestionBatch` validates PNG, JPEG, or WebP payloads, generates opaque ids, and commits a complete paper batch only after every image has reached an atomic batch directory. `readQuestionImage`, `replaceQuestionImage`, `deleteQuestionImage`, and `deleteQuestionBatch` resolve files only from validated metadata and configured roots. `assignQuestions` creates independent copies below a sanitized academic-year/class/student hierarchy and any selected nested folder, so later editing or deleting one student's copy cannot change the source batch or another student's work.

`generateQuestionDocument` builds a downloadable Word or PowerPoint document from selected batch or assignment images. `generateUploadedQuestionDocument` accepts browser-selected directory images without persisting them. `saveTemporaryQuestionSelection` replaces one student's previous temporary selection with independent image snapshots, while `listTemporaryQuestionSelections` reports which requested students have staged images. Every Office path orders images by the authoritative source question number, falls back to a question number parsed from the display file name, and only then uses natural file-name ordering; temporary-manifest reads reapply the same rule so selections staged by older versions are corrected at generation time. `generateStudentDocuments` returns one independent Word or PowerPoint artifact per eligible roster student, with per-student Word title, name, and date choices plus an explicit skipped list; its temporary source reads only those snapshots and removes each student's selection after successful generation. Word output preserves the reference A4 margins and metadata flow; PowerPoint output preserves one top-left, non-upscaled image per 13.333-by-7.5-inch slide. Image dimensions, decoded byte limits, target references, containment, file names, and generated output are validated on the Host; temporary selections are isolated from the durable document.

## Configuration

| Field | Meaning |
|---|---|
| `segmentsRoot` | Root for immutable paper-batch directories and cropped question images. |
| `studentsRoot` | Root for readable grade/class/student assignment copies. |
| `maxQuestionImageBytes` | Maximum decoded size of one accepted question image. |
| `maxQuestionBatchBytes` | Maximum combined decoded size of one saved paper batch. |
| `geocodingEndpoint` | Nominatim-compatible location-search endpoint. |
| `geocodingCacheEntries` | Maximum number of resolved locations retained in memory. |

The first four fields are available in **Settings → Plugins → Plugin configuration → Question workspace storage** under the `teacher-workbench` settings namespace. The Web bundle defaults the roots to `~/.dsh/teacher-workbench/segments` and `~/.dsh/teacher-workbench/students`.

## Extension Points

The plugin provides `ctx.teacherWorkbench`. Browser consumers use the generated Remote contribution through `@deepseek-ai/dsh-api-remotes` rather than importing Host runtime code.

`geocodingEndpoint` selects the Nominatim-compatible search endpoint, and `geocodingCacheEntries` bounds the in-memory location cache. Cache misses are serialized at no more than one geocoding request per second; repeat weather refreshes reuse the resolved coordinates while fetching current forecast data again.

## Model Experience

None, as the service exposes teacher-workbench records and weather only to GUI callers and adds no model context, tools, or messages.

#### KV Cache effect

None; the package neither assembles nor sends a model-provider request.

## Known Limitations and Deferred Work

- **Whole-document writes** — compare-and-set keeps cross-module edits atomic, but very large school-wide datasets should move to independently revisioned tables before multi-user deployment.
- **JSON base64 media transport** — browser reads, replacements, and generated downloads carry complete payloads in memory; configured per-image and per-batch limits bound persisted input, but streaming is not exposed.
- **Weather requires Host network access** — location queries go to the configured geocoder and Open-Meteo supplies current conditions plus the next twelve hours; either provider or the Host outbound network can be unavailable without affecting saved workbench data.
