# Agent Note: Per-Region Question Crop Origin

Status: implemented

English | [中文](2026-08-24-per-region-question-crop-origin.zh.md)

> Refines the crop geometry in [Question Segmentation Workbench](../feature/2026-08-19-question-segmentation-workbench.md).

## Problem

Validated question regions retain their own left, top, right, and bottom coordinates, but both PDF renderers replaced every region's horizontal coordinates with the minimum left and maximum right coordinates from the complete PDF. That span approaches a full page when a paper uses two columns, so a left-column question includes content from the right column and every saved image becomes nearly page-wide.

## Decision

After all semantic page groups merge, the Host computes `maxQuestionWidthRatio` as the maximum `(right - left) / pageWidth` across accepted question regions. The segmentation result carries this one normalized width to both renderers.

For each page slice, the Host also records `rightLimit`: the nearest left edge of vertically overlapping content outside that question, or the source page edge when no such content exists. This value is a hard source-pixel limit independent of the region's content-derived `right` coordinate.

When accepted heads occupy both halves of one page, unclaimed single-column elements use the latest preceding head on the same side; unclaimed divider-crossing elements do not enlarge either column. A later head in the same horizontal span is also a hard vertical stop. Semantically excluded boxes that do not overlap an owned element are carried as `excludedAreas` rather than forcing one horizontal stop through adjacent content.

The browser PDF.js renderer and the ordinary-conversation Host renderer preserve each region's own left, top, and bottom coordinates. Each renderer samples at most one maximum normalized width after that region's left edge, capped by `rightLimit`, then paints `excludedAreas` white. It places those unscaled source pixels on a white canvas whose width still equals the maximum normalized width. A multi-page question applies the same rule independently to every page slice before the slices are joined vertically.

## Alternatives considered

**Use the PDF-wide minimum left and maximum right coordinates.** This makes equal-size pages produce one width, but it discards column ownership and caused the page-wide crops this decision corrects.

**Keep every region's original right edge.** This preserves columns, but produces variable output widths and does not satisfy the workbench requirement to use the widest accepted question consistently.

**Clamp only at the source page edge.** This preserves equal output widths but still samples a neighboring column whenever a wide question elsewhere in the PDF increases the shared width.

**Classify arbitrary page-column topology before cropping.** A general column model is unnecessary for the observed two-page spreads. Accepted heads on each side provide the ownership evidence, and the nearest vertically overlapping non-owned element supplies a local pixel limit without assuming fixed column widths.

## Consequences

Questions in different columns keep different horizontal origins and one consistent output width on equal-size pages. A region constrained by a page edge or neighboring column has white space to its right instead of unrelated source pixels. Excluded section copy can be removed without clipping an adjacent diagram whose vertical range overlaps it.

A genuinely wide accepted question increases the canvas width used by every crop but cannot override another region's source limit. Existing saved images are not rewritten; users recut a source PDF to apply this geometry. Client and Host regressions use horizontally separated regions and assert both the local crop origin and the absence of neighboring-column pixels beyond `rightLimit`.
