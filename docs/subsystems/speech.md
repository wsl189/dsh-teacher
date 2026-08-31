# Speech Transcription

English | [中文](speech.zh.md)

The speech capability separates provider-neutral transcription ([dsh-speech](../../packages/speech/speech)) from the QQ-configured implementation ([dsh-speech-qq](../../packages/speech/speech-qq)) and browser Consumers. `ctx.speech` selects one provider at operation time and exposes normalized final text through the Typert `speech.transcribe` Remote or the same-process abortable operation. Browser recordings and returned text remain transient until a Consumer inserts the text into its own editable state.

Source: [`packages/speech/speech/src/types.ts`](../../packages/speech/speech/src/types.ts)

## Request and Result

```ts type-equiv
/** Stable transcription failure codes safe to return through the browser Remote. */
type SpeechErrorCode =
  | 'invalid-request'
  | 'unsupported-format'
  | 'file-too-large'
  | 'provider-unavailable'
  | 'provider-disabled'
  | 'provider-failure'
  | 'invalid-response'
  | 'empty-result'
```

```ts type-equiv
/** One browser or same-process speech-transcription request. */
interface SpeechTranscribeRequest {
  /** Browser-declared audio media type, including optional codec parameters. */
  readonly mediaType: string
  /** Raw audio bytes encoded as canonical base64. */
  readonly contentBase64: string
}
```

```ts type-equiv
/** Normalized speech transcript. */
interface SpeechTranscript {
  /** Final non-empty transcript text. */
  readonly text: string
  /** Selected provider id. */
  readonly provider: string
}
```

```ts type-equiv
/** Successful transcription result. */
interface SpeechTranscribeSuccess {
  /** Success discriminant. */
  readonly ok: true
  /** Normalized transcript. */
  readonly value: SpeechTranscript
}
```

```ts type-equiv
/** Transcription failure safe to present to a user. */
interface SpeechFailure {
  /** Stable failure code. */
  readonly code: SpeechErrorCode
  /** Concise diagnostic without audio or credentials. */
  readonly message: string
}
```

```ts type-equiv
/** Rejected transcription result. */
interface SpeechTranscribeRejected {
  /** Failure discriminant. */
  readonly ok: false
  /** Provider-independent failure. */
  readonly error: SpeechFailure
}
```

```ts type-equiv
/** Remote and same-process transcription result. */
type SpeechTranscribeResult = SpeechTranscribeSuccess | SpeechTranscribeRejected
```

## Provider Contract

```ts type-equiv
/** One implementation registered with the speech runtime. */
interface SpeechProvider {
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
```

Providers validate request fields, enforce their own resource limits, and throw `SpeechError` with a stable `SpeechErrorCode`. The runtime converts expected failures to `SpeechTranscribeRejected`, hides unexpected provider diagnostics, and rejects ambiguous automatic selection instead of depending on registration order. The QQ adapter re-reads the QQ integration's ASR settings and credential for each operation; it accepts HTTPS or loopback HTTP endpoints, reports transport failures as `provider-unavailable`, reports rejected HTTP requests and invalid settings as `provider-failure`, and never persists audio or returned text.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxspeech--speechruntime"></a>

### `ctx.speech` — `SpeechRuntime`

Provider-selecting speech-transcription runtime exposed as `ctx.speech`.

```ts cordis-catalog
/**
 * Register one transcription provider for the calling plugin lifetime.
 * @param provider - uniquely identified implementation.
 * @returns disposer that unregisters the provider.
 */
registerProvider(provider: SpeechProvider): () => void

/**
 * Transcribe one browser recording through the selected provider.
 * @param request - base64 audio bytes and browser media type.
 * @returns normalized text or a stable failure.
 */
@Remote('transcribe') async transcribe(request: SpeechTranscribeRequest): Promise<SpeechTranscribeResult>

/**
 * Transcribe one recording for a same-process Consumer with cooperative cancellation.
 * Browser Consumers use {@link transcribe}, whose JSON Remote cannot carry an AbortSignal.
 * @param request - base64 audio bytes and browser media type.
 * @param signal - aborts provider work when the calling operation is cancelled.
 * @returns normalized text or a stable failure.
 */
async transcribeAbortable( request: SpeechTranscribeRequest, signal?: AbortSignal, ): Promise<SpeechTranscribeResult>
```

Source: [`packages/speech/speech/src/index.ts`](../../packages/speech/speech/src/index.ts)
<!-- END GENERATED cordis-surface -->
