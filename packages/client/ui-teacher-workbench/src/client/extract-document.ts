/** Browser upload adapter for the shared OCR Remote. */

import type { OcrExtractResult, OcrLayoutRequest, OcrLayoutResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** OCR Remote subset consumed by teacher-workbench uploads. */
export interface TeacherWorkbenchOcrRemote {
  /** Extract one browser file encoded for the JSON RPC transport. */
  extract: (request: {
    name: string
    mediaType: string
    contentBase64: string
  }) => Promise<RemoteResult<OcrExtractResult>>
  /** Extract provider-neutral page geometry. */
  layout: (request: OcrLayoutRequest) => Promise<RemoteResult<OcrLayoutResult>>
}

/** Optional extraction features selected by one workbench workflow. */
export interface TeacherWorkbenchExtractOptions {
  /** Retain peripheral text that may contain a table title or grade label. */
  readonly includeDiscardedText?: boolean
}

/**
 * Extract page geometry for deterministic browser-side question cutting.
 * @param file - source PDF.
 * @param remote - generated OCR Remote namespace.
 * @param pageRange - optional inclusive zero-based page window.
 * @returns normalized layout or a transport failure.
 */
export async function extractWorkbenchLayout(
  file: File,
  remote: TeacherWorkbenchOcrRemote,
  pageRange?: OcrLayoutRequest['pageRange'],
): Promise<OcrLayoutResult> {
  try {
    const carried = await remote.layout({
      name: file.name,
      mediaType: file.type || 'application/pdf',
      contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(pageRange === undefined ? {} : { pageRange }),
    })
    return carried.ok
      ? carried.value
      : { ok: false, error: { code: 'provider-failure', message: carried.error.message } }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'provider-failure',
        message: error instanceof Error ? error.message : 'document layout extraction failed',
      },
    }
  }
}

/**
 * Extract one browser document through the Host OCR runtime.
 * @param file - source browser file.
 * @param remote - generated OCR Remote namespace.
 * @param options - optional text-retention behavior for the active workflow.
 * @returns normalized extraction or a transport failure.
 */
export async function extractWorkbenchDocument(
  file: File,
  remote: TeacherWorkbenchOcrRemote,
  options: TeacherWorkbenchExtractOptions = {},
): Promise<OcrExtractResult> {
  try {
    const carried = await remote.extract({
      name: file.name,
      mediaType: file.type,
      contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(options.includeDiscardedText === true ? { includeDiscardedText: true } : {}),
    })
    return carried.ok
      ? carried.value
      : { ok: false, error: { code: 'provider-failure', message: carried.error.message } }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'provider-failure',
        message: error instanceof Error ? error.message : 'document extraction failed',
      },
    }
  }
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}
