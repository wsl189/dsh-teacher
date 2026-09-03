# Agent Note: Agent-owned question boundary discovery

Status: implemented

English | [中文](2026-09-03-agent-owned-question-boundary-discovery.zh.md)

> This decision supersedes only the candidate-default compact boundary protocol in [bounded parallel question cutting](../feature/2026-08-26-bounded-parallel-question-cutting.md). Its grouping, concurrency, image ownership, output budgets, and fallback decisions remain current.
>
> The protected-candidate downgrade rule and ownership of non-question blocks are partially superseded by [Agent-classified outside question boundaries](2026-09-03-agent-classified-outside-question-boundaries.md). Complete-source discovery, opaque OCR ids, required tool use, and Host-owned geometry remain current.

## Problem

MinerU preserves the source text and geometry needed to cut a question, but OCR damage can keep a real label out of Host question-head candidates. The compact boundary protocol treated protected candidates as default questions and exposed the remaining candidate list as exact, so the child was instructed to return only exceptions. A child that correctly recognized additional questions from the full OCR was therefore discouraged from submitting them. The same allowlist reached complete-group visual review: a reviewer could report a wholly missing question only on a page where Host candidate rules had already predicted one. A crop containing several independent problems could consequently pass as one collective learner task.

## Decision

The boundary child owns semantic discovery from complete MinerU evidence. Its `questions` argument is the complete ordered list of independent learner questions, not an override list. Any semantic OCR element on a core page may be a submitted head even when it is absent from `possibleQuestionHeadIds`. The child must separate independently answerable numbered, example, and variant tasks instead of describing one crop as a collective demand.

Compact inline evidence is available only when the complete serialized OCR group fits `maxQuestionCompactBoundaryCharacters`. The Host then places every element in `inlineSource`. Larger groups use the bounded source and page-preview tools, so semantic discovery never operates on a candidate-focused excerpt. Both paths retain the existing group, element, character, image, and submission limits. A deployment may add a child wall-clock deadline, but the Web composition defaults to none.

Every boundary, visual-review, and repair child records the logical `toolChoice: required` policy in its request header. The live `questionSegmentationReasoningEnabled` setting defaults to false. When enabled, the child preserves an explicit enabled reasoning effort or selects the model's advertised enabled default, lowest enabled effort, or provider default in that order. When disabled, it selects an advertised Off effort, then the lowest advertised effort or provider default. The adapter maps the tool policy to the strongest value the provider protocol supports. Z.ai-compatible completion routes therefore send `auto`, while the model still sees only evidence and Host-validation tools and the Host still rejects a step that never makes an accepted submission. The Web composition sets no child wall-clock deadline; deployments can set a positive `questionSegmentationAgentTimeoutMs`. Tool restrictions and Host validation determine which calls exist and which submitted drafts become authoritative.

Host candidate detection remains a fallible recall hint, a narrow contradiction check, and the deterministic fallback after boundary-agent failure. Every hinted candidate still receives an explicit question or non-question decision, and a candidate with source-derived learner answer-demand evidence cannot be downgraded. These checks do not add unsubmitted candidates to a successful Agent draft. Compact OCR-only runs continue to assign unlisted images through deterministic geometry because image semantics require the later annotated visual review.

The first complete-group visual review may report a missing independent question on any learner core page. Suggested uncovered heads remain non-exhaustive hints. A question may be missing even when its pixels sit inside an existing magenta region: the reviewer records the missing head and marks the combined crop for content reassignment. A crop verifies only when it contains exactly one independent answer demand. Crop-local recuts remain unable to add unlisted questions or replace the group.

The Host continues to own source identity and geometry. It validates opaque element ids, core-page membership, source order, explicit candidate classification, protected answer-demand evidence, ownership, semantic stops, and crop coordinates. The Agent cannot invent a head or bounding box, and failed semantic discovery still falls back to deterministic candidates before visual review.

## Alternatives considered

**Expand the question-head regular expressions.** More patterns can repair known OCR strings but make recall depend on an open-ended catalogue of publishers and recognition errors. Patterns remain useful hints and safeguards, not the semantic source of truth.

**Keep candidate defaults and ask visual review to split broad crops.** This makes the repair stage compensate for an intentionally incomplete initial draft. It also prevents review from reporting a miss that the same candidate rules failed to predict.

**Let the Agent return coordinates.** Model coordinates are not MinerU facts. Opaque source ids preserve semantic flexibility without transferring geometric authority.

**Rely on a prompt-only submission obligation.** A model can correctly analyze every question and still spend a child run narrating its plan without calling the submission tool. The request policy makes tool use an execution property while leaving draft acceptance with the Host.

## Consequences

- Compact boundary submissions can be larger because they contain every discovered question. The 32,768-token boundary allowance and bounded group size cover that complete draft.
- A group whose complete OCR exceeds the compact character limit spends source-tool turns instead of receiving a shorter focused excerpt.
- Candidate rules can still reject a contradiction or supply degraded output, but adding a new document convention no longer requires a Host pattern before the Agent may use it.
- Complete-group visual repair can replace more boundaries when it discovers a missing question inside a combined crop. Existing complete-draft validation keeps that replacement source-complete.
- Required tool choice uses the strongest provider representation available. A protocol whose strongest representation is `auto` relies on the same restricted tool set, accepted-submission check, and bounded fallback rather than receiving an unsupported wire value.
- The default-off reasoning policy minimizes latency. Enabling reasoning can improve semantic judgment at additional latency; the Web child has no wall-clock deadline, while provider request timeouts and caller cancellation remain effective.

## Testing

Host tests submit three OCR-damaged bracketed heads that are absent from `possibleQuestionHeadIds` and require all three accepted questions. They also require the inline prompt and tool schema to request one complete `questions` draft, preserve explicit decisions for hinted candidates, fall back to source tools when complete inline evidence exceeds its character limit, allow complete-group missing-question findings independent of the hint list, split a missing question out of a combined crop, keep page-only recovery forbidden during crop-local recuts, apply enabled and default-off reasoning selection to boundary, review, and repair children with `toolChoice: required`, and retain the no-deadline default. Adapter and loop tests pin request-header reconstruction plus the DeepSeek and pi-ai wire mappings, including Z.ai `auto` tool choice. The assembled Web question-segmentation test drives the complete-draft schema through the shipped composition.
