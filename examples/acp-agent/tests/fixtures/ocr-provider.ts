/** Deterministic OCR provider for the assembled document-reader snapshot. */
import type { Context } from '@deepseek-ai/cordis'
import type { OcrProvider } from '@deepseek-ai/dsh-ocr'

/** Fixture plugin name. */
export const name = 'snapshot-ocr-provider'
/** Required OCR runtime. */
export const inject = ['ocr']

/** Register the deterministic extraction provider. */
export function apply(ctx: Context): void {
  const provider: OcrProvider = {
    id: 'snapshot',
    available: () => true,
    layoutLimits: () => ({ maxFileBytes: 1024, maxPagesPerRequest: 1 }),
    extract: async request => ({
      name: request.name,
      mediaType: request.mediaType,
      markdown: '# Roster\n\n| Name |\n| --- |\n| Lin |',
      provider: 'snapshot',
      truncated: false,
    }),
    extractLayout: async () => { throw new Error('layout is not used by this fixture') },
  }
  ctx.ocr.registerProvider(provider)
}
