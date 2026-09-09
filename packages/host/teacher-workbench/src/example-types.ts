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
  /** Increases when OCR or equation rebuilding replaces this document's Word artifact. */
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

/** Source upload; replacement clears only the selected document's previous Word file. */
export interface TeacherExampleUploadRequest extends TeacherExampleDocumentRequest {
  readonly name: string
  readonly mediaType: TeacherExampleSource['mediaType']
  readonly contentBase64: string
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
  | 'export-not-ready'
  | 'storage-failure'
  | 'disposed'

/** Settled collection operation; a failed OCR leaves its original source intact. */
export type TeacherExampleResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: TeacherExampleErrorCode; readonly message: string } }
