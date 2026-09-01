/**
 * Speech provider driven by the supplier route and model selected in Models settings.
 * @module @deepseek-ai/dsh-speech-model-settings
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import {
  credentialRef,
  type CredentialProvider,
} from '@deepseek-ai/dsh-credentials'
import {
  Config as ModelServiceSettingsSchema,
  MODEL_SERVICE_SETTINGS_NAMESPACE,
  findModelServiceRoute,
  type ModelServiceProtocol,
  type ModelServiceProviderProfile,
} from '@deepseek-ai/dsh-model-service-settings'
import {
  SpeechError,
  type SpeechProvider,
  type SpeechTranscript,
  type SpeechTranscribeRequest,
} from '@deepseek-ai/dsh-speech'
import {
  settingsNamespace,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { z as validation } from 'zod'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024
const QWEN_MAX_AUDIO_BYTES = 10 * 1024 * 1024
const PI_AI_SETTINGS_NAMESPACE = settingsNamespace('llm-pi-ai')

const EXTENSION_BY_MEDIA_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
})

const piAiSettingsSchema = validation.looseObject({
  providers: validation.record(validation.string(), validation.looseObject({
    apiKeyEnv: validation.string().optional(),
  })),
})

const zhipuTranscriptSchema = validation.looseObject({ text: validation.string() })
const qwenTranscriptSchema = validation.looseObject({
  choices: validation.array(validation.looseObject({
    message: validation.looseObject({ content: validation.string() }),
  })).min(1),
})

type SpeechRouteKind = 'openai-audio-transcriptions' | 'qwen-input-audio'

interface SpeechRouteSpec {
  readonly model: string
  readonly kind: SpeechRouteKind
  readonly endpoint: URL
  readonly maxAudioBytes: number
}

/** Provider configuration owned by deployment composition. */
export interface Config {
  /** Per-transcription network deadline in milliseconds. */
  readonly timeoutMs: number
  /** Maximum decoded recording size before provider-specific limits are applied. */
  readonly maxAudioBytes: number
  /** Maximum JSON response bytes accepted from a transcription service. */
  readonly maxResponseBytes: number
}

/** Validated plugin configuration schema. */
export const Config: z<Config> = z.object({
  timeoutMs: z.natural().min(1_000).max(10 * 60 * 1_000).default(DEFAULT_TIMEOUT_MS),
  maxAudioBytes: z.natural().min(1_024).max(100 * 1024 * 1024).default(DEFAULT_MAX_AUDIO_BYTES),
  maxResponseBytes: z.natural().min(1_024).max(1024 * 1024).default(DEFAULT_MAX_RESPONSE_BYTES),
})

/** Fetch-compatible dependency used by the provider and deterministic tests. */
export type ModelSettingsSpeechFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

interface DecodedAudio {
  readonly bytes: Buffer
  readonly mediaType: string
  readonly filename: string
}

/** Speech provider that resolves the current Models assignment for every recording. */
export class ModelSettingsSpeechProvider implements SpeechProvider {
  readonly id = 'model-settings'

  /**
   * @param config - transport limits.
   * @param defaultModel - live product model assignments.
   * @param settings - live supplier access profiles.
   * @param credentials - credential references shared with supplier LLM routes.
   * @param fetchImpl - optional fetch implementation for deterministic tests.
   */
  constructor(
    private readonly config: Config,
    private readonly defaultModel: Pick<AgentDefaultModelConfig, 'currentSpeechSelection'>,
    private readonly settings: Pick<SettingsProvider, 'get'>,
    private readonly credentials: Pick<CredentialProvider, 'resolve'>,
    private readonly fetchImpl: ModelSettingsSpeechFetch = globalThis.fetch,
  ) {}

  /** @returns true because a speech assignment can be saved while the Host is running. */
  available(): boolean {
    return true
  }

  /**
   * Transcribe one recording through the supplier route selected in Models settings.
   * @param request - browser media type and canonical base64 audio.
   * @param signal - optional caller cancellation.
   * @returns normalized final transcript.
   */
  async transcribe(request: SpeechTranscribeRequest, signal?: AbortSignal): Promise<SpeechTranscript> {
    const selection = this.defaultModel.currentSpeechSelection()
    if (selection === undefined) {
      throw new SpeechError('no speech-recognition model is selected in Models settings', 'provider-disabled')
    }
    const serviceSettings = this.modelServiceSettings()
    const resolved = findModelServiceRoute(
      serviceSettings,
      selection.provider,
      selection.model,
      'speech',
    )
    if (resolved === undefined) {
      throw new SpeechError(
        `selected speech model "${selection.provider}/${selection.model}" has no installed request adapter`,
        'provider-disabled',
      )
    }
    const route = speechRoute(resolved.route, selection.model)
    if (route === undefined) {
      throw new SpeechError(
        `selected speech model "${selection.provider}/${selection.model}" has no installed request adapter`,
        'provider-disabled',
      )
    }
    const audio = decodeAudio(request, Math.min(this.config.maxAudioBytes, route.maxAudioBytes))
    const apiKey = await this.resolveApiKey(selection.provider, resolved.provider)
    const response = await this.request(route, audio, request.contentBase64, apiKey, signal)
    const text = await readResponseText(response, this.config.maxResponseBytes)
    const transcript = parseTranscript(route.kind, text)
    if (transcript === '') {
      throw new SpeechError('speech service returned an empty transcript', 'empty-result')
    }
    return { text: transcript, provider: this.id }
  }

  private modelServiceSettings(): ReturnType<typeof ModelServiceSettingsSchema> {
    try {
      // Schemastery applies defaults in place; settings snapshots are frozen.
      const snapshot = structuredClone(this.settings.get(MODEL_SERVICE_SETTINGS_NAMESPACE))
      return ModelServiceSettingsSchema(snapshot as never)
    } catch (error) {
      throw new SpeechError('supplier model settings are unavailable', 'provider-disabled', { cause: error })
    }
  }

  private async resolveApiKey(provider: string, serviceProfile: ModelServiceProviderProfile): Promise<string> {
    const section = piAiSettingsSchema.safeParse(this.settings.get(PI_AI_SETTINGS_NAMESPACE))
    const llmRef = section.success ? section.data.providers[provider]?.apiKeyEnv : undefined
    const ref = credentialRef(serviceProfile.apiKeyEnv ?? llmRef ?? derivedCredentialRef(provider))
    const resolved = await this.credentials.resolve(ref)
    if (resolved?.value === undefined || resolved.value.trim() === '') {
      throw new SpeechError(`supplier route "${provider}" has no configured API key`, 'provider-disabled')
    }
    return resolved.value
  }

  private async request(
    route: SpeechRouteSpec,
    audio: DecodedAudio,
    contentBase64: string,
    apiKey: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const init = route.kind === 'openai-audio-transcriptions'
      ? transcriptionRequest(route, audio, apiKey, signal, this.config.timeoutMs)
      : qwenRequest(route, audio.mediaType, contentBase64, apiKey, signal, this.config.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(route.endpoint, init)
    } catch (error) {
      if (signal?.aborted === true) throw error
      throw new SpeechError('selected speech service is unreachable', 'provider-unavailable', { cause: error })
    }
    if (response.status >= 300 && response.status < 400) {
      await cancelResponse(response)
      throw new SpeechError('speech service redirects are not allowed', 'provider-failure')
    }
    if (!response.ok) {
      await cancelResponse(response)
      throw new SpeechError(`speech service returned HTTP ${String(response.status)}`, 'provider-failure')
    }
    return response
  }
}

/** Services required by the Models-settings provider. */
export const inject = ['speech', 'agentDefaultModel', 'settings', 'credentials']

/**
 * Register the Models-settings provider with the shared speech runtime.
 * @param ctx - Host context carrying speech, model-selection, settings, and credential services.
 * @param config - request limits.
 * @returns disposer that unregisters the provider with this plugin instance.
 */
export function apply(ctx: Context, config: Config): () => void {
  return ctx.speech.registerProvider(new ModelSettingsSpeechProvider(
    config,
    ctx.agentDefaultModel,
    ctx.settings,
    ctx.credentials,
  ))
}

function derivedCredentialRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_API_KEY`
}

function decodeAudio(request: SpeechTranscribeRequest, maxBytes: number): DecodedAudio {
  const [declaredMediaType = ''] = request.mediaType.split(';', 1)
  const mediaType = declaredMediaType.trim().toLowerCase()
  const extension = EXTENSION_BY_MEDIA_TYPE[mediaType]
  if (extension === undefined) {
    throw new SpeechError('supported audio formats are WebM, Ogg, M4A, MP3, and WAV', 'unsupported-format')
  }
  if (request.contentBase64.length > Math.ceil(maxBytes / 3) * 4) {
    throw new SpeechError(`audio exceeds the ${String(maxBytes)} byte limit for the selected model`, 'file-too-large')
  }
  const bytes = Buffer.from(request.contentBase64, 'base64')
  if (bytes.toString('base64') !== request.contentBase64) {
    throw new SpeechError('audio bytes are not canonical base64', 'invalid-request')
  }
  if (bytes.byteLength === 0) throw new SpeechError('audio recording is empty', 'invalid-request')
  if (bytes.byteLength > maxBytes) {
    throw new SpeechError(`audio exceeds the ${String(maxBytes)} byte limit for the selected model`, 'file-too-large')
  }
  return { bytes, mediaType, filename: `voice-input${extension}` }
}

function transcriptionRequest(
  route: SpeechRouteSpec,
  audio: DecodedAudio,
  apiKey: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): RequestInit {
  const form = new FormData()
  const blobBytes = new Uint8Array(audio.bytes.byteLength)
  blobBytes.set(audio.bytes)
  form.append('file', new Blob([blobBytes], { type: audio.mediaType }), audio.filename)
  form.append('model', route.model)
  form.append('stream', 'false')
  return {
    method: 'POST',
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    body: form,
    signal: requestSignal(signal, timeoutMs),
    redirect: 'manual',
  }
}

function qwenRequest(
  route: SpeechRouteSpec,
  mediaType: string,
  contentBase64: string,
  apiKey: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): RequestInit {
  return {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages: [{
        role: 'user',
        content: [{
          type: 'input_audio',
          input_audio: { data: `data:${mediaType};base64,${contentBase64}` },
        }],
      }],
      stream: false,
      asr_options: { enable_itn: false },
    }),
    signal: requestSignal(signal, timeoutMs),
    redirect: 'manual',
  }
}

function parseTranscript(kind: SpeechRouteKind, text: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new SpeechError('speech service returned invalid JSON', 'invalid-response', { cause: error })
  }
  if (kind === 'openai-audio-transcriptions') {
    const result = zhipuTranscriptSchema.safeParse(parsed)
    if (!result.success) throw new SpeechError('speech service returned an invalid response', 'invalid-response')
    return result.data.text.trim()
  }
  const result = qwenTranscriptSchema.safeParse(parsed)
  if (!result.success) throw new SpeechError('speech service returned an invalid response', 'invalid-response')
  return result.data.choices[0]?.message.content.trim() ?? ''
}

function speechRoute(
  route: { endpoint: string; protocol: ModelServiceProtocol },
  model: string,
): SpeechRouteSpec | undefined {
  if (route.protocol !== 'openai-audio-transcriptions' && route.protocol !== 'qwen-input-audio') return undefined
  return {
    model,
    kind: route.protocol,
    endpoint: requestEndpoint(route.endpoint, 'selected speech route endpoint'),
    maxAudioBytes: route.protocol === 'qwen-input-audio' ? QWEN_MAX_AUDIO_BYTES : DEFAULT_MAX_AUDIO_BYTES,
  }
}

function requestEndpoint(value: string, label: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new TypeError(`${label} must be a complete URL`, { cause: error })
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new TypeError(`${label} must use HTTPS or loopback HTTP without credentials, query, or fragment`)
  }
  return url
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
    throw new SpeechError('speech response exceeds the configured size limit', 'invalid-response')
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
        throw new SpeechError('speech response exceeds the configured size limit', 'invalid-response')
      }
      output += decoder.decode(next.value, { stream: true })
    }
    return output + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}
