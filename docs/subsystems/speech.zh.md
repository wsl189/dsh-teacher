# 语音转写

[English](speech.md) | 中文

语音能力把提供方无关转写（[dsh-speech](../../packages/speech/speech)）与 QQ 配置实现（[dsh-speech-qq](../../packages/speech/speech-qq)）及浏览器消费方分离。`ctx.speech` 在操作时选择一个提供方，并通过 Typert `speech.transcribe` Remote 或同进程可取消操作开放归一化最终文本。浏览器录音与返回文本保持瞬时状态，直到消费方把文本插入自身可编辑状态。共享浏览器录音器会开放采样所得麦克风音量，并通过 Web Audio 活动在连续静音三秒后结束一次录音；消费方仍保留显式停止操作。

源码：[`packages/speech/speech/src/types.ts`](../../packages/speech/speech/src/types.ts)

## 请求与结果

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

## 提供方约定

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

提供方校验请求字段、强制自身资源上限，并用稳定 `SpeechErrorCode` 抛出 `SpeechError`。运行时把预期失败转换为 `SpeechTranscribeRejected`，隐藏意外提供方诊断，并拒绝有歧义的自动选择，而不依赖注册顺序。QQ 适配器会为每次操作重新读取 QQ 集成的 ASR 设置与凭据，只接受 HTTPS 或回环 HTTP 端点，把传输失败报告为 `provider-unavailable`，把被拒绝的 HTTP 请求与无效设置报告为 `provider-failure`，并且不持久化音频或返回文本。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
