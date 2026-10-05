/** Original research-paper files, searchable metadata, and on-demand previews. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of a collected paper. */
export type TeacherPaperId = Branded<'TeacherPaperId'>
/** Opaque identity of one immutable uploaded file. */
export type TeacherPaperSourceId = Branded<'TeacherPaperSourceId'>
/** File formats accepted by paper uploads. */
export type TeacherPaperFormat = 'pdf' | 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'docx' | 'doc' | 'caj'

/** File metadata excludes the original and cached preview bytes. */
export interface TeacherPaperSource {
  readonly id: TeacherPaperSourceId
  readonly name: string
  readonly format: TeacherPaperFormat
  readonly mediaType: string
  readonly bytes: number
}

/** A numbered paper directory with reusable tags and a saved description. */
export interface TeacherPaper {
  readonly id: TeacherPaperId
  /** Creation order survives custom directory names and deletion. */
  readonly number: number
  /** User-defined paper number or title displayed in the directory. */
  readonly name: string
  readonly tags: readonly string[]
  readonly description: string
  readonly files: readonly TeacherPaperSource[]
  readonly revision: number
}

/** Metadata-only catalog for directory display and local search. */
export interface TeacherPaperCatalog {
  readonly papers: readonly TeacherPaper[]
  readonly tags: readonly string[]
}

/** Selection of one saved paper. */
export interface TeacherPaperRequest {
  readonly id: TeacherPaperId
}

/** Field-specific updates preserve files and unrelated metadata. */
export interface TeacherPaperUpdateRequest extends TeacherPaperRequest {
  readonly name?: string
  readonly tags?: readonly string[]
  readonly description?: string
}

/** Ordered original files uploaded together; replacing files preserves metadata. */
export interface TeacherPaperUploadRequest extends TeacherPaperRequest {
  readonly files: readonly {
    readonly name: string
    readonly format: TeacherPaperFormat
    readonly contentBase64: string
  }[]
}

/** One original or derived preview, selected by immutable source identity. */
export interface TeacherPaperFileRequest extends TeacherPaperRequest {
  readonly sourceId: TeacherPaperSourceId
  readonly kind: 'source' | 'preview'
}

/** Complete original or preview bytes transported on demand. */
export interface TeacherPaperFile {
  readonly name: string
  readonly mediaType: string
  readonly contentBase64: string
}

/** Stable failures preserve the uploaded original when preview rendering fails. */
export type TeacherPaperErrorCode =
  | 'invalid-request' | 'file-too-large' | 'not-found' | 'source-changed'
  | 'preview-unavailable' | 'preview-failed' | 'storage-failure' | 'disposed'

/** Settled operation without converter diagnostics or filesystem paths. */
export type TeacherPaperResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: TeacherPaperErrorCode; readonly message: string } }
