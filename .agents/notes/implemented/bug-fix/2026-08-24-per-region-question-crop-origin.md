# Agent Note: Per-Region Question Crop Origin

Status: implemented

English | [中文](2026-08-24-per-region-question-crop-origin.zh.md)

> Refines the crop geometry in [Question Segmentation Workbench](../feature/2026-08-19-question-segmentation-workbench.md).

## Problem

Validated question regions retain their own left, top, right, and bottom coordinates, but both PDF renderers replaced every region's horizontal coordinates with the minimum left and maximum right coordinates from the complete PDF. That span approaches a full page when a paper uses two columns, so a left-column question includes content from the right column and every saved image becomes nearly page-wide.

## Decision

After all semantic page groups merge, the Host computes one question width as the maximum `(rightLimit - left) / pageWidth` across that question's regions. The median question width is the majority baseline. Widths more than `maxQuestionWidthOutlierExcessRatio` above the median do not participate in `maxQuestionWidthRatio`; the default excess is 0.5. The segmentation result carries the largest remaining normalized width to both renderers.

Visual review and local recuts retain that initial PDF-wide width. They may revise per-region source geometry, but raw safe-lane limits from revised questions never replace the outlier-filtered width before another review pass or final persistence.

For each page slice, the Host also records `rightLimit`: the nearest safe limit from either vertically overlapping content outside that question or the next repeated numbered layout lane. Accepted question heads and numbered theory headings can establish a lane start within an exact page-size family; owned content that crosses that start disables the inferred lane limit. The source page edge remains the fallback. This value is a hard source-pixel limit independent of the region's content-derived `right` coordinate.

When accepted heads occupy both halves of one page, unclaimed single-column elements use the latest preceding head on the same side; unclaimed divider-crossing elements do not enlarge either column. A later head in the same horizontal span is also a hard vertical stop. Semantically excluded boxes that do not overlap an owned element are carried as `excludedAreas` rather than forcing one horizontal stop through adjacent content.

The browser PDF.js renderer and the ordinary-conversation Host renderer preserve each region's own left, top, and bottom coordinates. Each renderer samples at most the maximum non-outlier normalized width after that region's left edge, capped by `rightLimit`, then paints `excludedAreas` white. It places those unscaled source pixels on a white canvas whose width still equals that shared width. A multi-page question applies the same rule independently to every page slice before the slices are joined vertically.

## Alternatives considered

**Use the PDF-wide minimum left and maximum right coordinates.** This makes equal-size pages produce one width, but it discards column ownership and caused the page-wide crops this decision corrects.

**Keep every region's original right edge.** This preserves columns, but produces variable output widths and does not satisfy the workbench requirement to use the widest accepted question consistently.

**Clamp only at the source page edge.** This preserves equal output widths but still samples a neighboring column whenever a wide question elsewhere in the PDF increases the shared width.

**Classify arbitrary page-column topology before cropping.** A complete column model is unnecessary. Repeated numbered landmarks reveal stable lane starts, while vertically overlapping non-owned elements provide local limits on pages without enough repeated evidence. Neither rule assumes fixed column widths.

## Consequences

Questions in different columns keep different horizontal origins and one consistent output width on equal-size pages. Numbered non-question material can establish the same safe lane limit before the first accepted question appears in that lane. A region constrained by a page edge or neighboring column has white space to its right instead of unrelated source pixels. Excluded section copy can be removed without clipping an adjacent diagram whose vertical range overlaps it.

A question within the configured median-relative allowance can increase every canvas. A wider statistical outlier retains its validated geometry but does not widen the shared canvas; deployments can increase the configured allowance for document families that intentionally contain wider questions. Existing saved images are not rewritten; users recut a source PDF to apply this geometry. Client and Host regressions use horizontally separated regions and assert both the local crop origin and the absence of neighboring-column pixels beyond `rightLimit`. They also seed a wider raw safe lane after segmentation and assert that review and final rendering retain the initial non-outlier ratio. Host coverage weights a multi-region question once, retains a width exactly 50% above the median, excludes a wider value, and admits it when the configured allowance increases.
