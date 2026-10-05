# Agent Note: Paper originals and automatic previews

Status: implemented

English | [中文](2026-10-05-paper-collection.zh.md)

## Problem

Example Collection owns question/explanation OCR and editable generated Word documents. Research papers need original PDF, image, Word, and CAJ uploads with directory numbers, tags, descriptions, and immediate reading without a manual conversion step.

## Decision

Paper Collection owns a separate versioned storage domain and metadata-only catalog. Original file bytes remain immutable within a source revision. PDF, images, and ordinary DOCX render from originals; DOC, CAJ, and DOCX containing TIFF, EMF, WMF, or EPS images receive separate cached PDF previews. This preserves embedded Word figures that browser image decoders cannot display. Preview work runs outside the metadata queue, shares concurrent requests for one source, and checks immutable source identity before commit. Deleting or replacing a source prevents a stale conversion from restoring it. The collection cancels and settles conversions before closing storage.

The Windows x64 desktop package stages a checksum-pinned standalone CAJ command with its native decoders. Operator settings retain the complete command as argv with explicit input/output placeholders, deadline, and byte limit. Conversion runs without a shell, in a private temporary directory, and never reaches a model or OCR provider.

## Alternatives considered

**Extend example OCR.** This couples paper originals to generated editable question documents and introduces recognition work that paper reading does not need.

**Launch an external reader.** This adds a manual reading step and cannot keep the reading surface beside saved tags and descriptions.

**Replace originals with converted PDFs.** This loses the source and hides compatibility failures. The independent collection preserves original downloads and reports preview failures locally.

## Consequences

CAJ compatibility remains limited by the selected converter. Failed previews leave uploaded originals available and can be retried. Non-Windows deployments configure a converter separately. Source files and generated previews use bounded complete base64 payloads; streaming and automatic cache eviction are not provided.

## Verification

The SQLite collection tests cover reopening, original byte identity, shared Word/CAJ previews, concurrent metadata edits, stale-source refusal, upload rejection, and cancellation settlement. The composed Web scenario covers sidebar order, custom numbers, tags, descriptions, PDF/image/DOCX previews, original downloads, reload persistence, search snapshots, and automatic CAJ preview transport. Packaged-runtime verification uses a 15-page research PDF, a thesis page image, a Word manuscript with four TIFF figures, five equations and one table, and a 110-page CAJ thesis; every original download retains its exact bytes.
