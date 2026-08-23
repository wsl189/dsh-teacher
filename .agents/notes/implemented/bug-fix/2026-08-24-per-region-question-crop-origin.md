# Agent Note: Per-Region Question Crop Origin

Status: implemented

English | [中文](2026-08-24-per-region-question-crop-origin.zh.md)

> Refines the crop geometry in [Question Segmentation Workbench](../feature/2026-08-19-question-segmentation-workbench.md).

## Problem

Validated question regions retain their own left, top, right, and bottom coordinates, but both PDF renderers replaced every region's horizontal coordinates with the minimum left and maximum right coordinates from the complete PDF. That span approaches a full page when a paper uses two columns, so a left-column question includes content from the right column and every saved image becomes nearly page-wide.

## Decision

After all semantic page groups merge, the Host computes `maxQuestionWidthRatio` as the maximum `(right - left) / pageWidth` across accepted question regions. The segmentation result carries this one normalized width to both renderers.

The browser PDF.js renderer and the ordinary-conversation Host renderer preserve each region's own left, top, and bottom coordinates. Each renderer places the right edge one maximum normalized width after that region's left edge and clamps it to the source page. A multi-page question applies the same rule independently to every page slice before the slices are joined vertically.

## Alternatives considered

**Use the PDF-wide minimum left and maximum right coordinates.** This makes equal-size pages produce one width, but it discards column ownership and caused the page-wide crops this decision corrects.

**Keep every region's original right edge.** This preserves columns, but produces variable crop widths and does not satisfy the workbench requirement to use the widest accepted question consistently.

**Detect page columns separately.** The accepted region's left coordinate already identifies its horizontal origin. A second column classifier would add layout assumptions and another failure mode without changing the required calculation.

## Consequences

Questions in different columns keep different horizontal origins while normally receiving one consistent pixel width on equal-size pages. A region near the page's right edge can be narrower because source pixels do not exist beyond the page.

A genuinely wide accepted question increases the width used by every crop. Existing saved images are not rewritten; users recut a source PDF to apply this geometry. Client and Host regressions use horizontally separated regions and assert that each renderer starts from the region-local left coordinate.
