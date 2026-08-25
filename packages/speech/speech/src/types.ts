/**
 * Provider-neutral speech-transcription vocabulary.
 * @module @deepseek-ai/dsh-speech/types
 */

/** Stable transcription failure codes safe to return through the browser Remote. */
export type SpeechErrorCode =
  | 'invalid-request'
  | 'unsupported-format'
  | 'file-too-large'
  | 'provider-unavailable'
  | 'provider-disabled'
  | 'provider-failure'
  | 'invalid-response'
  | 'empty-result'

/** One browser or same-process speech-transcription request. */
export interface SpeechTranscribeRequest {
  /** Browser-declared audio media type, including optional codec parameters. */
  readonly mediaType: string
  /** Raw audio bytes encoded as canonical base64. */
  readonly contentBase64: string
}

/** Normalized speech transcript. */
export interface SpeechTranscript {
  /** Final non-empty transcript text. */
  readonly text: string
  /** Selected provider id. */
  readonly provider: string
}

/** Successful transcription result. */
export interface SpeechTranscribeSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Normalized transcript. */
  readonly value: SpeechTranscript
}

/** Transcription failure safe to present to a user. */
export interface SpeechFailure {
  /** Stable failure code. */
  readonly code: SpeechErrorCode
  /** Concise diagnostic without audio or credentials. */
  readonly message: string
}

/** Rejected transcription result. */
export interface SpeechTranscribeRejected {
  /** Failure discriminant. */
  readonly ok: false
  /** Provider-independent failure. */
  readonly error: SpeechFailure
}

/** Remote and same-process transcription result. */
export type SpeechTranscribeResult = SpeechTranscribeSuccess | SpeechTranscribeRejected

/** One implementation registered with the speech runtime. */
export interface SpeechProvider {
  /** Stable provider id used by deployment selection. */
  readonly id: string
  /** Cheap local usability check that performs no file or network I/O. */
  available(): boolean
  /**
   * Transcribe one audio recording.
   * @param request - transport fields whose semantics the provider validates.
   * @param signal - optional caller cancellation.
   * @returns normalized final transcript.
   */
  transcribe(request: SpeechTranscribeRequest, signal?: AbortSignal): Promise<SpeechTranscript>
}
