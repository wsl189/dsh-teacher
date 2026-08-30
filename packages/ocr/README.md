---
description: "The OCR package group: provider-neutral document extraction and the self-hosted MinerU provider used by filesystem, conversation, and teacher-workbench Consumers."
kind: "package-group"
---

# ocr/ — document extraction

English | [中文](README.zh.md)

## Summary

This family extracts reading-order Markdown and structured page geometry from uploaded documents without binding Consumers to one parser. The Service Definition owns provider selection and normalized results, while the MinerU package translates a deployment-controlled synchronous API. Consumers decide whether extracted content becomes a model-visible tool result, an editable browser draft, or reviewed source geometry.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | `ctx` key |
|---|---|---|
| [`ocr/`](ocr/README.md) | Provider registry, selection, normalized results, and browser Remote | `ctx.ocr` |
| [`ocr-mineru/`](ocr-mineru/README.md) | Self-hosted MinerU extraction provider | registers on `ctx.ocr` |

<a id="related-documentation"></a>
## Related documentation

- [OCR subsystem reference](../../docs/subsystems/ocr.md) — shared request, result, error, provider, and generated Cordis service vocabulary.
- [Filesystem tool](../fs/tool-fs/README.md) — owns the model-facing `read_document` Consumer.
- [Teacher workbench](../host/teacher-workbench/README.md) — owns reviewed timetable and question-segmentation use of OCR output.

<a id="dev-note"></a>
## Dev Note

None.
