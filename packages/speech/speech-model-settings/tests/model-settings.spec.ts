import { describe, expect, it, vi } from 'vitest'
import { SpeechError } from '@deepseek-ai/dsh-speech'
import {
  Config as ConfigSchema,
  ModelSettingsSpeechProvider,
  apply,
  type Config,
} from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

function config(overrides: Partial<Config> = {}): Config {
  return {
    timeoutMs: 10_000,
    maxAudioBytes: 1024,
    maxResponseBytes: 1024,
    ...overrides,
  }
}

const request = (overrides: Partial<Parameters<ModelSettingsSpeechProvider['transcribe']>[0]> = {}) => ({
  mediaType: 'audio/wav;codecs=pcm',
  contentBase64: Buffer.from('voice bytes').toString('base64'),
  ...overrides,
})

function requestURL(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function frozenClone<T>(value: T): T {
  const clone = structuredClone(value)
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== 'object' || candidate === null || Object.isFrozen(candidate)) return
    Object.freeze(candidate)
    for (const child of Object.values(candidate)) freeze(child)
  }
  freeze(clone)
  return clone
}

function harness(selection: { provider: string; model: string } | undefined = {
  provider: 'zhipu-cn',
  model: 'glm-asr-2512',
}) {
  let current: { provider: string; model: string } | undefined = selection
  let profiles: Record<string, { apiKeyEnv?: string }> = {
    'zhipu-cn': { apiKeyEnv: 'ZHIPU_KEY' },
    'qwen-cn': { apiKeyEnv: 'QWEN_KEY' },
  }
  let serviceProfiles: Record<string, unknown> = {
    'zhipu-cn': {
      apiKeyEnv: 'ZHIPU_KEY',
      routes: {
        speech: {
          endpoint: 'http://127.0.0.1:8000/zhipu/audio/transcriptions',
          protocol: 'openai-audio-transcriptions',
          models: [{ id: 'glm-asr-2512', name: 'GLM-ASR-2512' }],
        },
      },
    },
    'qwen-cn': {
      apiKeyEnv: 'QWEN_KEY',
      routes: {
        speech: {
          endpoint: 'http://127.0.0.1:8000/qwen/chat/completions',
          protocol: 'qwen-input-audio',
          models: [{ id: 'qwen3-asr-flash', name: 'Qwen3 ASR Flash' }],
        },
      },
    },
  }
  const resolve = vi.fn(async (ref: string): Promise<{ value: string; source: string } | undefined> => (
    { value: `secret:${ref}`, source: 'test' }
  ))
  const get = vi.fn((namespace: string): unknown => frozenClone(namespace === 'model-service-settings'
    ? { providers: serviceProfiles }
    : { providers: profiles }))
  return {
    defaultModel: {
      currentSpeechSelection: vi.fn(() => current),
    },
    settings: {
      get,
    },
    credentials: { resolve },
    select(next: typeof current) { current = next },
    setProfiles(next: typeof profiles) { profiles = next },
    setServiceProfiles(next: typeof serviceProfiles) { serviceProfiles = next },
  }
}

describe('ModelSettingsSpeechProvider', () => {
  it('posts GLM-ASR multipart with the selected model and supplier credential', async () => {
    const services = harness()
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(requestURL(input)).toBe('http://127.0.0.1:8000/zhipu/audio/transcriptions')
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'manual',
        headers: { accept: 'application/json', authorization: 'Bearer secret:ZHIPU_KEY' },
      })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      const form = init?.body as FormData
      expect(form.get('model')).toBe('glm-asr-2512')
      expect(form.get('stream')).toBe('false')
      const file = form.get('file') as File
      expect(file.name).toBe('voice-input.wav')
      expect(file.type).toBe('audio/wav')
      expect(await file.text()).toBe('voice bytes')
      return Response.json({ text: '  课堂口述  ' })
    })
    const provider = new ModelSettingsSpeechProvider(
      config(), services.defaultModel, services.settings, services.credentials, fetch,
    )

    expect(provider.available()).toBe(true)
    await expect(provider.transcribe(request())).resolves.toEqual({
      text: '课堂口述',
      provider: 'model-settings',
    })
    expect(services.credentials.resolve).toHaveBeenCalledWith('ZHIPU_KEY')
  })

  it('posts Qwen input_audio JSON and reads the OpenAI-compatible response', async () => {
    const services = harness({ provider: 'qwen-cn', model: 'qwen3-asr-flash' })
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(requestURL(input)).toBe('http://127.0.0.1:8000/qwen/chat/completions')
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer secret:QWEN_KEY',
          'content-type': 'application/json',
        },
      })
      const body = init?.body
      expect(typeof body).toBe('string')
      expect(JSON.parse(typeof body === 'string' ? body : '')).toEqual({
        model: 'qwen3-asr-flash',
        messages: [{
          role: 'user',
          content: [{
            type: 'input_audio',
            input_audio: { data: `data:audio/wav;base64,${request().contentBase64}` },
          }],
        }],
        stream: false,
        asr_options: { enable_itn: false },
      })
      return Response.json({ choices: [{ message: { content: '  批改语音作业  ' } }] })
    })
    const provider = new ModelSettingsSpeechProvider(
      config(), services.defaultModel, services.settings, services.credentials, fetch,
    )

    await expect(provider.transcribe(request())).resolves.toEqual({
      text: '批改语音作业',
      provider: 'model-settings',
    })
  })

  it('re-resolves the assignment, profile, and credential on every recording', async () => {
    const services = harness()
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ text: 'first' }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'second' } }] }))
    const provider = new ModelSettingsSpeechProvider(
      config(), services.defaultModel, services.settings, services.credentials, fetch,
    )

    await expect(provider.transcribe(request())).resolves.toMatchObject({ text: 'first' })
    services.select({ provider: 'qwen-cn', model: 'qwen3-asr-flash' })
    services.setProfiles({
      'zhipu-cn': { apiKeyEnv: 'ZHIPU_KEY' },
      'qwen-cn': { apiKeyEnv: 'ROTATED_QWEN_KEY' },
    })
    services.setServiceProfiles({
      'zhipu-cn': {
        apiKeyEnv: 'ZHIPU_KEY',
        routes: {
          speech: {
            endpoint: 'http://127.0.0.1:8000/zhipu/audio/transcriptions',
            protocol: 'openai-audio-transcriptions',
            models: [{ id: 'glm-asr-2512' }],
          },
        },
      },
      'qwen-cn': {
        apiKeyEnv: 'ROTATED_QWEN_KEY',
        routes: {
          speech: {
            endpoint: 'http://127.0.0.1:8000/qwen/chat/completions',
            protocol: 'qwen-input-audio',
            models: [{ id: 'qwen3-asr-flash' }],
          },
        },
      },
    })
    await expect(provider.transcribe(request())).resolves.toMatchObject({ text: 'second' })
    expect(services.credentials.resolve.mock.calls.map(([ref]) => ref)).toEqual([
      'ZHIPU_KEY',
      'ROTATED_QWEN_KEY',
    ])
  })

  it('uses the route-derived credential reference when the profile names none', async () => {
    const services = harness()
    services.setProfiles({ 'zhipu-cn': {} })
    services.setServiceProfiles({
      'zhipu-cn': {
        routes: {
          speech: {
            endpoint: 'http://127.0.0.1:8000/zhipu/audio/transcriptions',
            protocol: 'openai-audio-transcriptions',
            models: [{ id: 'glm-asr-2512' }],
          },
        },
      },
    })
    const provider = new ModelSettingsSpeechProvider(
      config(), services.defaultModel, services.settings, services.credentials,
      vi.fn(async () => Response.json({ text: 'ok' })),
    )

    await expect(provider.transcribe(request())).resolves.toMatchObject({ text: 'ok' })
    expect(services.credentials.resolve).toHaveBeenCalledWith('ZHIPU_CN_API_KEY')
  })

  it('fails before network I/O when selection, route, profile, or key is unavailable', async () => {
    const services = harness()
    services.select(undefined)
    const fetch = vi.fn()
    const provider = new ModelSettingsSpeechProvider(
      config(), services.defaultModel, services.settings, services.credentials, fetch,
    )

    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'provider-disabled' })
    services.select({ provider: 'deepseek-official', model: 'deepseek-chat' })
    await expect(provider.transcribe(request())).rejects.toThrow('no installed request adapter')
    services.select({ provider: 'zhipu-cn', model: 'glm-asr-2512' })
    services.setServiceProfiles({})
    await expect(provider.transcribe(request())).rejects.toThrow('no installed request adapter')
    services.setServiceProfiles({
      'zhipu-cn': {
        apiKeyEnv: 'MISSING_KEY',
        routes: {
          speech: {
            endpoint: 'http://127.0.0.1:8000/zhipu/audio/transcriptions',
            protocol: 'openai-audio-transcriptions',
            models: [{ id: 'glm-asr-2512' }],
          },
        },
      },
    })
    services.credentials.resolve.mockResolvedValueOnce(undefined)
    await expect(provider.transcribe(request())).rejects.toThrow('has no configured API key')
    services.settings.get.mockReturnValueOnce({ providers: [] })
    await expect(provider.transcribe(request())).rejects.toThrow('settings are unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects unsupported, malformed, empty, and oversized audio before network I/O', async () => {
    const services = harness()
    const fetch = vi.fn()
    const provider = new ModelSettingsSpeechProvider(
      config({ maxAudioBytes: 4 }), services.defaultModel, services.settings, services.credentials, fetch,
    )

    await expect(provider.transcribe(request({ mediaType: 'audio/flac' })))
      .rejects.toMatchObject({ code: 'unsupported-format' } satisfies Partial<SpeechError>)
    await expect(provider.transcribe(request({ contentBase64: '***' })))
      .rejects.toMatchObject({ code: 'invalid-request' } satisfies Partial<SpeechError>)
    await expect(provider.transcribe(request({ contentBase64: 'YR==' })))
      .rejects.toMatchObject({ code: 'invalid-request' } satisfies Partial<SpeechError>)
    await expect(provider.transcribe(request({ contentBase64: '' })))
      .rejects.toMatchObject({ code: 'invalid-request' } satisfies Partial<SpeechError>)
    await expect(provider.transcribe(request({ contentBase64: Buffer.from('12345').toString('base64') })))
      .rejects.toMatchObject({ code: 'file-too-large' } satisfies Partial<SpeechError>)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps transport, redirect, HTTP, invalid, empty, and oversized responses', async () => {
    const services = harness()
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 302 }))
      .mockResolvedValueOnce(new Response('no', { status: 503 }))
      .mockResolvedValueOnce(new Response('{'))
      .mockResolvedValueOnce(Response.json({ value: 'missing text' }))
      .mockResolvedValueOnce(Response.json({ text: '   ' }))
      .mockResolvedValueOnce(new Response('{}'.padEnd(1025, ' '), {
        headers: { 'content-length': '1025' },
      }))
      .mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1025))
          controller.close()
        },
      })))
    const provider = new ModelSettingsSpeechProvider(
      config(), services.defaultModel, services.settings, services.credentials, fetch,
    )

    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'provider-unavailable' })
    await expect(provider.transcribe(request())).rejects.toThrow('redirects are not allowed')
    await expect(provider.transcribe(request())).rejects.toThrow('HTTP 503')
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'empty-result' })
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('preserves caller cancellation instead of remapping it as an outage', async () => {
    const services = harness()
    const controller = new AbortController()
    const cancellation = new Error('cancelled by caller')
    controller.abort(cancellation)
    const provider = new ModelSettingsSpeechProvider(
      config(), services.defaultModel, services.settings, services.credentials, vi.fn(async () => {
        throw cancellation
      }),
    )

    await expect(provider.transcribe(request(), controller.signal)).rejects.toBe(cancellation)
  })

  it('validates transport limits and registers the provider', () => {
    expect(ConfigSchema({} as never)).toEqual({
      timeoutMs: 120_000,
      maxAudioBytes: 25 * 1024 * 1024,
      maxResponseBytes: 64 * 1024,
    })
    const services = harness()
    const registerProvider = vi.fn()
    apply({
      speech: { registerProvider },
      agentDefaultModel: services.defaultModel,
      settings: services.settings,
      credentials: services.credentials,
    } as never, config())
    expect(registerProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'model-settings' }))
  })

  it('registers its explained empty invariant companion', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, installer: () => void) => {
      installer()
      return dispose
    })
    await expect(invariant.apply({ invariants: { register } } as never)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-speech-model-settings', expect.any(Function))
  })
})
