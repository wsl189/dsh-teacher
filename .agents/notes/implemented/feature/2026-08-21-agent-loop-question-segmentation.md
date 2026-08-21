# Agent Note: Agent-loop question segmentation

Status: implemented

English | [中文](2026-08-21-agent-loop-question-segmentation.zh.md)

## Problem

Math-paper PDFs do not expose one dependable reading order or page template. Top-level questions may share a page in columns, continue on another page, contain subordinate numbering, or place a diagram after a later question head in OCR order. Titles, instructions, section labels, page furniture, and answer pages can also resemble numbered questions. A browser rule based on number-shaped text and one left margin can therefore omit questions, split subquestions, assign a figure to the next question, or include unrelated material. A model can interpret these semantic roles, but its coordinates and identifiers cannot be trusted as source-document facts.

## Decision

Question Cutting uses MinerU only for provider-neutral page geometry. The browser sends the selected pages to `teacherWorkbench/segmentQuestions`, which starts one short-lived `spawn` subagent under the live Session with the configured tool model and the built-in `question-boundary-detection` runtime skill. The child can call only one run-scoped source tool and one boundary-submission tool. The source tool returns bounded chunks of ordered OCR elements with opaque ids, text, content family, page dimensions, and bounding boxes; every chunk must be inspected before submission.

A boundary draft states the question-head convention inferred from the complete selected range and declares each top-level head id without a printed number. The convention may use arbitrary numeric or textual labels, repeat or restart between chapters, change within a combined source, or rely on recurring semantic starts when exercises have no explicit labels. `additionalElementIds` inside a question transfer OCR elements emitted outside its default interval, including interleaved column continuations and figures. Root-level `excludedElementIds` remove section labels, headers, page numbers, watermarks, and other non-question elements, while `endElementId` marks the first element after the final question. The model never submits coordinates or display numbering. Repeated rejected drafts do not consume a retry.

The Host sorts submitted heads by authoritative OCR ordinal and validates request bounds, element ids, answer boundaries, recognized section-title exclusions, additional-element ownership, crop non-emptiness, and a run-scoped accepted token. It deliberately does not parse or validate the source's numbering syntax; accepted heads receive unique display numbers in source order. An explicitly excluded recognized section heading also excludes its same-page continuation elements up to the next accepted head. Five distinct drafts and a 60-minute wall-clock deadline are available by default. Accepted element sets are mapped back to two-dimensional page coordinates; padding is clamped against neighboring unowned content. Multiple accepted page regions remain one question, and PDF.js rasterizes the original browser-held PDF and vertically joins those regions before persistence.

Before upload, the browser reads the selected OCR provider's current decoded-byte and page limits, copies only the selected source pages into bounded PDF batches, and restores each batch-relative layout index to its original page index. An oversized multi-page batch is bisected until it fits; an oversized single copied page is rasterized at the configured crop scale and progressively reduced until it fits. The original PDF remains browser-held and has no OCR upload-size limit, while each base64 request and MinerU parse remains bounded. The question-layout source is separately chunked by serialized character count so agent-loop spill policy cannot hide later pages from a restricted child.

After OCR layout assembly, the Host assigns a configurable 20 selected pages to each semantic core group and adds one adjacent selected page on each available side for inspection. Every group runs an independent child. The Host keeps a returned question only when its validated head element is on a core page, so overlap resolves continuations without duplicating a boundary question. It assigns the merged questions one unique source-order display sequence, independent of any printed labels. The browser renders one group at a time and further partitions its ordered crops below `maxQuestionBatchBytes`, which defaults to 96 MiB in the Web bundle to leave room for base64 JSON within the default 160 MiB request carrier. The first save part creates one logical paper batch and returns its opaque id; every later part appends to that id, so transport partitioning never creates extra library entries. The byte setting is therefore a per-save-part safeguard rather than a source-PDF or complete-result limit.

## Alternatives considered

**Keep the browser number-and-margin rule.** It is fast but treats reading order and one-column alignment as semantics. It cannot correctly own interleaved column elements, distinguish numbered instructions reliably, or recover page-spanning questions without accumulating template-specific branches.

**Let the model return bounding boxes.** Model coordinates are not source facts and can drift, exceed a page, or omit a figure. Opaque ids keep geometric authority in MinerU output and the Host.

**Send page images directly to a vision model.** This couples cutting to a multimodal route, increases image-token cost, and still needs coordinate validation. MinerU geometry plus the tool model works with the existing provider-neutral OCR seam and crops the original PDF rather than a model-produced image.

**Return the complete layout in one tool call.** Longer selections exceed agent-loop's inline tool-result allowance and spill to a file the restricted child cannot read. Bounded mandatory chunks preserve tool restriction and complete inspection.

**Remove the provider upload limit.** A single unbounded base64 RPC and synchronous MinerU request multiplies memory use and leaves no per-request resource ceiling. Browser-side PDF copying removes the original-file limit while retaining bounded transport and parsing.

## Consequences

- Question cutting incurs one tool-model child loop for each semantic page group after MinerU extraction; the configured group size and per-child limits trade bounded memory for additional calls on long papers.
- The child sees OCR text and geometry, so the selected tool-model provider receives that content according to its deployment policy. The source, draft corrections, and final token are logged in the child Session.
- Numbering restarts, repeated variant labels, and unnumbered exercises all produce one unique persisted source-order display sequence.
- Crop coordinates remain Host-derived and image bytes remain browser-rendered from the original PDF. The model cannot invent an accepted id or coordinate.
- A question absent from MinerU text and non-text elements cannot be recovered. Recognized unexcluded section or answer headings fail instead of producing a silently contaminated crop.

## Testing

Host tests cover titles versus question heads, subordinate questions, cross-page ownership, figures, interleaved columns, multi-line section exclusions, numbering restarts, local variant labels, an unnumbered exercise, answer-page titles, OCR-damaged heads, invented and duplicate ids, automatic source-order normalization, source limits, tool restriction, accepted-token enforcement, generated display numbering, `20/20/5` semantic ownership for 45 pages, overlap-page inspection, duplicate filtering by head page, and continuation-part persistence in one paper batch. MinerU tests cover canonical large base64 input, advertised limits, and sequential `4/4/2` layout batching for a ten-page range. Client tests cover exact-page PDF batching with source-index restoration, byte-limit bisection, oversized single-page raster reduction, decoded-byte save partitioning, page-range parsing, Host segmentation wiring, batch-id propagation, and two-dimensional single-page and multi-page rendering.

Three logged MinerU layouts from desktop PDFs were run through the final Host and configured `qwen3.8:27b` tool model: an eight-page portrait paper with 167 elements completed the agent stage in 32.2 seconds, a four-page portrait paper with 92 elements in 25.0 seconds, and a four-page two-column landscape paper with 103 elements in 52.6 seconds. Each returned questions 1 through 19 without gaps. Pixel review confirmed that the landscape question 17 retained its geometric figure without question 18, the eight-page paper excluded the following section label and answer-page title, and subordinate parts stayed with their top-level question. Combining the recorded MinerU durations with these final agent durations normalizes to about 78 seconds per ten pages, below the ten-minute target.
