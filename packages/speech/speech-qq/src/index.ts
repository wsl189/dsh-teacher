/**
 * OpenAI-compatible transcription provider backed by the dsh-im QQ settings document.
 * @module @deepseek-ai/dsh-speech-qq
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  SpeechError,
  type SpeechProvider,
  type SpeechTranscript,
  type SpeechTranscribeRequest,
} from '@deepseek-ai/dsh-speech'
import {
  credentialRef,
  type CredentialProvider,
  type CredentialRef,
} from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { z as validation } from 'zod'

const DEFAULT_CREDENTIAL_REF = 'DSH_QQ_ASR_API_KEY'
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_AUDIO_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024

const EXTENSION_BY_MEDIA_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
})

const qqConfigSchema = validation.looseObject({
  version: validation.literal(1),
  speech: validation.looseObject({
    enabled: validation.boolean(),
    baseUrl: validation.string(),
    model: validation.string(),
    language: validation.string(),
  }),
})

const transcriptSchema = validation.union([
  validation.object({ text: validation.string() }),
  validation.object({ transcript: validation.string() }),
])

/** Provider configuration owned by deployment composition. */
export interface Config {
  /** Absolute dsh-im QQ configuration document path. */
  readonly configPath: string
  /** Credential reference written by the QQ settings surface. */
  readonly credentialRef: string
  /** Per-transcription network deadline in milliseconds. */
  readonly timeoutMs: number
  /** Maximum decoded browser recording size. */
  readonly maxAudioBytes: number
  /** Maximum JSON response bytes accepted from the transcription service. */
  readonly maxResponseBytes: number
}

/** Validated plugin configuration schema. */
export const Config: z<Config> = z.object({
  configPath: z.string().required(),
  credentialRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/u).default(DEFAULT_CREDENTIAL_REF),
  timeoutMs: z.natural().min(1_000).max(10 * 60 * 1_000).default(DEFAULT_TIMEOUT_MS),
  maxAudioBytes: z.natural().min(1_024).max(100 * 1024 * 1024).default(DEFAULT_MAX_AUDIO_BYTES),
  maxResponseBytes: z.natural().min(1_024).max(1024 * 1024).default(DEFAULT_MAX_RESPONSE_BYTES),
})

/** Fetch-compatible dependency used by the provider and deterministic tests. */
export type QqSpeechFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface QqSpeechConfig {
  readonly enabled: boolean
  readonly baseUrl: string
  readonly model: string
  readonly language: string
}

interface DecodedAudio {
  readonly bytes: Buffer
  readonly mediaType: string
  readonly filename: string
}

/** Speech provider that re-reads the QQ settings and credential for every recording. */
export class QqConfiguredSpeechProvider implements SpeechProvider {
  readonly id = 'qq-config'
  private readonly credential: CredentialRef

  /**
   * @param config - configuration-document path and transport limits.
   * @param credentials - credential provider shared with dsh-im.
   * @param fetchImpl - optional fetch implementation for deterministic tests.
   */
  constructor(
    private readonly config: Config,
    private readonly credentials: Pick<CredentialProvider, 'resolve'>,
    private readonly fetchImpl: QqSpeechFetch = globalThis.fetch,
  ) {
    if (!isAbsolute(config.configPath)) {
      throw new TypeError('QQ speech configPath must be absolute')
    }
    this.credential = credentialRef(config.credentialRef)
  }

  /** @returns true because configuration can be enabled through the QQ settings surface at any time. */
  available(): boolean {
    return true
  }

  /**
   * Transcribe one browser recording with the current QQ ASR settings.
   * @param request - browser media type and canonical base64 audio.
   * @param signal - optional caller cancellation.
   * @returns normalized final transcript.
   */
  async transcribe(request: SpeechTranscribeRequest, signal?: AbortSignal): Promise<SpeechTranscript> {
    const audio = decodeAudio(request, this.config.maxAudioBytes)
    const speech = await readQqSpeechConfig(this.config.configPath)
    if (!speech.enabled) {
      throw new SpeechError('QQ speech recognition is not enabled', 'provider-disabled')
    }
    const endpoint = transcriptionEndpoint(speech.baseUrl)
    const resolved = await this.credentials.resolve(this.credential)
    const form = new FormData()
    const blobBytes = new Uint8Array(audio.bytes.byteLength)
    blobBytes.set(audio.bytes)
    form.append('file', new Blob([blobBytes], { type: audio.mediaType }), audio.filename)
    form.append('model', speech.model)
    form.append('language', speech.language)
    form.append('response_format', 'json')
    const headers: Record<string, string> = { accept: 'application/json' }
    if (resolved?.value !== undefined && resolved.value.trim() !== '') {
      headers.authorization = `Bearer ${resolved.value}`
    }

    let response: Response
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: form,
        signal: requestSignal(signal, this.config.timeoutMs),
        redirect: 'manual',
      })
    } catch (error) {
      if (signal?.aborted === true) throw error
      throw new SpeechError('configured QQ speech service is unreachable', 'provider-failure', { cause: error })
    }
    if (response.status >= 300 && response.status < 400) {
      await cancelResponse(response)
      throw new SpeechError('QQ speech service redirects are not allowed', 'provider-failure')
    }
    if (!response.ok) {
      await cancelResponse(response)
      throw new SpeechError(`QQ speech service returned HTTP ${String(response.status)}`, 'provider-failure')
    }

    const text = await readResponseText(response, this.config.maxResponseBytes)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new SpeechError('QQ speech service returned invalid JSON', 'invalid-response', { cause: error })
    }
    const result = transcriptSchema.safeParse(parsed)
    if (!result.success) {
      throw new SpeechError('QQ speech service returned an invalid response', 'invalid-response')
    }
    const transcript = ('text' in result.data ? result.data.text : result.data.transcript).trim()
    if (transcript === '') {
      throw new SpeechError('QQ speech service returned an empty transcript', 'empty-result')
    }
    return { text: transcript, provider: this.id }
  }
}

/** Services required by the QQ-configured provider. */
export const inject = ['speech', 'credentials']

/**
 * Register the QQ-configured provider with the shared speech runtime.
 * @param ctx - Host context carrying speech and credential services.
 * @param config - configuration-document path and request limits.
 * @returns disposer that unregisters the provider with this plugin instance.
 */
export function apply(ctx: Context, config: Config): () => void {
  return ctx.speech.registerProvider(new QqConfiguredSpeechProvider(config, ctx.credentials))
}

function decodeAudio(request: SpeechTranscribeRequest, maxBytes: number): DecodedAudio {
  const [declaredMediaType = ''] = request.mediaType.split(';', 1)
  const mediaType = declaredMediaType.trim().toLowerCase()
  const extension = EXTENSION_BY_MEDIA_TYPE[mediaType]
  if (extension === undefined) {
    throw new SpeechError('supported audio formats are WebM, Ogg, M4A, MP3, and WAV', 'unsupported-format')
  }
  if (request.contentBase64.length > Math.ceil(maxBytes / 3) * 4) {
    throw new SpeechError(`audio exceeds the configured ${String(maxBytes)} byte limit`, 'file-too-large')
  }
  const bytes = Buffer.from(request.contentBase64, 'base64')
  if (bytes.toString('base64') !== request.contentBase64) {
    throw new SpeechError('audio bytes are not canonical base64', 'invalid-request')
  }
  if (bytes.byteLength === 0) throw new SpeechError('audio recording is empty', 'invalid-request')
  if (bytes.byteLength > maxBytes) {
    throw new SpeechError(`audio exceeds the configured ${String(maxBytes)} byte limit`, 'file-too-large')
  }
  return { bytes, mediaType, filename: `voice-input${extension}` }
}

async function readQqSpeechConfig(path: string): Promise<QqSpeechConfig> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) {
      throw new SpeechError('QQ speech recognition is not configured', 'provider-disabled')
    }
    throw new SpeechError('QQ speech configuration could not be read', 'provider-failure', { cause: error })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new SpeechError('QQ speech configuration is invalid JSON', 'provider-failure', { cause: error })
  }
  const document = qqConfigSchema.safeParse(parsed)
  if (!document.success) {
    throw new SpeechError('QQ speech configuration is invalid', 'provider-failure')
  }
  const { enabled, baseUrl, model: rawModel, language: rawLanguage } = document.data.speech
  const model = rawModel.trim()
  const language = rawLanguage.trim()
  if (model === '' || model.length > 200) {
    throw new SpeechError('QQ speech model is invalid', 'provider-failure')
  }
  if (language === '' || language.length > 32 || !/^[A-Za-z0-9-]+$/u.test(language)) {
    throw new SpeechError('QQ speech language is invalid', 'provider-failure')
  }
  return { enabled, baseUrl, model, language }
}

function transcriptionEndpoint(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new SpeechError('QQ speech Base URL is invalid', 'provider-failure', { cause: error })
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new SpeechError(
      'QQ speech Base URL must use HTTPS or loopback HTTP without credentials, query, or fragment',
      'provider-failure',
    )
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return new URL('audio/transcriptions', url)
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The HTTP status is the primary failure; response cleanup is best-effort.
  }
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return ''
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponse(response)
    throw new SpeechError('QQ speech response exceeds the configured size limit', 'invalid-response')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let output = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new SpeechError('QQ speech response exceeds the configured size limit', 'invalid-response')
      }
      output += decoder.decode(next.value, { stream: true })
    }
    return output + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
