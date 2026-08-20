# Agent Note: Reusable Document Extraction

Status: implemented

English | [中文](2026-08-18-reusable-document-extraction.zh.md)

## Problem

The teacher workbench needs to recognize dates and activities from school calendars supplied as images or Office documents, while the conversation composer needs extracted document text that a user can discuss with the model. Binding both flows directly to MinerU would duplicate upload, limits, errors, and transport behavior and would make each browser feature own a vendor protocol. Automatically writing OCR output to the calendar would also turn imperfect table recognition into durable teacher data without review.

Document bytes and extracted text have different durability requirements. The original file only needs to reach the configured extractor. Conversation text becomes model-visible only after the user sends it and must therefore use the ordinary logged user-message path. Calendar activities must enter the existing revisioned teacher-workbench document rather than a separate OCR store.

## Decision

`@deepseek-ai/dsh-ocr` defines `ctx.ocr`, provider registration and execution-time selection, stable request/result/error types, and the Typert `ocr.extract` Remote. It auto-selects only when exactly one locally available provider exists; an explicit `provider` id otherwise owns selection. Requests carry one canonical-base64 document with its name and media type and may ask the provider to retain text classified outside the main reading order. Successful results carry bounded reading-order Markdown, provider identity, and a truncation flag. The runtime converts expected `OcrError` values into safe result data and hides unexpected provider diagnostics.

`@deepseek-ai/dsh-ocr-mineru` registers provider id `mineru` and adapts the self-hosted synchronous `/file_parse` API. Its ordinary DSH plugin configuration owns the endpoint, backend, hybrid effort, language, deadline, upload limit, response-byte limit, and Markdown-character limit; a card under **Settings → Plugins → Plugin configuration** exposes every field through the revisioned settings document. The provider accepts PDF, supported raster images, DOCX, PPTX, and XLSX; validates names, canonical base64, extensions, sizes, HTTP status, response bytes, JSON fields, and non-empty Markdown; and never persists source bytes or provider output. An extraction that requests discarded text obtains `middle_json` in the same MinerU call and prepends unique discarded lines that do not already occur in the Markdown.

The conversation Consumer exposes one paperclip for existing image attachments and extractable documents. Extracted Markdown is appended to the visible draft inside a `<document name="...">` wrapper, with an explicit truncation marker when needed. The user can edit or remove it before sending. Sending follows the existing prompt path, so the wrapper and Markdown are reconstructed from the ordinary logged `user/message`; raw document bytes never reach the Session log or model.

The teacher-workbench Consumer exposes school-calendar recognition only in the expanded calendar. MinerU Markdown and HTML tables are projected deterministically into dated review rows; the HTML projection resolves row and column spans before it separates activity columns from responsibility metadata. The teacher can select, edit, or remove rows before one compare-and-set mutation appends the accepted calendar items. Raw uploads, extracted Markdown, and unselected review rows remain browser-transient; the [durable teacher-workbench decision](2026-08-17-durable-teacher-workbench.md) remains the owner of calendar-item storage.

## Alternatives considered

**Call MinerU separately from each browser feature.** This duplicates vendor multipart fields, format validation, resource limits, diagnostics, and settings, and prevents another extractor from serving both Consumers.

**Expose MinerU as a model-facing tool.** Uploading a local browser file is a human intake action, not autonomous model work. A tool would not provide the calendar review interaction and would add a schema to every agent even when no document is uploaded.

**Send the raw document to the conversation model.** Provider file capabilities vary, source files are larger than extracted text, and raw-file persistence would require a durable attachment and access-policy design. The current Consumer makes the exact extracted text visible before it enters the logged message.

**Import every recognized calendar row immediately.** OCR and table reading can confuse merged cells, metadata columns, or date ranges. Editable review prevents provider output from becoming authoritative teacher data without an explicit selection.

**Store recognized calendars in an OCR-specific database.** That splits calendar authority and revision conflicts across two stores. Accepted activities are ordinary `TeacherCalendarItem` values and belong in the existing revisioned workbench document.

**Include discarded text in every extraction.** Conversation documents and school calendars do not need repeated page titles, headers, or footer dates. Consumer opt-in retains peripheral text only for layouts whose interpretation depends on it.

## Consequences

- One configured extractor serves conversation and workbench Consumers, and provider replacement does not change their upload or result types. Discarded-text extraction can increase a response but does not require a second provider call.
- The configured MinerU endpoint receives complete selected documents. Deployments must choose an endpoint whose access and retention policy fits those documents; loopback remains the default.
- Base64 JSON transport holds one complete file in browser and Host memory and expands wire size. Provider deadlines and byte limits bound work, but streaming, progress, cancellation, and extraction caching remain absent.
- Conversation document text is model-visible only as an editable ordinary user message, so existing Session durability and KV-prefix behavior apply without a new event type.
- Calendar recognition favors false negatives over unreviewed writes. Dense tables, scans, handwriting, and layouts without recognizable dates may require manual corrections or produce no rows.

## Testing

Capability tests pin provider selection, disposal, safe diagnostics, multipart fields including hybrid effort and optional discarded text, canonical base64, format and size rejection, response validation, truncation, and MinerU failures. Client tests pin document-to-draft framing, image-intake compatibility, row- and column-spanning table projection, inline date references, editable selection, and one-write calendar import. The assembled Web composition exposes OCR settings and both browser Consumers without requiring a real MinerU service for keyless startup.
