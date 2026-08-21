# Agent Note: Reusable Document Extraction

Status: implemented

English | [中文](2026-08-18-reusable-document-extraction.zh.md)

## Problem

The teacher workbench needs to recognize calendars, student rosters, and score sheets supplied as images or Office documents, while the conversation composer needs extracted document text that a user can discuss with the model. Binding these flows directly to MinerU would duplicate upload, limits, errors, and transport behavior and would make each browser feature own a vendor protocol. Automatically writing OCR output would also turn imperfect table recognition into durable teacher data without review.

Document bytes and extracted text have different durability requirements. The original file only needs to reach the configured extractor. Conversation text becomes model-visible only after the user sends it and must therefore become logged plugin context associated with that prompt. Accepted calendar activities, roster rows, and exam scores must enter the existing revisioned teacher-workbench document rather than a separate OCR store.

## Decision

`@deepseek-ai/dsh-ocr` defines `ctx.ocr`, provider registration and execution-time selection, stable request/result/error types, and the Typert `ocr.extract` Remote. It auto-selects only when exactly one locally available provider exists; an explicit `provider` id otherwise owns selection. Requests carry one canonical-base64 document with its name and media type and may ask the provider to retain text classified outside the main reading order. Successful results carry bounded reading-order Markdown, provider identity, and a truncation flag. The runtime converts expected `OcrError` values into safe result data and hides unexpected provider diagnostics.

`@deepseek-ai/dsh-ocr-mineru` registers provider id `mineru` and adapts the self-hosted synchronous `/file_parse` API. Its ordinary DSH plugin configuration owns the endpoint, backend, hybrid effort, language, deadline, upload limit, response-byte limit, and Markdown-character limit; a card under **Settings → Plugins → Plugin configuration** exposes every field through the revisioned settings document. The provider accepts PDF, supported raster images, DOCX, PPTX, and XLSX; validates names, canonical base64, extensions, sizes, HTTP status, response bytes, JSON fields, and non-empty Markdown; and never persists source bytes or provider output. An extraction that requests discarded text obtains `middle_json` in the same MinerU call and prepends unique discarded lines that do not already occur in the Markdown.

The conversation Consumer exposes a dedicated file control for extractable documents while retaining the existing image attachment flow. Selecting PDF, supported raster images, DOCX, PPTX, or XLSX starts `ocr.extract` immediately and creates a runtime-only file row whose state is extracting, ready, or failed. The textarea never receives the Markdown. Send remains unavailable until every row is ready; a failed row must be removed before sending. Prompt admission injects each ready result first as a durable `user/message` whose source is the `mineru-ocr` plugin and whose `notice` summary names the file, then queues or steers the ordinary human message. The source bytes never reach the Session log or model, and successful admission clears the transient rows. Subagent continuations reject document context because their continuation wire currently accepts text only.

The same input bar owns browser-native voice input. A microphone button toggles speech recognition, and holding Space for 500 milliseconds starts the same recognizer until key release; a shorter Space press remains an ordinary space edit. Final transcripts enter the input machine at the current selection and stay user-editable. Unsupported browsers disable the voice control, and microphone or recognition failures use localized composer notices.

The teacher-workbench Consumer exposes document recognition in the expanded calendar, Student Roster, and Score Analysis. Calendar Markdown and HTML tables are projected deterministically into dated review rows; the HTML projection resolves row and column spans before it separates activity columns from responsibility metadata. Roster and score tables accept MinerU Markdown or HTML, skip repeated headers, and coalesce identical image fragments. Roster review preserves recognized standard and extra columns. Score review matches the captured class roster by student number first and then by an unambiguous name, merges repeated fragments into one entry per student, derives the initial exam name from the file name, and lets the teacher edit exam metadata. The teacher confirms review data before one compare-and-set mutation. Raw uploads, extracted Markdown, and review data remain browser-transient; the [durable teacher-workbench decision](2026-08-17-durable-teacher-workbench.md) remains the owner of accepted calendar, roster, and exam storage.

## Alternatives considered

**Call MinerU separately from each browser feature.** This duplicates vendor multipart fields, format validation, resource limits, diagnostics, and settings, and prevents another extractor from serving both Consumers.

**Use a model-facing tool instead of browser intake and review.** Uploading a local browser file is a human intake action, and a tool cannot provide calendar, roster, or score review. The later [path-based document reader](2026-08-22-agent-document-reader.md) complements these flows: it registers provider-neutrally only where `ctx.ocr` exists and reads agent-accessible workspace paths rather than browser-only files.

**Send the raw document to the conversation model.** Provider file capabilities vary, source files are larger than extracted text, and raw-file persistence would require a durable attachment and access-policy design. The current Consumer shows extraction status and records the exact extracted text as inspectable context without exposing it as editable prompt text.

**Append OCR Markdown to the visible draft.** This makes large documents dominate the editor, exposes implementation framing to the user, and lets incidental typing corrupt extracted tables. A separate transient file row provides removal and status while the logged plugin-context message preserves the model-visible bytes.

**Import every recognized workbench row immediately.** OCR and table reading can confuse merged cells, metadata columns, identities, scores, or date ranges. Review prevents provider output from becoming authoritative teacher data without explicit confirmation.

**Store recognized calendars in an OCR-specific database.** That splits calendar authority and revision conflicts across two stores. Accepted activities are ordinary `TeacherCalendarItem` values and belong in the existing revisioned workbench document.

**Include discarded text in every extraction.** Conversation documents and school calendars do not need repeated page titles, headers, or footer dates. Consumer opt-in retains peripheral text only for layouts whose interpretation depends on it.

## Consequences

- One configured extractor serves conversation and workbench Consumers, and provider replacement does not change their upload or result types. Discarded-text extraction can increase a response but does not require a second provider call.
- The configured MinerU endpoint receives complete selected documents. Deployments must choose an endpoint whose access and retention policy fits those documents; loopback remains the default.
- Browser Base64 JSON transport holds one complete file in browser and Host memory and expands wire size. Provider deadlines and byte limits bound work, but browser streaming, progress, cancellation, and extraction caching remain absent; the same-process path reader forwards tool cancellation separately.
- Conversation document text is model-visible as a logged plugin-source user-role context message immediately preceding the human prompt. Session replay can reconstruct it without a new event type, while the composer remains compact and the user can remove the file before admission.
- Workbench document recognition favors false negatives over unreviewed writes. Dense tables, scans, handwriting, ambiguous roster names, and layouts without recognizable headers may require manual corrections or produce no rows.

## Testing

Capability tests pin provider selection, disposal, safe diagnostics, multipart fields including hybrid effort and optional discarded text, canonical base64, format and size rejection, response validation, truncation, and MinerU failures. Client tests pin the conversation document state machine, send gating, hidden context payload, voice button and hold-Space gestures, image-intake compatibility, row- and column-spanning calendar projection, Markdown and HTML roster and score parsing, repeated-fragment coalescing, roster matching, review behavior, and revisioned writes. Host tests pin context-before-prompt injection and wire limits. Keyless Web snapshots cover the conversation file row and durable `mineru-ocr` context as well as roster and score persistence through the assembled application without requiring a real MinerU service.
