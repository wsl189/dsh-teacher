/** Shared browser document-import state and presentation helpers. */

import type { TeacherWorkbenchTranslate } from './shared.tsx'

/** Browser formats accepted by the configured OCR provider. */
export const DOCUMENT_IMPORT_ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp,image/tiff,.pdf,.docx,.pptx,.xlsx'

/** One document extraction followed by a consumer-owned review value. */
export type DocumentImportState<T> =
  | { readonly kind: 'extracting'; readonly fileName: string }
  | { readonly kind: 'review'; readonly fileName: string; readonly value: T; readonly truncated: boolean }
  | { readonly kind: 'error'; readonly fileName: string; readonly message: string }

/**
 * Whether MinerU should cross-check one raster upload at multiple scales.
 * @param file - browser-selected source document.
 * @returns whether the declared media type is a supported raster image.
 */
export function shouldEnhanceDocumentImage(file: File): boolean {
  return file.type === 'image/png'
    || file.type === 'image/jpeg'
    || file.type === 'image/webp'
    || file.type === 'image/bmp'
    || file.type === 'image/tiff'
}

/**
 * Convert a safe OCR failure into shared teacher-workbench copy.
 * @param code - stable provider-independent OCR error code.
 * @param message - safe Host diagnostic for unclassified failures.
 * @param t - workbench translator.
 * @returns user-facing extraction failure text.
 */
export function documentImportFailureText(
  code: string,
  message: string,
  t: TeacherWorkbenchTranslate,
): string {
  switch (code) {
    case 'provider-unavailable': return t('document.importProviderUnavailable')
    case 'unsupported-format': return t('document.importUnsupported')
    case 'file-too-large': return t('document.importTooLarge')
    default: return t('document.importFailureDetail', { message })
  }
}

/**
 * Derive an editable title from one uploaded file name.
 * @param fileName - browser display name.
 * @returns the last path component without its final extension.
 */
export function documentTitleFromFileName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/u).at(-1) ?? fileName
  const dot = leaf.lastIndexOf('.')
  return (dot > 0 ? leaf.slice(0, dot) : leaf).trim()
}
