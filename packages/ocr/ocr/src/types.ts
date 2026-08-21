/**
 * Provider-neutral document-extraction vocabulary.
 * @module @deepseek-ai/dsh-ocr/types
 */

/** Stable extraction failure codes safe to return through the browser Remote. */
export type OcrErrorCode =
  | 'invalid-request'
  | 'unsupported-format'
  | 'file-too-large'
  | 'provider-unavailable'
  | 'provider-failure'
  | 'invalid-response'
  | 'empty-result'

/** One browser or same-process document extraction request. */
export interface OcrExtractRequest {
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

/** Inclusive page window requested from a structured document parser. */
export interface OcrPageRange {
  /** Zero-based first page. */
  readonly start: number
  /** Zero-based last page. */
  readonly end: number
}

/** Document request that retains page geometry for downstream cropping. */
export interface OcrLayoutRequest extends OcrExtractRequest {
  /** Optional inclusive page window; omitted parses the complete document. */
  readonly pageRange?: OcrPageRange
}

/** Four coordinates in the parser page coordinate system. */
export type OcrBoundingBox = readonly [number, number, number, number]

/** One reading-order line or non-text region on a parsed page. */
export interface OcrLayoutElement {
  /** Provider-normalized content family. */
  readonly type: 'text' | 'equation' | 'image' | 'table' | 'other'
  /** Reading-order text assembled from the element's spans. */
  readonly text: string
  /** Left, top, right, and bottom coordinates relative to the page size. */
  readonly bbox: OcrBoundingBox
}

/** One parsed page with coordinates suitable for proportional raster cropping. */
export interface OcrLayoutPage {
  /** Zero-based source-document page index. */
  readonly pageIndex: number
  /** Width in the same coordinate system as every element bbox. */
  readonly width: number
  /** Height in the same coordinate system as every element bbox. */
  readonly height: number
  /** Elements in provider reading order. */
  readonly elements: readonly OcrLayoutElement[]
}

/** Provider-neutral structured document layout. */
export interface OcrLayoutDocument {
  /** Original document display name. */
  readonly name: string
  /** Selected provider id. */
  readonly provider: string
  /** Parsed pages in source order. */
  readonly pages: readonly OcrLayoutPage[]
}

/** Provider limits Consumers use to bound extraction and split structured source PDFs. */
export interface OcrLayoutLimits {
  /** Maximum decoded bytes accepted in one extraction or layout request. */
  readonly maxFileBytes: number
  /** Maximum pages parsed in one layout request. */
  readonly maxPagesPerRequest: number
}

/** Normalized machine-readable document content. */
export interface OcrExtractedDocument {
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

/** Successful extraction result. */
export interface OcrExtractSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Normalized extracted document. */
  readonly value: OcrExtractedDocument
}

/** Extraction failure safe to present to a user. */
export interface OcrFailure {
  /** Stable failure code. */
  readonly code: OcrErrorCode
  /** Concise diagnostic without document content. */
  readonly message: string
}

/** Rejected extraction result. */
export interface OcrExtractRejected {
  /** Failure discriminant. */
  readonly ok: false
  /** Provider-independent failure. */
  readonly error: OcrFailure
}

/** Remote and same-process extraction result. */
export type OcrExtractResult = OcrExtractSuccess | OcrExtractRejected

/** Successful structured-layout extraction. */
export interface OcrLayoutSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Normalized page geometry and reading-order elements. */
  readonly value: OcrLayoutDocument
}

/** Remote and same-process structured extraction result. */
export type OcrLayoutResult = OcrLayoutSuccess | OcrExtractRejected

/** Successful provider-limit resolution. */
export interface OcrLayoutLimitsSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Current limits of the selected provider. */
  readonly value: OcrLayoutLimits
}

/** Remote and same-process provider-limit result. */
export type OcrLayoutLimitsResult = OcrLayoutLimitsSuccess | OcrExtractRejected

/** One implementation registered with the OCR runtime. */
export interface OcrProvider {
  /** Stable provider id used by deployment selection. */
  readonly id: string
  /** Cheap local usability check that performs no network request. */
  available(): boolean
  /** @returns current byte and page limits for extraction requests. */
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
