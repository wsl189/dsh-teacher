# Agent Note: Question Layout Integrity Recovery

Status: implemented

English | [中文](2026-08-24-question-layout-integrity-recovery.zh.md)

> Complements the rendering rule in [Per-Region Question Crop Origin](2026-08-24-per-region-question-crop-origin.md).

## Problem

MinerU multi-page `para_blocks` can attach lines from the top of one page to a paragraph near the bottom of the preceding page. The affected next-page paragraph may remain as an empty `lines_deleted` block even though its same-box `preproc_blocks` entry still contains the original lines. Normalizing `para_blocks` alone therefore moves one question backward and removes it from its source page.

MinerU can also omit an ordinary numbered head or combine content from both halves of a landscape spread even when no cross-page corruption signal is present. Flat source order then interleaves the two columns. A decoration that begins just above the next same-column head can be assigned to the preceding question and extend its rectangular crop across several later questions.

Question-boundary submission was also recall-only: the Host validated ids selected by the child but did not reject an omitted high-confidence question label. Decimal chapter headings were not recognized as section markers, and an explicitly reassigned figure could be taken from an earlier question without a geometric consistency check.

## Decision

MinerU structured normalization accepts a child line only when the center of its bounding box lies inside the enclosing block. A cleaned paragraph with no meaningful element is replaced by the usable same-box preprocessing block. Either repair signal marks the page as suspicious. When a multi-page PDF response contains a suspicious page, the provider requests only that page again as a single-page range and replaces its batch result; unaffected pages keep the original batched result.

After those repairs, a forward gap among ordinary numbered heads on a landscape page triggers two more MinerU requests using left and right half-page PDF crops. Their coordinates are mapped back to the source page. Missing numbered groups are added, and a recovered single-column group replaces the same numbered original only when the original crosses the page divider. Pages without a gap keep the batched result.

The question-segmentation Host recognizes multi-level decimal chapter labels, automatically excludes them, and supplies every bracketed, OCR-damaged `题`-number, or ordinary leading numeric candidate before the answer marker as an authoritative audit list. Each candidate must be selected or explicitly excluded, and an ordinary candidate that closes a gap in the selected numeric sequence cannot be excluded. Invalid or duplicate element references must be corrected but do not consume the complete-draft allowance. The Host rejects a continuation chosen immediately after an excluded numeric candidate, so overlapping OCR copies retain one complete numbered start. On pages with heads in both halves, it assigns unclaimed single-column elements to the latest preceding head on the same side, drops lane-leading elements with no preceding same-side head, and omits unclaimed divider-crossing elements. A crop cannot pass a later selected head in the same horizontal span. Large lower-half labels repeated at nearly the same normalized position on at least three pages are excluded as template decoration, and an associated divider-crossing image is excluded with them. A later page whose first ordinary head restarts at one after a section heading excludes its preamble instead of attaching it to the preceding paper's final question. Excluded boxes that do not overlap owned elements become white erasures, preserving a diagram beside a section heading instead of choosing between the two with one horizontal cut. Explicit additional-element claims still require geometric consistency. The child receives the same requirements in its runtime skill and does not repair same-page column order itself.

## Alternatives considered

**Parse every PDF one page at a time.** This avoids MinerU's cross-page merge behavior but multiplies requests and discards the normal throughput benefit of bounded page batches.

**Split every landscape page into columns.** This would make ordinary pages pay twice and can damage a legitimate full-width layout. A forward numeric gap limits the extra work to pages with direct evidence of lost content.

**Use `preproc_blocks` for every page.** Preprocessing geometry has higher recall, but replacing all cleaned paragraph order would change unaffected documents. Same-box recovery keeps the cleaned result unless it has lost content.

**Attach previews to every segmentation child.** The active tool model and subagent protocol support logged image attachments, but unconditional page images add rendering, context, and vision latency while still requiring trusted element ids for cropping. Deterministic column recovery, spatial ownership, and candidate coverage address these failure signals directly. A future visual fallback can attach a small set of annotated suspicious pages when the deterministic checks cannot produce an accepted draft.

## Consequences

Clean multi-page layouts keep one MinerU request per configured batch. A damaged response pays for single-page requests only for marked pages; a numbered landscape gap pays for two half-page requests. Source page indexes remain stable after replacement. If targeted recovery returns an unexpected page count, structured extraction fails instead of silently accepting shifted geometry.

Bracketed workbook questions, ordinary numbered gaps, and decimal chapter transitions can no longer silently disappear inside the preceding crop. Same-page columns do not depend on model-authored attachment lists, later question pixels remain outside an earlier rectangle, and excluded labels can be erased without cutting adjacent question content. Provider, Host validator, browser renderer, and ordinary-conversation renderer have focused regressions for cross-page and half-page restoration, omitted and displaced candidates, column ownership, crop stops, white erasures, and right-column pixel exclusion.
