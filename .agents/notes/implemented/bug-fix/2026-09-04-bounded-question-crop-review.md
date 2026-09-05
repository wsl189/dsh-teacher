# Agent Note: Bounded question crop review

Status: implemented

English | [中文](2026-09-04-bounded-question-crop-review.zh.md)

## Problem

A disabled-thinking run spent more than twenty minutes rewriting a 63-crop visual report. Different rejection messages had independent counters, and schema errors bypassed tool execution entirely. Missing accepted output could also become a deterministic boundary draft or an unverified saved crop, hiding failure rather than finishing the review.

## Decision

The [question processor](../../../../packages/host/teacher-workbench/README.md) counts consecutive failed calls in the same normalized diagnostic category inside each child. Semantic rejections consume the budget inside execution; the tool finalizer also counts schema and dispatch failures. A different diagnostic resets the consecutive count. Exhaustion concludes or cancels that child; an allowed fresh boundary or pre-finding recovery child starts with a new budget, as does each bounded repair child. Each child has a configurable five-minute deadline by default, including separate review and repair children, without imposing a whole-PDF deadline.

The Web profile and service defaults use four core pages per group, retain adjacent continuation context and two concurrent groups, and limit compact review output to 8,192 tokens. Reports use short identifying clauses. Both browser and Host source pipelines require visual acceptance for verified status. They apply at most three accepted crop revisions and then perform a final verification pass. Validated deletion-only revisions need no further pixel inspection when no changed crop remains. Missing accepted boundary drafts remain errors because they provide no crop geometry. Once preliminary crops exist, any visual-review failure uses the [question-local repair fallback](2026-09-05-question-local-repair-fallback.md); complete findings retain exact crop scope, while pre-finding failures mark the current review scope unverified.

## Alternatives considered

**Only disable thinking.** The observed run already had thinking disabled; report generation and failed tool calls consumed its time.

**Incrementally accept individual crop records.** This could avoid repeating valid entries, but changes the complete-group coverage protocol and risks missing independent source questions. Smaller existing page groups reduce report size without weakening coverage checks.

**Save the model's last rejected geometry.** This can publish a clipped, crossed, or otherwise invalid crop. The fallback saves only geometry already accepted by the Host validator and labels affected questions as unverified.

## Consequences

More page groups repeat some adjacent-page context and model startup overhead. Five minutes may be insufficient for a particularly slow local model; the deadline and group size remain configurable. Single unusually dense pages are not subdivided. The browser queue still requires the page to remain open and is not durable across reloads. No fixed speedup is promised for successful runs.

The tool-runtime regression mixes semantic and schema errors and records their normalized results. The assembled Web scenario exercises bounded repair failure in a real child loop. Controller and Host source tests require exact affected ids, preserve the third Host-validated revision after a final unresolved review, retain current crops after returned or thrown review failures, and continue later groups. Boundary failures still require accepted output; visual pre-finding failures no longer abort once preliminary crops exist.
