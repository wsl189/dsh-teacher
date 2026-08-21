# 文档提取

[English](ocr.md) | 中文

OCR 能力把提供方无关提取（[dsh-ocr](../../packages/ocr/ocr)）与自托管 MinerU 实现（[dsh-ocr-mineru](../../packages/ocr/ocr-mineru)）及浏览器消费方分离。`ctx.ocr` 在执行时选择一个提供方，并经 Typert `ocr.extract` Remote 开放归一化 Markdown，或经 `ocr.layout` 开放归一化页面几何信息。原始上传与几何信息都是瞬时数据；各消费方拥有对文本或源文档切图的后续持久化。

源码：[`packages/ocr/ocr/src/types.ts`](../../packages/ocr/ocr/src/types.ts)

## 请求与结果

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

## 结构化版面

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

边界框使用各页面宽高所声明坐标系中的 `[左, 上, 右, 下]`。可选页码范围从零开始且首尾均包含。消费方把这些数值映射回浏览器渲染像素时按比例缩放；浏览器消费方可按所选提供方的当前限制在上传前拆分源 PDF，并且必须自行拥有领域分组与复核，而不能把提供方几何信息直接当作权威切分。

## 提供方约定

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

提供方校验请求字段的语义、强制自身资源上限，并以稳定 `OcrErrorCode` 抛出 `OcrError`。运行时把预期失败转为 `OcrExtractRejected`，隐藏意外提供方诊断，并拒绝有歧义的自动选择，而不依赖注册顺序。版面实现会归一化供应商结构，但不会推断试题或校历事项等领域区域。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
