/** Durable example-collection records and browser requests. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of one collected question. */
export type TeacherExampleId = Branded<'TeacherExampleId'>
/** Identity of one uploaded source revision. */
export type TeacherExampleSourceId = Branded<'TeacherExampleSourceId'>

/** One pen stroke in a normalized 0–1 writing area. */
export interface TeacherExampleStroke {
  /** Ordered pointer positions, independent of the displayed size. */
  readonly points: readonly { readonly x: number; readonly y: number }[]
}

/** Source metadata returned without the original file bytes. */
export interface TeacherExampleSource {
  readonly id: TeacherExampleSourceId
  readonly name: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf'
}

/** Independently uploaded and recognized content within one question directory. */
export type TeacherExampleDocumentKind = 'question' | 'explanation'

/** Original and Word metadata for one document; file bytes are loaded on demand. */
export interface TeacherExampleDocument {
  readonly source: TeacherExampleSource | null
  readonly status: 'empty' | 'pending' | 'ready' | 'error'
  readonly ocrError: string | null
  /** Increases when OCR, normalization, or explicit editing replaces this document's Word artifact. */
  readonly wordRevision: number
}

/** Searchable question metadata with independent question and explanation documents. */
export interface TeacherExample {
  readonly id: TeacherExampleId
  /** Numeric directory order retained after renaming. */
  readonly number: number
  readonly name: string
  readonly tags: readonly string[]
  readonly description: string
  readonly handwriting: readonly TeacherExampleStroke[]
  readonly documents: Readonly<Record<TeacherExampleDocumentKind, TeacherExampleDocument>>
  /** Increases on every successful metadata, source, or OCR write. */
  readonly revision: number
}

/** Directory and tag catalog returned without binary payloads. */
export interface TeacherExampleCatalog {
  readonly questions: readonly TeacherExample[]
  readonly tags: readonly string[]
}

/** Selection of one saved question. */
export interface TeacherExampleRequest {
  readonly id: TeacherExampleId
}

/** Explicit question or explanation selection within one saved directory. */
export interface TeacherExampleDocumentRequest extends TeacherExampleRequest {
  readonly document: TeacherExampleDocumentKind
}

/** Field-specific edits preserve unrelated concurrent edits and OCR completions. */
export interface TeacherExampleUpdateRequest extends TeacherExampleRequest {
  readonly name?: string
  readonly tags?: readonly string[]
  readonly description?: string
  readonly handwriting?: readonly TeacherExampleStroke[]
}

/** Ordered fragments of one question or explanation; replacement clears only that document's Word file. */
export interface TeacherExampleUploadRequest extends TeacherExampleDocumentRequest {
  /** Images and PDF pages continue from top to bottom in this order, forming one source document. */
  readonly files: readonly {
    readonly name: string
    readonly mediaType: TeacherExampleSource['mediaType']
    readonly contentBase64: string
  }[]
}

/** Original document or generated Word file requested for preview/download. */
export interface TeacherExampleFileRequest extends TeacherExampleDocumentRequest {
  readonly kind: 'source' | 'word'
}

/** Placement of explanations in a compiled Word document. */
export type TeacherExampleExportLayout = 'paired' | 'grouped'

/** Ordered selection for one Word download; absent explanations are omitted. */
export interface TeacherExampleExportRequest {
  readonly ids: readonly TeacherExampleId[]
  readonly layout: TeacherExampleExportLayout
}

/** One complete file returned through the JSON transport. */
export interface TeacherExampleFile {
  readonly name: string
  readonly mediaType: string
  readonly contentBase64: string
}

/** Formatting retained in Word runs, with separate Latin and Chinese font families. */
export interface TeacherExampleTextFormat {
  readonly font: string
  readonly eastAsiaFont: string
  readonly size: number
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
}

/** Ordered content in an editable paragraph; object indexes address the loaded Word revision. */
export type TeacherExampleWordInline =
  | { readonly kind: 'text'; readonly text: string; readonly format: TeacherExampleTextFormat }
  | { readonly kind: 'equation'; readonly original: number | null; readonly latex: string; readonly size: number; readonly bold: boolean }
  | { readonly kind: 'image'; readonly original: number }
  | { readonly kind: 'break' }

/** Editable paragraph formatting in points, with line spacing expressed as a multiplier. */
export interface TeacherExampleWordParagraph {
  readonly alignment: 'left' | 'center' | 'right' | 'both'
  readonly lineSpacing: number
  readonly indent: number
  readonly firstLine: number
  readonly spaceBefore: number
  readonly spaceAfter: number
  readonly tabs: readonly number[]
  readonly content: readonly TeacherExampleWordInline[]
}

/** Saved Word content and immutable object previews belonging to a particular source/revision. */
export interface TeacherExampleWordEditor {
  readonly sourceId: TeacherExampleSourceId
  readonly wordRevision: number
  readonly paragraphs: readonly TeacherExampleWordParagraph[]
  readonly equations: readonly { readonly latex: string; readonly mathml: string }[]
  readonly images: readonly {
    readonly mediaType: string
    readonly contentBase64: string
    readonly width: number
    readonly height: number
  }[]
}

/** Optimistic Word edit; stale source or Word revisions cannot overwrite newer work. */
export interface TeacherExampleWordSaveRequest extends TeacherExampleDocumentRequest {
  readonly sourceId: TeacherExampleSourceId
  readonly wordRevision: number
  readonly paragraphs: readonly TeacherExampleWordParagraph[]
}

/** Committed metadata and editable content from the same Word save transaction. */
export interface TeacherExampleWordSaved {
  readonly question: TeacherExample
  readonly editor: TeacherExampleWordEditor
}

/** Stable failures for upload, OCR, persistence, and stale source selections. */
export type TeacherExampleErrorCode =
  | 'invalid-request'
  | 'not-found'
  | 'file-too-large'
  | 'ocr-unavailable'
  | 'ocr-failed'
  | 'ocr-truncated'
  | 'correction-unavailable'
  | 'correction-failed'
  | 'correction-invalid'
  | 'correction-too-large'
  | 'source-changed'
  | 'word-changed'
  | 'export-not-ready'
  | 'storage-failure'
  | 'disposed'

/** Settled collection operation; a failed OCR leaves its original source intact. */
export type TeacherExampleResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: TeacherExampleErrorCode; readonly message: string } }
