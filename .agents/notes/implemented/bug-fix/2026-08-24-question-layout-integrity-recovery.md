# Agent Note: Question Layout Integrity Recovery

Status: implemented

English | [中文](2026-08-24-question-layout-integrity-recovery.zh.md)

> Complements the rendering rule in [Per-Region Question Crop Origin](2026-08-24-per-region-question-crop-origin.md).

## Problem

MinerU multi-page `para_blocks` can attach lines from the top of one page to a paragraph near the bottom of the preceding page. The affected next-page paragraph may remain as an empty `lines_deleted` block even though its same-box `preproc_blocks` entry still contains the original lines. Normalizing `para_blocks` alone therefore moves one question backward and removes it from its source page.

Question-boundary submission was also recall-only: the Host validated ids selected by the child but did not reject an omitted high-confidence question label. Decimal chapter headings were not recognized as section boundaries, and an explicitly reassigned figure could be taken from an earlier question without a geometric consistency check.

## Decision

MinerU structured normalization accepts a child line only when the center of its bounding box lies inside the enclosing block. A cleaned paragraph with no meaningful element is replaced by the usable same-box preprocessing block. Either repair signal marks the page as suspicious. When a multi-page PDF response contains a suspicious page, the provider requests only that page again as a single-page range and replaces its batch result; unaffected pages keep the original batched result.

The question-boundary Host recognizes multi-level decimal chapter labels and requires every bracketed or OCR-damaged `题`-number candidate before the answer boundary to be selected as a head. It also rejects an additional element assigned to a later question when the element overlaps another selected head's vertical band on the same page but not its proposed owner's band. The child receives the same requirements in its runtime skill so a rejected draft can be corrected without inventing geometry.

## Alternatives considered

**Parse every PDF one page at a time.** This avoids MinerU's cross-page merge behavior but multiplies requests and discards the normal throughput benefit of bounded page batches.

**Use `preproc_blocks` for every page.** Preprocessing geometry has higher recall, but replacing all cleaned paragraph order would change unaffected documents. Same-box recovery keeps the cleaned result unless it has lost content.

**Attach previews to every segmentation child.** The active tool model and subagent protocol support logged image attachments, but unconditional page images add rendering, context, and vision latency while still requiring trusted element ids for cropping. Deterministic geometry repair and candidate coverage address these failure signals directly. A future visual fallback can attach a small set of annotated suspicious pages when the deterministic checks cannot produce an accepted draft.

## Consequences

Clean multi-page layouts keep one MinerU request per configured batch. A damaged response pays for single-page requests only for marked pages, and source page indexes remain stable after replacement. If targeted recovery returns an unexpected page count, structured extraction fails instead of silently accepting shifted geometry.

Bracketed workbook questions and decimal chapter transitions can no longer disappear inside the preceding crop. Cross-column figure reassignment must agree with selected-head geometry. Provider, Host validator, browser renderer, and ordinary-conversation renderer have focused regressions for cross-page restoration, omitted candidates, incorrect attachment ownership, and right-column pixel exclusion.
