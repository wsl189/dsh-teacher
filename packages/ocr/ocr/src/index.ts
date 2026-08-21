/**
 * Reusable document-extraction capability and browser Remote.
 * @module @deepseek-ai/dsh-ocr
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  OcrExtractRequest,
  OcrExtractResult,
  OcrExtractedDocument,
  OcrLayoutRequest,
  OcrLayoutLimitsResult,
  OcrLayoutResult,
  OcrProvider,
} from './types.ts'
import { OcrError } from './error.ts'

export { OcrError } from './error.ts'
export type {
  OcrErrorCode,
  OcrExtractRejected,
  OcrExtractRequest,
  OcrExtractResult,
  OcrExtractSuccess,
  OcrExtractedDocument,
  OcrFailure,
  OcrBoundingBox,
  OcrLayoutDocument,
  OcrLayoutLimits,
  OcrLayoutLimitsResult,
  OcrLayoutLimitsSuccess,
  OcrLayoutElement,
  OcrLayoutPage,
  OcrLayoutRequest,
  OcrLayoutResult,
  OcrLayoutSuccess,
  OcrPageRange,
  OcrProvider,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-selecting document extraction runtime. */
    ocr: OcrRuntime
  }
}

/** OCR provider-selection configuration. */
export interface OcrRuntimeConfig {
  /** Explicit provider id; omitted when exactly one usable provider is registered. */
  readonly provider?: string
}

/** Provider-selecting document extraction runtime exposed as `ctx.ocr`. */
export class OcrRuntime extends TypertRemoteService {
  static Config: z<OcrRuntimeConfig> = z.object({
    provider: z.string().pattern(/^[a-z0-9][a-z0-9-]*$/u),
  })

  private readonly providers = new Map<string, OcrProvider>()
  private readonly providerId: string | undefined

  /**
   * @param ctx - Host context carrying the Typert registry.
   * @param config - optional explicit provider selection.
   */
  constructor(ctx: Context, config: OcrRuntimeConfig = {}) {
    super(ctx, 'ocr')
    this.providerId = config.provider
  }

  /**
   * Register one extraction provider for the calling plugin lifetime.
   * @param provider - uniquely identified implementation.
   * @returns disposer that unregisters the provider.
   */
  registerProvider(provider: OcrProvider): () => void {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(provider.id)) {
      throw new Error(`OCR provider id "${provider.id}" must use lower-case letters, digits, and hyphens`)
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`an OCR provider with id "${provider.id}" is already registered`)
    }
    const dispose = this.ctx.effect(() => {
      this.providers.set(provider.id, provider)
      return () => { this.providers.delete(provider.id) }
    }, 'ocr.registerProvider()')
    return () => { void dispose() }
  }

  /**
   * Extract one uploaded document through the selected provider.
   * @param request - base64 document bytes and source metadata.
   * @returns normalized Markdown or a stable failure.
   */
  @Remote('extract')
  async extract(request: OcrExtractRequest): Promise<OcrExtractResult> {
    try {
      const provider = this.resolveProvider()
      return success(await provider.extract(request))
    } catch (error) {
      const failure = error instanceof OcrError
        ? { code: error.code, message: error.message }
        : { code: 'provider-failure' as const, message: 'document extraction failed' }
      return Object.freeze({ ok: false, error: Object.freeze(failure) })
    }
  }

  /**
   * Extract structured page geometry through the selected provider.
   * @param request - base64 document bytes and optional inclusive page window.
   * @returns normalized pages and coordinates or a stable failure.
   */
  @Remote('layout')
  async layout(request: OcrLayoutRequest): Promise<OcrLayoutResult> {
    try {
      const provider = this.resolveProvider()
      return Object.freeze({ ok: true, value: Object.freeze(await provider.extractLayout(request)) })
    } catch (error) {
      const failure = error instanceof OcrError
        ? { code: error.code, message: error.message }
        : { code: 'provider-failure' as const, message: 'document layout extraction failed' }
      return Object.freeze({ ok: false, error: Object.freeze(failure) })
    }
  }

  /**
   * Resolve the selected provider's current structured-layout request limits.
   * @returns upload and page limits, or a stable provider-selection failure.
   */
  @Remote('layoutLimits')
  layoutLimits(): OcrLayoutLimitsResult {
    try {
      return Object.freeze({ ok: true, value: Object.freeze(this.resolveProvider().layoutLimits()) })
    } catch (error) {
      const failure = error instanceof OcrError
        ? { code: error.code, message: error.message }
        : { code: 'provider-failure' as const, message: 'document layout limits are unavailable' }
      return Object.freeze({ ok: false, error: Object.freeze(failure) })
    }
  }

  private resolveProvider(): OcrProvider {
    if (this.providerId !== undefined) {
      const provider = this.providers.get(this.providerId)
      if (provider === undefined) {
        throw new OcrError(`configured OCR provider "${this.providerId}" is not registered`, 'provider-unavailable')
      }
      if (!provider.available()) {
        throw new OcrError(`configured OCR provider "${this.providerId}" is unavailable`, 'provider-unavailable')
      }
      return provider
    }
    const available = [...this.providers.values()].filter(provider => provider.available())
    if (available.length === 0) throw new OcrError('no usable OCR provider is registered', 'provider-unavailable')
    if (available.length > 1) {
      throw new OcrError(`multiple usable OCR providers are registered (${available.map(provider => provider.id).join(', ')})`, 'provider-unavailable')
    }
    const [provider] = available
    if (provider === undefined) throw new OcrError('no usable OCR provider is registered', 'provider-unavailable')
    return provider
  }
}

function success(value: OcrExtractedDocument): OcrExtractResult {
  return Object.freeze({ ok: true, value: Object.freeze(value) })
}

export default OcrRuntime
