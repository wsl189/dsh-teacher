# Agent Note: Bounded parallel question cutting

Status: implemented

English | [中文](2026-08-26-bounded-parallel-question-cutting.zh.md)

> The candidate-default compact boundary protocol is superseded by [Agent-owned question boundary discovery](../architecture/2026-09-03-agent-owned-question-boundary-discovery.md). Bounded grouping, concurrency, automatic compact image ownership, output budgets, and fallback remain current.

## Problem

Question segmentation owns independent semantic page groups, but serial boundary detection and serial visual review make total latency grow with every group even when no group shares mutable question ownership with another. Crop review also becomes a long agent loop when the model submits one classification per tool call after already inspecting the complete image set.

The shared normalized crop-width ratio does not guarantee an exact shared raster width. PDF pages whose rendered viewports differ by one or more pixels produce different rounded target widths, so images from one paper can violate an equal-width requirement despite using the same semantic lane ratio.

## Decision

One semantic group owns at most 20 selected pages and 300 fallible question-head candidates by default, while one unusually dense page remains indivisible. Boundary detection processes independently owned groups through the configurable `questionSegmentationConcurrency` limit, which defaults to two. Browser and ordinary-conversation visual review use the same advertised limit. Recut attempts inside one group remain sequential because each attempt consumes the geometry and findings returned by the preceding attempt. Compact page sheets retain five readable annotated pages, while crop sheets preserve review width and pack up to nine actual-height crops. Groups whose combined sheet count stays within image admission can therefore inspect every source page and crop in one tool round trip.

The shared zero-dependency `mapConcurrently` primitive preserves group-index order in the merged result. After one group fails, it stops admitting new groups, waits for every in-flight group to settle, and only then returns the source-order failure. Final rendering and append saves remain source ordered, so concurrency does not reorder question numbers or persisted images. The browser bundle may inline this identity-free utility; Host consumers use its workspace package dependency.

When one bounded OCR chunk contains a semantic group, the Host places focused source evidence in the boundary child's initial request. That evidence keeps every ambiguous head, representative accepted heads, and each page edge, then expands adjacent OCR context in source order up to `maxQuestionCompactBoundaryCharacters`; the Web default is 24,000 characters. The Host accepts high-confidence question heads through generic answer-demand and geometry evidence, including independently answerable bracketed or bare `题 N 变式 N`, `变式 N`, example, and worked-example labels, then publishes `unprotectedQuestionHeadIds` as the exact remaining classification set. The child returns only false-positive decisions, missing heads, and ownership or stop exceptions instead of rediscovering defaults or spending source-tool turns. An override that uses an explicit stop to own one source element is rejected unless that head has visible answer-demand evidence. This compact child disables reasoning effort and has its own configurable 32,768-token output limit. Groups that exceed one source chunk retain the progressive source and page-preview tool protocol and the selected model profile's output policy.

Deterministic protection also recognizes compound example-variant labels, explicit multi-part requests, named mathematical outputs, and punctuation-only answer blanks such as `=.`. These source-derived signals protect an independently answerable head from a false-negative child decision without encoding a document coordinate or title.

Image classification follows the same learner-page scope as question-head classification. Images on answer-section pages remain semantic stop context and are neither exposed as ownership candidates nor required by boundary submission or deterministic fallback. This symmetry prevents a solution diagram from blocking an otherwise valid question set.

Visual tools return up to 20 images per call by default, bounded further by the attachment provider. Compact review packs all annotated source-page and rendered-crop sheets inside that admission limit and requires the child to request every listed sheet id in one call. The child then submits one complete classification: `verifiedCropIds` must cover every complete crop, while `findings` may be omitted only when that verified list covers every requested crop. Each defect names the visible proving pixels in `issue`, declares every applicable `repairIntents` value, and may add separate `evidence`. The Host rejects partial image inspection, partial or contradictory crop coverage, missing source problems without a visible head, and repair intents inconsistent with the submitted correction. OCR inspection and local recuts remain available only after the complete classification records a defect.

Compact visual review and repair children have a configurable 32,768-token output limit. Every fresh boundary, visual-review, and repair child receives an independent 50-second Web deadline, so source inspection performed by one child cannot consume the correction time of the next child. Three identical rejected tool results stop the current child. A boundary timeout, model error, missing accepted draft, or unavailable boundary vision falls back to the Host's generic answer-demand candidates and still proceeds through visual review. A visual-review timeout, model error, invalid output, unavailable service, or teardown failure retains the current geometry as unresolved. The caller marks that group unverified immediately instead of spending another full review deadline on unchanged evidence. A selected range confirmed to contain no learner questions completes without creating an empty paper batch.

Crop-local review pages gray-mask every horizontal lane that contains no listed crop region. Pixels in a masked lane cannot support a missing-content, continuation, option, figure, or contamination finding. Unmasked questions in the reviewed lane remain visible as read-only boundary context, and adjacent pages without a listed region remain unmasked so cross-page continuation can still be verified.

When a continuation page has multiple accepted same-page questions, lane reassignment retains page-leading option, subpart, or answer-demand elements under the prior page's ordinal owner. The next accepted head or semantic boundary remains the stop, preventing either continuation loss or ownership of the following question.

Exhausting the per-group recut allowance or receiving an unresolved review is a quality result rather than an operation failure. The caller retains the latest Host-validated regions, marks that group unverified, and continues ordered rendering and persistence for the complete PDF. Only a concrete revised result consumes another local recut. Browser progress and the ordinary-conversation tool result report the unverified-group count. The Web bundle sends up to five pages in one normal MinerU layout request. A failed multi-page request is bisected recursively so a provider peak-memory failure can recover with smaller batches; only a failed single page, rendering, cancellation, or persistence still fails the operation.

Both raster implementations calculate one target pixel width from the widest selected PDF page viewport and the validated document-wide safe-lane ratio. Review corrections may expand this ratio but cannot shrink the planned safe lane. Every question canvas in that paper uses this exact target width. Each source slice still samples only through its own `rightLimit`; any remainder is white padding, so exact width does not import neighboring-column pixels.

## Alternatives considered

**Keep every group serial.** This is simpler but spends independent model latency in sequence and cannot meet interactive throughput as page count grows.

**Run every group without a limit.** Unbounded model, attachment, PDF rendering, and memory demand can overload a local provider or browser. The explicit limit gives deployments one load-control setting for boundary and review agents.

**Submit one crop classification per tool call.** Incremental records reduce one argument's size, but they add a model turn for every crop after the same images are already present. One Host-validated complete submission retains per-crop evidence without the repeated loop transitions.

**Choose a fixed configured image width.** A deployment-specific pixel width would either upscale narrow pages or clip wide pages and would ignore the selected render scale. Deriving one width from the current PDF preserves source resolution and equal-width output together.

**Fail the complete PDF when one group remains unverified.** This prevents access to every accepted group and discards the latest safe output even though visual-review disagreement is not a rendering or persistence failure. Retaining the group with an explicit warning preserves recoverable work and identifies the scope that needs manual inspection.

## Consequences

- Independent group agents may compete for provider capacity, attachment processing, and PDF decoding up to the configured limit. Deployments with constrained local models can reduce `questionSegmentationConcurrency` without changing question ownership or validation.
- Larger default groups and image reads reduce model round trips, but one group can carry more OCR and visual evidence. Existing page, candidate, image, element, character, and wall-clock limits remain enforceable.
- Compact boundary and review children reserve a 32,768-token task allowance so a model can finish a Host submission after inspecting the bounded evidence. Deployments may lower the two compact output settings only when the selected model reliably submits within the smaller allowance.
- A complete crop-classification argument is larger than one incremental record. Its arrays are still bounded by the group's candidate limit, and rejected coverage never unlocks OCR correction.
- Exact shared raster width can add white space to questions drawn from narrower pages. That padding is intentional and does not expand source sampling.
- An unverified group can contain an imperfect crop. Its explicit count lets the user inspect that subset without losing accepted groups or the latest safe boundary revision.

## Testing

Host tests prove the boundary-agent concurrency limit, source-order merge, failure admission stop, in-flight quiescence, exact unprotected-candidate classification, the focused source budget, rejection of unsupported one-element overrides, compact output overrides, deterministic boundary fallback, repeated-rejection termination, failed-layout batch bisection, all-sheet review admission, safe omission of an empty findings array, unrelated-lane pixel masking, and retention after review exhaustion. Browser-controller tests prove independent reviews overlap, unresolved output is saved after one review pass, zero-question selections complete without a batch, unverified groups are reported, and final saves remain ordered. Browser raster tests use different PDF viewport widths and require byte-metadata widths to be identical. The assembled Web question-segmentation snapshot pins the batch-only findings schema and masked-lane evidence rule.

The answer-section image fixture requires both a directly submitted answer-only group and deterministic learner-question fallback to complete without assigning a solution diagram to a question.
