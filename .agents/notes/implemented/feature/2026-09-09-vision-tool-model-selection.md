# Agent Note: vision-only tool model selection

Status: implemented

English | [中文](2026-09-09-vision-tool-model-selection.zh.md)

## Problem

The tool-model selector offered every configured language model even though background tasks inspect images. Model names do not establish image support, and the browser catalog omitted the adapter's resolved input capabilities.

## Decision

The Session Controller projects optional `inputModalities` from exact model resolution into `ModelCatalogModel`. Unknown capability remains absent. The Models settings tool selector and its save action accept only usable configured routes whose model explicitly includes `image` in those modalities. Empty groups disappear, and an empty selector directs the user to add a vision model in Service access. An obsolete selection displays the selection prompt without rewriting settings.

The [tool-model assignment decision](2026-08-20-tool-model-timetable-normalization.md) still owns paired storage and background-task resolution. Default conversation retains the complete configured catalog. Provider editors remain the sole owner of per-model image-input declarations; there is no additional tool-specific capability toggle or name-based inference.

## Alternatives considered

- Matching names such as `vision` or `VL` excludes valid custom ids and admits misleading names.
- Treating missing capabilities as image support admits models that cannot receive images.
- Filtering all use-case selectors would unnecessarily remove text models from ordinary conversation.

## Consequences

Only the explicit image-input subset can be selected as a tool model in Settings. The existing registry metadata and saved connection state determine eligibility. Host and component tests cover unknown and text-only capabilities, missing credentials, unconfigured routes, and obsolete selections. The composed browser scenario covers the saved vision choice and preserves ordinary text-model choices for conversation.
