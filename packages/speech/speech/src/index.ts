/**
 * Reusable speech-transcription capability and browser Remote.
 * @module @deepseek-ai/dsh-speech
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { SpeechError } from './error.ts'
import type {
  SpeechProvider,
  SpeechTranscript,
  SpeechTranscribeRequest,
  SpeechTranscribeResult,
} from './types.ts'

export { SpeechError } from './error.ts'
export type {
  SpeechErrorCode,
  SpeechFailure,
  SpeechProvider,
  SpeechTranscript,
  SpeechTranscribeRejected,
  SpeechTranscribeRequest,
  SpeechTranscribeResult,
  SpeechTranscribeSuccess,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-selecting speech-transcription runtime. */
    speech: SpeechRuntime
  }
}

/** Speech provider-selection configuration. */
export interface SpeechRuntimeConfig {
  /** Explicit provider id; omitted when exactly one usable provider is registered. */
  readonly provider?: string
}

/** Provider-selecting speech-transcription runtime exposed as `ctx.speech`. */
export class SpeechRuntime extends TypertRemoteService {
  static Config: z<SpeechRuntimeConfig> = z.object({
    provider: z.string().pattern(/^[a-z0-9][a-z0-9-]*$/u),
  })

  private readonly providers = new Map<string, SpeechProvider>()
  private readonly providerId: string | undefined

  /**
   * @param ctx - Host context carrying the Typert registry.
   * @param config - optional explicit provider selection.
   */
  constructor(ctx: Context, config: SpeechRuntimeConfig = {}) {
    super(ctx, 'speech')
    this.providerId = config.provider
  }

  /**
   * Register one transcription provider for the calling plugin lifetime.
   * @param provider - uniquely identified implementation.
   * @returns disposer that unregisters the provider.
   */
  registerProvider(provider: SpeechProvider): () => void {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(provider.id)) {
      throw new Error(`speech provider id "${provider.id}" must use lower-case letters, digits, and hyphens`)
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`a speech provider with id "${provider.id}" is already registered`)
    }
    const dispose = this.ctx.effect(() => {
      this.providers.set(provider.id, provider)
      return () => { this.providers.delete(provider.id) }
    }, 'speech.registerProvider()')
    return () => { void dispose() }
  }

  /**
   * Transcribe one browser recording through the selected provider.
   * @param request - base64 audio bytes and browser media type.
   * @returns normalized text or a stable failure.
   */
  @Remote('transcribe')
  async transcribe(request: SpeechTranscribeRequest): Promise<SpeechTranscribeResult> {
    return this.transcribeAbortable(request)
  }

  /**
   * Transcribe one recording for a same-process Consumer with cooperative cancellation.
   * Browser Consumers use {@link transcribe}, whose JSON Remote cannot carry an AbortSignal.
   * @param request - base64 audio bytes and browser media type.
   * @param signal - aborts provider work when the calling operation is cancelled.
   * @returns normalized text or a stable failure.
   */
  async transcribeAbortable(
    request: SpeechTranscribeRequest,
    signal?: AbortSignal,
  ): Promise<SpeechTranscribeResult> {
    try {
      return success(await this.resolveProvider().transcribe(request, signal))
    } catch (error) {
      const failure = error instanceof SpeechError
        ? { code: error.code, message: error.message }
        : { code: 'provider-failure' as const, message: 'speech transcription failed' }
      return Object.freeze({ ok: false, error: Object.freeze(failure) })
    }
  }

  private resolveProvider(): SpeechProvider {
    if (this.providerId !== undefined) {
      const provider = this.providers.get(this.providerId)
      if (provider === undefined || !provider.available()) {
        throw new SpeechError(
          `configured speech provider "${this.providerId}" is unavailable`,
          'provider-unavailable',
        )
      }
      return provider
    }
    const available = [...this.providers.values()].filter(provider => provider.available())
    const [provider] = available
    if (provider === undefined) {
      throw new SpeechError('no usable speech provider is registered', 'provider-unavailable')
    }
    if (available.length > 1) {
      throw new SpeechError(
        `multiple usable speech providers are registered (${available.map(provider => provider.id).join(', ')})`,
        'provider-unavailable',
      )
    }
    return provider
  }
}

function success(value: SpeechTranscript): SpeechTranscribeResult {
  return Object.freeze({ ok: true, value: Object.freeze(value) })
}

export default SpeechRuntime
