---
description: "Provider-neutral OCR runtime for selecting document parsers and returning bounded Markdown or structured page geometry to browser and filesystem Consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-ocr

English | [中文](README.zh.md)

## Summary

`OcrRuntime` (`ctx.ocr`) is the Service Definition for uploaded-document extraction. Providers accept base64 document bytes and return either bounded reading-order Markdown or structured page geometry; Consumers decide whether that output becomes a draft, durable record, source-document crop, or another product projection.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this Service Definition with one or more provider packages, then let each Consumer choose whether extraction output remains transient or becomes durable or model-visible.

### Service API

`registerProvider(provider)` registers a lower-case provider id for the calling plugin lifetime and returns a disposer. Duplicate ids fail during plugin loading. `extract(request)` returns an `OcrExtractResult` with Markdown; a Consumer may set `includeDiscardedText` when a title or grade label outside the provider's main reading order is needed, and may request `enhanceImageDetail` when a dense raster image needs provider-defined detail passes. `layout(request)` returns an `OcrLayoutResult` with source-page sizes and reading-order elements whose bounding boxes use `[left, top, right, bottom]`. `layoutLimits()` returns the selected provider's current decoded-byte and page limits for one layout request, allowing browser Consumers to split a source PDF before base64 transport. All three methods select a provider at execution time; expected request, provider, and response failures remain data rather than Remote exceptions.

With `provider` configured, extraction requires that exact registered and locally available provider. Without it, exactly one locally available provider is selected; zero or multiple candidates return `provider-unavailable`. `available()` is a cheap local check and never performs network I/O.

### Remote and Data Handling

The Typert namespace is `ocr`, with `extract`, `layout`, and `layoutLimits` exposed to approved browser Consumers. Document requests carry a name, media type, and canonical base64 bytes; extraction requests may opt into discarded text and raster-detail enhancement, while layout requests may carry an inclusive, zero-based page range. A successful layout response carries each source page's index, width, height, and normalized text, equation, image, table, or other elements in provider reading order. The runtime does not persist raw documents, extracted text, or geometry; each Consumer owns any later durability and access policy.

### Configuration

| Field | Meaning |
|---|---|
| `provider` | Optional provider id. Omit only when the composition has exactly one usable provider. |

See the generated [configuration catalog](../../../docs/config-catalog.md) for the source-equivalent declaration.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The runtime validates transport fields, resolves the configured provider at operation time, and reduces expected provider failures to frozen discriminated results. Same-process operations additionally forward cancellation; the Typert Remote carries JSON data only. Exact request and result declarations live in [`src/types.ts`](src/types.ts), and provider selection lives in [`src/index.ts`](src/index.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [OCR subsystem](../../../docs/subsystems/ocr.md) — shared types and generated Cordis service reference.
- [MinerU provider](../ocr-mineru/README.md) — shipped self-hosted parser implementation.
- [Filesystem tool](../../fs/tool-fs/README.md) — model-facing `read_document` Consumer.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-fs`, which registers the model-facing `read_document` schema while `ctx.ocr` is present, and browser Consumers such as `dsh-client-ui-conversation`, which may place extracted Markdown into an ordinary user message; this runtime contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; the Consumer that submits extracted text owns request-prefix changes.

## Known Limitations and Deferred Work

- **JSON base64 transport per request** - each request carries one complete file and expands its bytes before provider processing. A Consumer can split a PDF against `layoutLimits`, but streaming and resumable uploads are not exposed.
- **No extraction cache** - repeated uploads invoke the selected provider again; Consumers that need deduplication must own it together with their retention policy.
- **No browser cancellation Remote** - same-process Consumers can forward an abort signal through `extractAbortable`, but the Typert method cannot carry a browser abort signal.
- **Provider-defined layout fidelity** - page coordinates and reading order are normalized, but their recognition quality remains the selected parser's responsibility; domain Consumers must validate or review derived regions.

<a id="dev-note"></a>
### Dev Note

Keep domain segmentation out of this package; providers normalize extraction evidence and Consumers own every domain interpretation.
