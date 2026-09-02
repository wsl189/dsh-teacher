# Agent Note: Agent-classified outside question boundaries

Status: implemented

English | [中文](2026-09-03-agent-classified-outside-question-boundaries.zh.md)

> This decision partially supersedes the protected-candidate downgrade rule in [Agent-owned question boundary discovery](2026-09-03-agent-owned-question-boundary-discovery.md). Its complete-source discovery, opaque OCR ids, required tool use, and Host-owned geometry remain current.

## Problem

The boundary Agent can recognize that a later paper title, paper preamble, numbered summary, or answer block is not a learner question, but the submission protocol could not preserve that complete semantic decision. `nonQuestionHeadElementIds` meant only that an element was not a top-level head and deliberately kept it eligible as question content. Unless the Agent also supplied a question-local stop or pixel exclusion, automatic source-order ownership could append the outside block to the preceding paper's final question. Generic answer-demand patterns could also mark a numbered summary as protected and prevent the Agent from rejecting it after inspecting the complete source.

## Decision

Boundary and complete-group repair drafts accept `outsideBoundaryElementIds`. Each id names the first semantic OCR element of a document-level title, later-paper preamble, summary, answer, or other block that belongs to no question. The Host omits that marker from crops and applies it as a source-order ownership stop across page lanes. Automatic ownership resumes only at a later submitted question head, so intervening preamble and summary elements remain unowned without requiring the Agent to enumerate every line.

The protocol keeps `nonQuestionHeadElementIds` separate. A retained non-head may still be a subpart, continuation, or other content inside a question; an outside boundary states that the following block cannot belong to the preceding question. A possible question-head candidate receives an explicit classification when it is submitted as a question, retained non-head, outside boundary, or inspected pixel exclusion.

Protected answer-demand candidates remain strong recall hints and deterministic fallback inputs, not semantic authority over an accepted complete-source draft. The Host still rejects a protected candidate classified only as retained non-head. The Agent may override the hint only by submitting the same id as an outside boundary, which records the stronger claim that the complete source proves a non-question block. When no Agent draft is accepted, the existing fallback continues to retain protected candidates before visual review.

The Host validates that every outside boundary is a unique inspected semantic OCR element and does not conflict with a question head or explicit pixel exclusion. An outside boundary is a global document-block stop; `stopBeforeElementId` remains a question-local exception. The Agent still returns source ids rather than coordinates, and the Host continues to derive and validate crop geometry.

## Alternatives considered

**Expand document-title and summary patterns.** Additional patterns cover only known publishers and wording. They cannot express the Agent's complete-source judgment and preserve the same false-positive pressure on numbered summaries.

**Treat every retained non-head as an ownership stop.** Options, subparts, citations, and continuations are often valid question content even when they are not top-level heads. Reusing `nonQuestionHeadElementIds` would erase that distinction.

**Remove protected candidate evidence.** The evidence still prevents accidental false-negative classification and supplies useful degraded output after Agent failure. An explicit outside classification gives complete-source semantics a controlled override without discarding the fallback.

**Require raw coordinates or an end id for every question.** Raw coordinates transfer authority away from MinerU, while a mandatory local end repeats the same document-block decision for every preceding question. One outside marker records the semantic transition directly.

## Consequences

- Combined-paper titles, instructions, and summaries can remain outside both the preceding final question and the following first question.
- The Agent must distinguish retained non-head content from a block that belongs to no question; using a global outside boundary for a lane-local continuation can truncate valid ownership and remains subject to visual review.
- Protected candidate patterns no longer force a numbered summary into an accepted Agent draft, but they remain conservative unless the Agent records the explicit outside classification.
- Boundary and repair tool schemas, prompts, package documentation, and source-complete tests carry the additional field.

## Testing

Host tests require an unknown outside id to fail validation, allow a protected numbered summary to produce zero questions only through an explicit outside boundary, and prove that one boundary excludes a same-page restarted-paper preamble without enumerating each preamble line. A cross-page combined-paper test proves that a later paper title globally stops the preceding final question without a question-local `stopBeforeElementId`. The focused question-segmentation suite and package typecheck cover the accepted and rejected paths.
