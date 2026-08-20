# @deepseek-ai/dsh-ocr-mineru

English | [中文](README.zh.md)

This plugin registers provider id `mineru` on `ctx.ocr` and sends uploaded files to a deployment-controlled MinerU synchronous `/file_parse` endpoint. Ordinary extraction requests Markdown with formula and table recognition enabled. When `includeDiscardedText` is set, the same request also asks for `middle_json` and prepends unique discarded lines that are absent from the Markdown. Structured extraction requests MinerU `middle_json`, then normalizes page sizes, reading-order lines, content families, and bounding boxes for source-document cropping.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `endpoint` | `http://127.0.0.1:8000/file_parse` | Full HTTP(S) MinerU synchronous parsing endpoint. |
| `backend` | `pipeline` | Local MinerU backend passed as multipart `backend`: `pipeline`, `vlm-engine`, or `hybrid-engine`. |
| `effort` | `high` | Hybrid parsing quality passed as multipart `effort`: `medium` or `high`. |
| `language` | `ch` | Pipeline OCR model language passed as `lang_list`: `ch`, `ch_server`, `korean`, `ta`, `te`, `ka`, `th`, `el`, `arabic`, `east_slavic`, `cyrillic`, or `devanagari`. |
| `timeoutMs` | `300000` | Complete request deadline. |
| `maxFileBytes` | `20971520` | Maximum decoded upload bytes; configurable up to 100 MiB. |
| `maxOutputCharacters` | `500000` | Maximum Markdown characters returned to a Consumer. |
| `maxResponseBytes` | `8388608` | Maximum MinerU JSON response bytes. |

The DSH plugin settings page exposes these fields through **Plugins → Plugin configuration → Document extraction**. Backend, hybrid quality, and recognition language use finite option lists; endpoints and numeric limits remain direct inputs. A saved change applies to the next extraction request.

## Structured Layout

The `ocr.layout` path sets `return_middle_json=true`, disables Markdown output, and forwards an optional inclusive zero-based range as `start_page_id` and `end_page_id`. It reads `pdf_info`, maps MinerU's range-relative `page_idx` back to the source-document index, retains each `page_size`, and emits one normalized element for every usable line or non-text block. Each element carries a content family, reading-order text, and `[left, top, right, bottom]` coordinates in the same coordinate system as its page width and height. Coordinates are clamped to the page and malformed or empty boxes are omitted.

This output is geometry, not a ready-made domain segmentation. The teacher workbench uses a deterministic question-number rule and crops the original browser-held PDF, so MinerU never becomes the authority for question-bank metadata and image quality remains tied to the configured browser render scale.

## Formats and Failures

The provider accepts PDF, PNG, JPEG, WebP, BMP, TIFF, DOCX, PPTX, and XLSX. It rejects empty, malformed, unsupported, and oversized requests before network I/O. Network failures and timeouts return `provider-unavailable`; non-success HTTP responses, invalid JSON fields, oversized responses, and empty extraction output use stable OCR failure codes.

The configured endpoint receives the complete uploaded document. Keep it on infrastructure whose data-retention and access policy is appropriate for the documents users select; the default loopback address does not transmit files to a third party.

## Model Experience

Indirectly, through `dsh-ocr` Consumers that decide whether extracted Markdown enters a model request; this provider contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; the Consumer owns any request containing the returned Markdown.

## Known Limitations and Deferred Work

- **Synchronous parsing only** - a document occupies one HTTP request until MinerU finishes; asynchronous job polling and progress are not exposed.
- **No legacy Office formats** - `.doc`, `.ppt`, and `.xls` are rejected; convert them to DOCX, PPTX, or XLSX before upload.
- **Provider output needs domain review** - dense tables, merged cells, scans, and handwriting can produce imperfect reading order; calendar import therefore presents editable rows before persistence.
- **Structured output requires `middle_json`** - a MinerU deployment that omits or changes the expected `pdf_info` geometry returns `invalid-response`; coordinate Consumers do not fall back to Markdown guessing.
