# @deepseek-ai/dsh-ocr

English | [中文](README.zh.md)

`OcrRuntime` (`ctx.ocr`) is the Service Definition for uploaded-document extraction. Providers accept base64 document bytes and return either bounded reading-order Markdown or structured page geometry; Consumers decide whether that output becomes a draft, durable record, source-document crop, or another product projection.

## Service API

`registerProvider(provider)` registers a lower-case provider id for the calling plugin lifetime and returns a disposer. Duplicate ids fail during plugin loading. `extract(request)` returns an `OcrExtractResult` with Markdown; a Consumer may set `includeDiscardedText` when a title or grade label outside the provider's main reading order is needed, and may request `enhanceImageDetail` when a dense raster image needs provider-defined detail passes. `layout(request)` returns an `OcrLayoutResult` with source-page sizes and reading-order elements whose bounding boxes use `[left, top, right, bottom]`. Both methods select a provider at execution time; expected request, provider, and response failures remain data rather than Remote exceptions.

With `provider` configured, extraction requires that exact registered and locally available provider. Without it, exactly one locally available provider is selected; zero or multiple candidates return `provider-unavailable`. `available()` is a cheap local check and never performs network I/O.

## Remote and Data Handling

The Typert namespace is `ocr`, with `extract` and `layout` exposed to approved browser Consumers. Both requests carry the original name, browser media type, and canonical base64 bytes; extraction requests may opt into discarded text and raster-detail enhancement, while layout requests may carry an inclusive, zero-based page range. A successful layout response carries each source page's index, width, height, and normalized text, equation, image, table, or other elements in provider reading order. The runtime does not persist raw documents, extracted text, or geometry; each Consumer owns any later durability and access policy.

## Configuration

| Field | Meaning |
|---|---|
| `provider` | Optional provider id. Omit only when the composition has exactly one usable provider. |

See the generated [configuration catalog](../../../docs/config-catalog.md) for the source-equivalent declaration.

## Model Experience

Indirectly, through Consumers such as `dsh-client-ui-conversation`, which may place extracted Markdown into an ordinary user message while this runtime contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; the Consumer that submits extracted text owns request-prefix changes.

## Known Limitations and Deferred Work

- **JSON base64 transport** - each request carries one complete file and expands its bytes before provider processing; streaming and resumable uploads are not exposed.
- **No extraction cache** - repeated uploads invoke the selected provider again; Consumers that need deduplication must own it together with their retention policy.
- **No browser cancellation Remote** - provider calls have deployment timeouts, but the current Typert method does not carry a browser abort signal.
- **Provider-defined layout fidelity** - page coordinates and reading order are normalized, but their recognition quality remains the selected parser's responsibility; domain Consumers must validate or review derived regions.
