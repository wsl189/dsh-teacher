# Agent Note: Question-local crop repair fallback

Status: implemented

English | [中文](2026-09-05-question-local-repair-fallback.zh.md)

## Problem

A crop-specific visual finding already identifies the question whose pixels are wrong, but a rejected repair submission could still fail the complete processing group. Review timeouts and provider errors before that finding could also discard preliminary crops whose geometry had already passed Host validation. Large PDFs then stopped before later groups even though the Host still held safe geometry for every question. The [correctable boundary decision](2026-09-04-question-boundary-corrections.md) keeps repair scope and diagnostics precise; this note replaces the fail-closed consequence throughout visual review once preliminary boundaries exist.

## Decision

Boundary detection cannot save a rejected draft because no safe crop geometry exists before Host acceptance, but a recoverable boundary failure is isolated to that page group rather than propagated across the PDF. All sibling groups continue. The failed group enters complete-page visual review with an empty preliminary question list, allowing the pixel-backed repair path to reconstruct valid boundaries. If that review also fails, the group is marked unverified and skipped. A corrected valid draft is accepted even after the rejected-complete-draft allowance has been used; actually exceeding that allowance ends the current child immediately instead of spending its remaining failed-call budget on the same limit diagnostic. Boundary and review stages receive up to three fresh children by default.

Once preliminary boundaries provide Host-validated crops, visual classification is best effort: preview preparation, timeout, provider or model failure, invalid output, a thrown review call, or teardown failure retains the current safe group instead of aborting the PDF. If no complete defect set exists, every question in the current review scope is marked unverified because a narrower affected set is not yet known.

After complete findings identify existing crops, repair exhaustion, timeout, or model stop returns an `unresolved` crop-review result with only the cited `affectedQuestionIds`. Page-only missing-question findings still affect the complete group because no existing crop identifies the omitted task. The returned questions are always the latest Host-validated group geometry; rejected model arguments are never promoted to saved regions.

Callers rerender only `affectedQuestionIds` after each accepted correction. They apply at most three local revisions and perform a final visual review. A returned review error, thrown review call, unfinished preview, final change request, or `unresolved` decision all save the latest safe crop, count the applicable questions in a completed-job warning, and continue later groups. The ordinary-conversation pipeline saves the same latest safe group and reports it through `unverifiedGroupCount`.

## Alternatives considered

**Fail the processing group after one crop cannot converge.** This prevents uncertain output but discards unrelated verified work and stops later groups in a large document.

**Save the last rejected repair arguments.** A rejected draft can clip learner content, cross another head, or reference the wrong element type. Only the last Host-validated geometry is eligible for fallback persistence.

## Consequences

An unverified crop can still contain the visual defect that triggered repair, and an unverified empty group may contain omitted questions, so the progress row presents separate question and group warnings rather than silently claiming full verification. Invalid OCR input, systemic model or vision configuration failure, final crop rendering failure, and durable-write failure remain terminal. Ordinary-conversation cutting can finish without creating an empty batch when every group is confirmed empty or remains unverified. Focused Host and browser tests cover exact affected ids, acceptance after the rejected-draft allowance, recoverable boundary-group isolation, three accepted revisions plus a final unresolved review, returned and thrown review failures, persistence of the latest safe pixels, continuation into later groups, and assembled-Web repair-budget exhaustion.
