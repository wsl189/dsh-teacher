# Document Extraction

English | [中文](ocr.zh.md)

The OCR capability separates provider-neutral extraction ([dsh-ocr](../../packages/ocr/ocr)) from the self-hosted MinerU implementation ([dsh-ocr-mineru](../../packages/ocr/ocr-mineru)) and its browser Consumers. `ctx.ocr` selects one provider at execution time and exposes normalized Markdown through the Typert `ocr.extract` Remote or normalized page geometry through `ocr.layout`. Raw uploads and geometry are transient; each Consumer owns any persisted text or source-document crops.

Source: [`packages/ocr/ocr/src/types.ts`](../../packages/ocr/ocr/src/types.ts)

## Request and Result

```ts type-equiv
/** Stable extraction failure codes safe to return through the browser Remote. */
type OcrErrorCode =
  | 'invalid-request'
  | 'unsupported-format'
  | 'file-too-large'
  | 'provider-unavailable'
  | 'provider-failure'
  | 'invalid-response'
  | 'empty-result'
```

```ts type-equiv
/** One browser or same-process document extraction request. */
interface OcrExtractRequest {
  /** Original display name, including a format-bearing extension. */
  readonly name: string
  /** Browser-declared media type; the provider also validates the extension. */
  readonly mediaType: string
  /** Raw document bytes encoded as canonical base64. */
  readonly contentBase64: string
  /** Include text that the provider classified outside the main reading order. */
  readonly includeDiscardedText?: boolean
  /** Re-read raster images at multiple scales and overlapping regions to retain small text and table headers. */
  readonly enhanceImageDetail?: boolean
}
```

```ts type-equiv
/** Normalized machine-readable document content. */
interface OcrExtractedDocument {
  /** Original document display name. */
  readonly name: string
  /** Browser-declared media type. */
  readonly mediaType: string
  /** Reading-order Markdown produced by the selected provider. */
  readonly markdown: string
  /** Selected provider id. */
  readonly provider: string
  /** Whether the configured output limit removed trailing content. */
  readonly truncated: boolean
}
```

```ts type-equiv
/** Successful extraction result. */
interface OcrExtractSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Normalized extracted document. */
  readonly value: OcrExtractedDocument
}
```

```ts type-equiv
/** Extraction failure safe to present to a user. */
interface OcrFailure {
  /** Stable failure code. */
  readonly code: OcrErrorCode
  /** Concise diagnostic without document content. */
  readonly message: string
}
```

```ts type-equiv
/** Rejected extraction result. */
interface OcrExtractRejected {
  /** Failure discriminant. */
  readonly ok: false
  /** Provider-independent failure. */
  readonly error: OcrFailure
}
```

```ts type-equiv
/** Remote and same-process extraction result. */
type OcrExtractResult = OcrExtractSuccess | OcrExtractRejected
```

## Structured Layout

```ts type-equiv
/** Inclusive page window requested from a structured document parser. */
interface OcrPageRange {
  /** Zero-based first page. */
  readonly start: number
  /** Zero-based last page. */
  readonly end: number
}
```

```ts type-equiv
/** Document request that retains page geometry for downstream cropping. */
interface OcrLayoutRequest extends OcrExtractRequest {
  /** Optional inclusive page window; omitted parses the complete document. */
  readonly pageRange?: OcrPageRange
}
```

```ts type-equiv
/** Four coordinates in the parser page coordinate system. */
type OcrBoundingBox = readonly [number, number, number, number]
```

```ts type-equiv
/** One reading-order line or non-text region on a parsed page. */
interface OcrLayoutElement {
  /** Provider-normalized content family. */
  readonly type: 'text' | 'equation' | 'image' | 'table' | 'other'
  /** Reading-order text assembled from the element's spans. */
  readonly text: string
  /** Left, top, right, and bottom coordinates relative to the page size. */
  readonly bbox: OcrBoundingBox
}
```

```ts type-equiv
/** One parsed page with coordinates suitable for proportional raster cropping. */
interface OcrLayoutPage {
  /** Zero-based source-document page index. */
  readonly pageIndex: number
  /** Width in the same coordinate system as every element bbox. */
  readonly width: number
  /** Height in the same coordinate system as every element bbox. */
  readonly height: number
  /** Elements in provider reading order. */
  readonly elements: readonly OcrLayoutElement[]
}
```

```ts type-equiv
/** Provider-neutral structured document layout. */
interface OcrLayoutDocument {
  /** Original document display name. */
  readonly name: string
  /** Selected provider id. */
  readonly provider: string
  /** Parsed pages in source order. */
  readonly pages: readonly OcrLayoutPage[]
}
```

```ts type-equiv
/** Provider limits a browser Consumer uses to split source PDFs before upload. */
interface OcrLayoutLimits {
  /** Maximum decoded bytes accepted in one layout request. */
  readonly maxFileBytes: number
  /** Maximum pages parsed in one layout request. */
  readonly maxPagesPerRequest: number
}
```

```ts type-equiv
/** Successful structured-layout extraction. */
interface OcrLayoutSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Normalized page geometry and reading-order elements. */
  readonly value: OcrLayoutDocument
}
```

```ts type-equiv
/** Remote and same-process structured extraction result. */
type OcrLayoutResult = OcrLayoutSuccess | OcrExtractRejected
```

```ts type-equiv
/** Successful provider-limit resolution. */
interface OcrLayoutLimitsSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Current limits of the selected provider. */
  readonly value: OcrLayoutLimits
}
```

```ts type-equiv
/** Remote and same-process provider-limit result. */
type OcrLayoutLimitsResult = OcrLayoutLimitsSuccess | OcrExtractRejected
```

Bounding boxes use `[left, top, right, bottom]` in the coordinate system declared by each page's width and height. The optional page range is zero-based and inclusive. Consumers scale those values proportionally when mapping them back to browser-rendered pixels; browser Consumers can use the selected provider's current limits to split source PDFs before upload, and must own domain-specific grouping and review instead of treating provider geometry as authoritative segmentation.

## Provider Contract

```ts type-equiv
/** One implementation registered with the OCR runtime. */
interface OcrProvider {
  /** Stable provider id used by deployment selection. */
  readonly id: string
  /** Cheap local usability check that performs no network request. */
  available(): boolean
  /** @returns current upload and page limits for one structured-layout request. */
  layoutLimits(): OcrLayoutLimits
  /**
   * Extract one document.
   * @param request - transport request fields whose semantics the provider validates.
   * @param signal - optional caller cancellation.
   * @returns normalized Markdown content.
   */
  extract(request: OcrExtractRequest, signal?: AbortSignal): Promise<OcrExtractedDocument>
  /**
   * Extract page geometry for a consumer that must map content back to the source document.
   * @param request - document bytes and optional inclusive page window.
   * @param signal - optional caller cancellation.
   * @returns normalized page sizes, reading-order elements, and bounding boxes.
   */
  extractLayout(request: OcrLayoutRequest, signal?: AbortSignal): Promise<OcrLayoutDocument>
}
```

Providers validate semantic request fields, enforce their own resource limits, and throw `OcrError` with a stable `OcrErrorCode`. The runtime converts expected failures to `OcrExtractRejected`, hides unexpected provider diagnostics, and rejects ambiguous automatic selection instead of depending on registration order. Layout implementations normalize vendor structures but do not infer domain regions such as questions or calendar activities.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxocr--ocrruntime"></a>

### `ctx.ocr` — `OcrRuntime`

Provider-selecting document extraction runtime exposed as `ctx.ocr`.

```ts cordis-catalog
/**
 * Register one extraction provider for the calling plugin lifetime.
 * @param provider - uniquely identified implementation.
 * @returns disposer that unregisters the provider.
 */
registerProvider(provider: OcrProvider): () => void

/**
 * Extract one uploaded document through the selected provider.
 * @param request - base64 document bytes and source metadata.
 * @returns normalized Markdown or a stable failure.
 */
@Remote('extract') async extract(request: OcrExtractRequest): Promise<OcrExtractResult>

/**
 * Extract structured page geometry through the selected provider.
 * @param request - base64 document bytes and optional inclusive page window.
 * @returns normalized pages and coordinates or a stable failure.
 */
@Remote('layout') async layout(request: OcrLayoutRequest): Promise<OcrLayoutResult>

/**
 * Resolve the selected provider's current structured-layout request limits.
 * @returns upload and page limits, or a stable provider-selection failure.
 */
@Remote('layoutLimits') layoutLimits(): OcrLayoutLimitsResult
```

Source: [`packages/ocr/ocr/src/index.ts`](../../packages/ocr/ocr/src/index.ts)
<!-- END GENERATED cordis-surface -->
