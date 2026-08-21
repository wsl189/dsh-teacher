/**
 * Model-facing document extraction over the filesystem and OCR capabilities.
 * @module @deepseek-ai/dsh-tool-fs/src/read-document
 */

import type { Context } from '@deepseek-ai/cordis'
import type { OcrErrorCode, OcrExtractRequest } from '@deepseek-ai/dsh-ocr'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { resolveRegularReadTarget } from './read-target.ts'

const DOCUMENT_MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})

class DocumentReadError extends HarnessError {
  declare readonly code: OcrErrorCode

  constructor(message: string, code: OcrErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** Structured `read_document` result returned to Native and Code Mode callers. */
export interface DocumentReadValue {
  /** Backend-resolved source path. */
  path: string
  /** Media type inferred from the source extension. */
  mediaType: string
  /** OCR provider selected by `ctx.ocr`. */
  provider: string
  /** Reading-order Markdown extracted from the complete file. */
  markdown: string
  /** Whether the provider removed trailing output at its configured limit. */
  truncated: boolean
}

/**
 * Resolve the media type that the document extractor receives.
 * @param filePath - model-supplied path whose final extension selects the format.
 * @returns the supported media type, or undefined for an unsupported extension.
 */
export function documentMediaTypeForPath(filePath: string): string | undefined {
  const normalized = filePath.toLowerCase()
  const dot = normalized.lastIndexOf('.')
  return dot < 0 ? undefined : DOCUMENT_MEDIA_TYPES[normalized.slice(dot)]
}

/**
 * Render extracted Markdown with source and truncation metadata.
 * @param value - structured extraction result.
 * @returns model-facing document envelope.
 */
export function formatDocumentReadOutput(value: DocumentReadValue): string {
  const truncation = value.truncated ? '\n<truncated>true</truncated>' : ''
  return `<path>${value.path}</path>
<type>document</type>
<media_type>${value.mediaType}</media_type>
<provider>${value.provider}</provider>${truncation}
<content>
${value.markdown}
</content>`
}

function sourceName(displayPath: string): string {
  return displayPath.split(/[\\/]/u).at(-1) ?? displayPath
}

function unwrapFileLimit(result: ReturnType<Context['ocr']['layoutLimits']>): number {
  if (!result.ok) throw new DocumentReadError(result.error.message, result.error.code)
  return result.value.maxFileBytes
}

function extractionRequest(path: string, mediaType: string, bytes: Uint8Array): OcrExtractRequest {
  return {
    name: sourceName(path),
    mediaType,
    contentBase64: Buffer.from(bytes).toString('base64'),
  }
}

/**
 * Register `read_document` while a provider-selecting OCR runtime is mounted.
 * @param ctx - registration scope providing tools, filesystem, OCR, and prompt services.
 */
export function applyReadDocumentTool(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:read_document',
    order: 101,
    text: 'Use read_document to inspect PDF, DOCX, PPTX, XLSX, or scanned document files through the configured document extractor. Use read for UTF-8 text files and read_image when visual appearance matters.',
  })

  ctx.tools.register(defineTool({
    name: 'read_document',
    description: 'Extract reading-order Markdown from a PDF, DOCX, PPTX, XLSX, PNG, JPEG, WebP, BMP, or TIFF file. Use this for document content that the UTF-8 read tool cannot decode.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the document, resolved by the filesystem backend.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          markdown: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatDocumentReadOutput(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
      const mediaType = documentMediaTypeForPath(args.file_path)
      if (mediaType === undefined) {
        throw new DocumentReadError(
          `cannot read "${args.file_path}": read_document accepts PDF, DOCX, PPTX, XLSX, PNG, JPEG, WebP, BMP, and TIFF files`,
          'unsupported-format',
        )
      }

      const { target, info } = await resolveRegularReadTarget(ctx, exec, args.file_path)
      const bytes = await ctx.fs.readBytes(target, exec.signal, unwrapFileLimit(ctx.ocr.layoutLimits()))
      const result = await ctx.ocr.extractAbortable(extractionRequest(target.displayPath, mediaType, bytes), exec.signal)
      if (!result.ok) throw new DocumentReadError(result.error.message, result.error.code)

      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return {
        path: target.displayPath,
        mediaType: result.value.mediaType,
        provider: result.value.provider,
        markdown: result.value.markdown,
        truncated: result.value.truncated,
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read document ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
