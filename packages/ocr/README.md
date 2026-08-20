# ocr/ - document extraction capability family

English | [中文](README.zh.md)

This family extracts reading-order Markdown from uploaded documents without binding browser consumers to one parser.

| Package | Role | `ctx` key |
|---|---|---|
| [`ocr/`](ocr/README.md) | Defines provider registration, selection, normalized results, and the browser Remote | `ctx.ocr` |
| [`ocr-mineru/`](ocr-mineru/README.md) | Extracts documents through a self-hosted MinerU synchronous API | registers on `ctx.ocr` |

The current Consumers are conversation document intake and school-calendar recognition in the teacher workbench. The [OCR subsystem reference](../../docs/subsystems/ocr.md) owns the shared request, result, error, and provider contracts.
