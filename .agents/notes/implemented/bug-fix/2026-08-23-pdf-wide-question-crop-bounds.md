# Agent Note: PDF-wide question crop bounds

Status: implemented

English | [中文](2026-08-23-pdf-wide-question-crop-bounds.zh.md)

## Problem

If each question image uses its own horizontal question-box coordinates, consumers that fit images to one content width can display narrow questions larger than wide questions. Long PDFs also run semantic segmentation in multiple groups, so group-local coordinates cannot preserve one scale across the complete source PDF.

## Decision

After all semantic groups merge, `teacherWorkbench/segmentQuestions` computes PDF-wide normalized horizontal crop bounds. The left bound is the minimum accepted `region.left / region.pageWidth`, and the right bound is the maximum accepted `region.right / region.pageWidth`. These coordinates originate from the trusted MinerU layout regions selected for the questions. An empty result carries neutral full-page bounds.

The browser and ordinary-conversation renderers use a two-pass crop equivalent to the reference implementation: first compute the PDF-wide left and right bounds, then directly crop every original page slice between those horizontal coordinates while retaining the question's own top and bottom coordinates. Source and destination pixel dimensions remain equal. Multi-page questions join the slices vertically and left-align them. The browser receives the complete-PDF bounds before rendering any save group, so transport batching does not change image width. The `segment_pdf` conversation tool uses the same service result and Host renderer; the boundary child cannot select a per-question scale or width.

This decision refines [Question Segmentation Workbench](../feature/2026-08-19-question-segmentation-workbench.md), applies after the semantic grouping defined by [Agent-loop Question Segmentation](../feature/2026-08-21-agent-loop-question-segmentation.md), and governs the `segment_pdf` path introduced by [Conversation-operated Teacher Workbench](../feature/2026-08-22-conversation-operated-teacher-workbench.md).

## Alternatives considered

**Resize each tight crop to one output width.** Resampling would change the apparent font and diagram scale between questions.

**Place each tight crop on a shared white canvas.** Padding preserves scale but omits original page pixels between a question's tight box and the PDF-wide coordinates, so it does not implement the reference source crop.

**Compute bounds per semantic or save group.** Group-local bounds can produce different image widths within one PDF and make transport partitioning visible in document output.

## Consequences

- Questions from equal-size source pages have equal output widths and retain the source raster scale. Differently sized pages retain that scale while pixel widths follow page dimensions.
- Every original-page pixel between the shared horizontal coordinates is included. On multi-column papers, content from another column can therefore appear when it overlaps a question's vertical range.
- The wider direct crop can increase stored image bytes, but existing decoded-byte save partitions continue to bound each request.
- The model remains responsible for semantic element ownership, while the Host owns the PDF-wide crop coordinates and raster scale.

## Verification

Focused Host tests cover PDF-wide bounds across semantic groups and the neutral empty result. Client raster tests prove both questions use the same source `x0`, `x1`, and width without resizing or horizontal padding. The ordinary-conversation test covers different per-question boxes producing equal stored image widths. The assembled keyless snapshot records the returned bounds and the `segment_pdf` model-visible guarantee.
