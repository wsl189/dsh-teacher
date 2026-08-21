# Agent Note: Tool-model timetable normalization

Status: implemented

English | [中文](2026-08-20-tool-model-timetable-normalization.zh.md)

## Problem

MinerU extracts text and table markup, but school timetables do not share one dependable layout. Merged cells, transposed weekdays and classes, separate morning and evening tables, peripheral grade labels, OCR reading-order errors, and multiple classes in one document make a deterministic Markdown parser accumulate layout-specific branches. Incorrect rows must not become durable timetable entries without review.

Product-owned background AI work also needs a model choice distinct from the conversation default. Free-form provider or model fields would allow settings to name routes absent from the configured model directory and delay the failure until an import runs.

## Decision

The `agent-default-model` settings section stores `toolProvider` and `toolModel` as one validated pair. `currentToolSelection()` returns that pair and falls back to the current default provider and model when both fields are absent. **Settings → Models → Tool model** lists only models from live routes whose configured credential requirements are satisfied and writes both fields in one revision-checked mutation. The UI does not accept a free-form model id.

Before recognition starts, the browser captures the Class, Grade, or Study destination together with its class catalog and current defaults. Every upload first passes through MinerU. Raster images request one enhanced whole-image pass plus overlapping detail regions, while PDF and Office documents use extracted content. The browser parses each detailed OCR document independently, expands weekday headings over ascending class runs, joins split subject and teacher rows, unfolds repeated local period sequences in source order, and deduplicates the resulting slots. A non-empty deterministic result goes directly to editable review. Only an empty result starts one text-agent attempt with the MinerU Markdown. The assembled Web profile gives that fallback child five minutes for inspection and repair.

Each attempt starts a fresh `spawn` subagent loop under the live Session with the tool-model selection, one run-scoped read-only source tool, one matrix-submission tool, and one line-splice patch tool. The agent encodes relevant content in a compact line protocol whose blocks declare constants, two semantic axes, shared cell fields, and tab-separated data rows. It submits the complete matrix once; the Host retains that draft and returns precise parser, axis, dimension, destination, field, and row-limit errors with relevant 1-based lines. Later tool calls splice only rejected lines into the stored draft, so a local correction cannot drop unrelated valid blocks. The final structured output carries only the opaque token for a matrix accepted in the same run. The parser also canonicalizes protocol keywords joined to their first parameter by an opening parenthesis. Destination instructions select relevant business records without prescribing source coordinates, rows, columns, styles, or file types. A generic chronological normalization expands repeated local period headers into distinct later periods when one matrix block presents additional data rows in source order.

The timetable child leaves `maxTokens` unset. The agent loop therefore resolves both the combined `contextWindow` and the adapter-configured output default from the selected tool-model route. A timetable-specific fixed output allowance would consume input capacity independently of the model setting and can turn an otherwise valid request into a context-window rejection.

The Host validates field lengths, weekdays, periods, times, entry count, destination kinds, axes, matrix dimensions, exact fields, and the validation token, then deduplicates class/grade/type/weekday/period slots. It completes a bare numeric class leaf from the source grade and captured class catalog while preserving complete hierarchical class names. A study duty assignment may omit a subject and explicit slot: the Host supplies the semantic `早自习` or `晚自习` label and numbers repeated unnumbered assignments by source order, while ordinary lessons still require a source-supported course and period. Missing services, stale parent Sessions, oversized input, timeouts, model failures, and invalid or empty output return stable failures. The browser turns accepted rows into the existing editable review state; its captured destination and class catalog remain authoritative even when the user changes views during extraction. Class names that do not end in `班` remain unselected, and only explicitly selected rows reach the revisioned bulk import.

## Alternatives considered

**Send every timetable to the agent.** Dense grade tables consume many model turns and may still omit blocks that MinerU already represented as regular rows. Deterministic reconciliation handles recognized table relationships quickly, while the agent remains available for layouts whose extracted structure does not yield any entries.

**Prefer direct model vision for raster uploads.** The tested local multimodal route took longer on the supplied dense grade table and returned incomplete rows. MinerU detail regions preserve a provider-neutral first path and allow successful imports without any model request.

**Use the conversation model selection.** Background extraction can need a faster or cheaper route than interactive conversation, and changing one concern should not silently change the other.

**Allow a free-form tool-model id.** It permits typos and unavailable routes. Restricting the selector to usable configured routes makes the saved choice immediately actionable.

**Import structured output immediately.** Model reconstruction is probabilistic. Editable review remains the authorization point for durable teacher data.

## Consequences

- A raster import performs one enhanced MinerU run and normally opens review without a child Session. It incurs one child loop only when deterministic reconciliation finds no entries.
- On fallback, source metadata, the MinerU source-tool result, validation calls, and workbench defaults are model-visible and logged in the child Session.
- The child can call only its unique read-only source, matrix-submission, and line-splice patch tools. Document instructions cannot authorize actions, and its result is returned to the browser rather than the parent conversation.
- Existing settings remain valid because an absent tool-model pair follows the default model. Saving a new conversation default preserves an explicit tool-model pair.
- The selected tool model owns the fallback request context capacity and output-token default; timetable configuration keeps an absolute source-character safety limit, an accepted-row limit, and a text wall-clock deadline.
- The deterministic parser decides successful MinerU-first imports; the agent handles only extracted sources that produce no rule result.
- Review remains mandatory because OCR and model reconstruction can both be wrong.

## Testing

Service tests cover tool-model fallback and persistence, child selection, destination personas, compact matrix parsing, joined-keyword canonicalization, retained-draft line repair, tool restriction, accepted-token enforcement, hierarchical class completion, study duty normalization, repeated unnumbered study rows, slot deduplication, oversized input, missing services, and invalid output. OCR tests cover the enhanced whole image and six overlapping image regions. Client tests cover captured destination context, MinerU-first rule success, agent fallback after an empty rule result, editable review, bulk import, and Remote wiring. A real upload of the supplied low-resolution grade image to the configured MinerU endpoint reached review in about 25 seconds with 440 entries: 40 for each of 11 classes, 88 for each weekday from Monday through Friday, and 55 for each period from 1 through 8. Visible OCR spelling errors remain, so editable review is still required.
