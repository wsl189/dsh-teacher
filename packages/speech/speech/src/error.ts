/** Typed speech-transcription failure shared by the runtime and providers. */

import type { SpeechErrorCode } from './types.ts'

/** Typed transcription error used between the runtime and providers. */
export class SpeechError extends Error {
  /** Stable provider-independent failure code. */
  readonly code: SpeechErrorCode

  /**
   * @param message - concise diagnostic without audio or credentials.
   * @param code - stable provider-independent code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: SpeechErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SpeechError'
    this.code = code
  }
}
