# Agent Note: Tool-model timetable normalization

Status: implemented

English | [中文](2026-08-20-tool-model-timetable-normalization.zh.md)

## Problem

MinerU extracts text and table markup, but school timetables do not share one dependable layout. Merged cells, transposed axes, repeated worksheets, separate study tables, peripheral grade labels, and OCR reading-order errors require semantic interpretation. A parser can recognize a few cells while silently omitting most of the timetable; a non-empty result cannot establish completeness. Incorrect rows must not become durable timetable entries without review.

Recognition belongs to the workbench. Requiring a live user conversation prevents imports before a conversation exists and couples an unrelated upload to conversation navigation and deletion. Background work also needs a model choice distinct from the conversation default.

## Decision

The `agent-default-model` settings section stores `toolProvider` and `toolModel` as one validated pair. `currentToolSelection()` uses that pair, falling back to the current default provider and model when both fields are absent. **Settings → Models → Tool model** lists usable configured vision models under the [vision-selection policy](2026-09-09-vision-tool-model-selection.md) and writes both fields in one revision-checked mutation. The UI does not accept a free-form model id.

Before recognition starts, the browser captures the Week, Grade, or Study destination, its class catalog, and current defaults. Every upload goes through a tool-model child; the browser does not parse OCR into timetable entries. MinerU supplies the source text and tables, including every extracted worksheet. Supplemental text extraction validates text metadata independently of PDF geometry: native Office pages omit `page_size`, while coordinate-based extraction still requires it. Image-capable children can request the original raster and enlarged views through a dedicated tool when extracted text is missing, ambiguous, or contradictory. They read detailed text first so a small overview image does not displace clear cell evidence. If raster extraction fails, the child can use the original image alone; a text-only route needs extracted text.

Each import creates a fresh hidden parent through the Agent registry and starts a fresh `spawn` child. The Remote has no parent-session field. Neither agent inherits a user conversation or requires one to exist. The import disposes the child and parent after success, failure, or cancellation; Host workbench plugin teardown aborts active imports and waits for their cleanup. Temporary source, image, and validation tools are unique to one import and are removed with it.

The child receives the destination's display semantics and required entry fields. Week projects weekday columns and daily period rows for each class; Grade preserves a complete weekly schedule per class; Study separates morning and evening kinds and study slots. The child interprets headings, legends, merged cells, local period sequences, and companion worksheets without a fixed orientation or course dictionary. Source content is data, never instructions. Repeated total, class, and detail sheets are evidence for the same schedule, while workload summaries and course inventories are not lessons.

Large ruled-table OCR detail crops preserve column headings and merged row labels. Vertical glyphs are arranged horizontally from original pixels; disconnected strokes within one glyph stay together, preserving the distinction between 一, 二, and 三. Ambiguous grids use ordinary overlapping regions. HTML compaction preserves cell positions and encodes each row as a JSON array so a course/teacher line break stays inside its cell. These operations prepare evidence; only the child assigns timetable meanings.

The source tool exposes a section index and bounded UTF-8 pages, with re-reading allowed. Each section and page retains its OCR-pass label so repeated headings distinguish whole-image observations from detail crops. The Host rejects completion and source rejection while any text page remains unread, so a child cannot finish after reading only the whole-image OCR pass. This inspection requirement preserves the low-latency model selection; interpreting headers and checking assignments remain semantic work. A single oversized tool result can otherwise be replaced by a spill preview that hides middle rows from a restricted child. The child reads one header-defined block at a time and immediately submits its cells in source order as ordinary JSON entry batches with optional common fields. It checks each cell against the source before proceeding; the workbench arranges entries for display. Matching totals alone cannot detect shifted assignments. A returned batch id can replace or clear that batch without changing other accepted batches. Invalid fields, kinds, times, coordinates, duplicate slots, or excessive totals reject the batch atomically. Finish requires the audited source total to equal the saved draft count; structured output contains only its run-specific validation token. The Host supplies a study-kind label for teacher-only duties. An unsupported grade may remain empty; class names have no required suffix.

A source without a timetable has an explicit `not-timetable` draft action. Its run-bound token records a source rejection rather than an empty successful schedule, and the browser gives a localized file-selection correction. A nonempty draft blocks this action; any subsequent accepted batch invalidates the rejection token. This keeps unrelated-source handling inside the same structured completion protocol as successful recognition.

The child leaves `maxTokens` unset so the selected route owns the request context capacity and output default. The workbench configuration bounds source characters, tool-page bytes, accepted rows, and text/image deadlines. Stable failures and safe provider diagnostics reach the preview. The browser retains the captured destination when the teacher switches views, permits edits and selection, and performs one revisioned bulk import only after confirmation.

The browser plugin owns recognition progress, captured defaults, and editable review rows through a dedicated observable controller. Modal visibility belongs to the mounted view. Closing the dialog, leaving the workbench, or switching modules removes presentation subscriptions without cancelling processing; completion updates the retained result without opening a hidden dialog. Every timetable view can reopen the pending task. A new upload cannot replace a pending task or review, and only an explicit discard or successful import clears completed results. Persistence is single-flight and retains edited rows on failure. Browser refresh or plugin disposal clears this transient state; it is not a durable job queue.

## Alternatives considered

**Use a rule result whenever it contains rows.** A partial parse looks successful and bypasses the only semantic completeness check. Adding layouts does not establish that an unfamiliar document was fully understood.

**Attach recognition to the selected conversation.** An absent or cold conversation blocks an unrelated workbench operation, and conversation deletion can terminate it. A fresh internal parent gives the import its own lifetime and log.

**Use only direct model vision.** PDF and Office extraction retains useful cell text and worksheet structure, and text-only models remain usable. Dense raster tables also benefit from OCR detail regions. Vision and extracted evidence can support the same child.

**Use fixed rectangular crops for every table.** A crop that omits its class header or weekday label loses coordinate evidence. Reliable grid lines permit complete row groups and repeated headers; ambiguous grids retain the generic overlapping path.

**Use the conversation model selection.** Background extraction can need a different route. Updating the conversation default preserves an explicit tool-model pair.

**Allow a free-form tool-model id.** It admits typos and unavailable routes; the configured directory provides actionable choices.

**Import structured output immediately.** Model reconstruction is probabilistic. Editable review remains the authorization point for durable teacher data.

## Consequences

- Every Week, Grade, and Study upload incurs an independent model run; speed and recognition quality depend on the configured tool model.
- Source metadata, OCR tool results, image attachments, defaults, and validation exchanges are model-visible and logged in the child session.
- The child can inspect its source and submit or replace draft batches. It cannot alter existing workbench entries or user conversations.
- Import completion leaves no live parent or child; persisted session logs retain the evidence needed to reconstruct model requests.
- Review remains mandatory because OCR and model reconstruction can both be wrong.

## Testing

Host tests cover configured model selection, destination personas, batch validation, atomic replacement, source paging, and count checks, accepted-token enforcement, study duties, independent parent identities, text-only use of OCR, on-demand image attachments, timeout and shutdown cleanup, launch failure, and temporary tool disposal. Client tests cover all three destinations, regular worksheets going through the agent, imports with no selected conversation, captured destination context, editable review, class naming, bulk persistence, subscriber removal during both recognition stages, late completion after disposal, and failed-save retry without duplicate writes. The assembled Web tests run the real child loop against a scripted external model: a 15-class, five-day, eight-period fixture includes native Office metadata without PDF page dimensions and yields 600 reviewed and saved entries from both PNG and XLSX uploads with no live user conversation. Both stages continue while the dialog is closed and another module is mounted; returning exposes the retained result without reopening the dialog. Progress and completion have owner-local ARIA snapshots, and repeated import preserves 600 slots. The model fixture proves the application flow, not recognition accuracy on unfamiliar documents.
