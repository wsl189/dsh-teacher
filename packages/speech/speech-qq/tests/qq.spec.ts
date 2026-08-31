import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechError } from '@deepseek-ai/dsh-speech'
import {
  Config as ConfigSchema,
  QqConfiguredSpeechProvider,
  apply,
  type Config,
} from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-speech-qq-'))
  roots.push(root)
  return root
}

function config(configPath: string, overrides: Partial<Config> = {}): Config {
  return {
    configPath,
    credentialRef: 'DSH_QQ_ASR_API_KEY',
    timeoutMs: 10_000,
    maxAudioBytes: 1024,
    maxResponseBytes: 1024,
    ...overrides,
  }
}

async function writeConfig(
  path: string,
  speech: Partial<{ enabled: boolean; baseUrl: string; model: string; language: string }> = {},
): Promise<void> {
  await writeFile(path, JSON.stringify({
    version: 1,
    speech: {
      enabled: true,
      baseUrl: 'http://127.0.0.1:8000/v1/',
      model: 'whisper-large-v3',
      language: 'zh',
      ...speech,
    },
  }))
}

const request = (overrides: Partial<Parameters<QqConfiguredSpeechProvider['transcribe']>[0]> = {}) => ({
  mediaType: 'audio/webm;codecs=opus',
  contentBase64: Buffer.from('voice bytes').toString('base64'),
  ...overrides,
})

function credentials(value = 'secret-key') {
  return { resolve: vi.fn(async () => value === '' ? undefined : { value, source: 'test' }) }
}

describe('QqConfiguredSpeechProvider', () => {
  it('posts the current QQ fields, credential, and browser recording', async () => {
    const root = await fixtureRoot()
    const configPath = join(root, 'config.json')
    await writeConfig(configPath)
    const credentialProvider = credentials()
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input
      expect(requestUrl).toBe('http://127.0.0.1:8000/v1/audio/transcriptions')
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'manual',
        headers: { accept: 'application/json', authorization: 'Bearer secret-key' },
      })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      const form = init?.body as FormData
      expect(form.get('model')).toBe('whisper-large-v3')
      expect(form.get('language')).toBe('zh')
      expect(form.get('response_format')).toBe('json')
      const file = form.get('file') as File
      expect(file.name).toBe('voice-input.webm')
      expect(file.type).toBe('audio/webm')
      expect(await file.text()).toBe('voice bytes')
      return Response.json({ text: '  课堂记录  ' })
    })
    const provider = new QqConfiguredSpeechProvider(config(configPath), credentialProvider, fetch)

    expect(provider.available()).toBe(true)
    await expect(provider.transcribe(request())).resolves.toEqual({
      text: '课堂记录',
      provider: 'qq-config',
    })
    expect(credentialProvider.resolve).toHaveBeenCalledWith('DSH_QQ_ASR_API_KEY')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('re-reads settings and credentials for every recording and accepts transcript aliases', async () => {
    const root = await fixtureRoot()
    const configPath = join(root, 'config.json')
    await writeConfig(configPath)
    const resolve = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ value: 'rotated', source: 'test' })
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData
      if (fetch.mock.calls.length === 1) {
        expect(init?.headers).toEqual({ accept: 'application/json' })
        expect(form.get('model')).toBe('whisper-large-v3')
      } else {
        expect(init?.headers).toEqual({ accept: 'application/json', authorization: 'Bearer rotated' })
        expect(form.get('model')).toBe('updated-model')
        expect(form.get('language')).toBe('en-US')
      }
      return Response.json({ transcript: `take-${String(fetch.mock.calls.length)}` })
    })
    const provider = new QqConfiguredSpeechProvider(config(configPath), { resolve }, fetch)

    await expect(provider.transcribe(request())).resolves.toMatchObject({ text: 'take-1' })
    await writeConfig(configPath, { model: 'updated-model', language: 'en-US' })
    await expect(provider.transcribe(request())).resolves.toMatchObject({ text: 'take-2' })
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('rejects unsupported, malformed, empty, and oversized audio before network I/O', async () => {
    const root = await fixtureRoot()
    const configPath = join(root, 'config.json')
    await writeConfig(configPath)
    const fetch = vi.fn()
    const provider = new QqConfiguredSpeechProvider(config(configPath, { maxAudioBytes: 4 }), credentials(), fetch)

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
    await expect(provider.transcribe(request({ contentBase64: 'A'.repeat(12) })))
      .rejects.toMatchObject({ code: 'file-too-large' } satisfies Partial<SpeechError>)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('contains missing, unreadable, malformed, disabled, and invalid QQ documents', async () => {
    const root = await fixtureRoot()
    const configPath = join(root, 'config.json')
    const provider = () => new QqConfiguredSpeechProvider(config(configPath), credentials(), vi.fn())

    await expect(provider().transcribe(request())).rejects.toMatchObject({ code: 'provider-disabled' })
    await mkdir(configPath)
    await expect(provider().transcribe(request())).rejects.toMatchObject({ code: 'provider-failure' })
    await rm(configPath, { recursive: true })
    await writeFile(configPath, '{')
    await expect(provider().transcribe(request())).rejects.toMatchObject({ code: 'provider-failure' })
    await writeFile(configPath, JSON.stringify({ version: 2, speech: {} }))
    await expect(provider().transcribe(request())).rejects.toMatchObject({ code: 'provider-failure' })
    await writeConfig(configPath, { enabled: false })
    await expect(provider().transcribe(request())).rejects.toMatchObject({ code: 'provider-disabled' })
    await writeConfig(configPath, { model: '   ' })
    await expect(provider().transcribe(request())).rejects.toMatchObject({ code: 'provider-failure' })
    await writeConfig(configPath, { language: 'not a language' })
    await expect(provider().transcribe(request())).rejects.toMatchObject({ code: 'provider-failure' })
  })

  it('accepts only HTTPS or loopback HTTP Base URLs without embedded request components', async () => {
    const root = await fixtureRoot()
    const configPath = join(root, 'config.json')
    const fetch = vi.fn(async () => Response.json({ text: 'ok' }))
    const provider = new QqConfiguredSpeechProvider(config(configPath), credentials(), fetch)

    for (const baseUrl of [
      'not a URL',
      'http://example.com/v1/',
      'https://user:pass@example.com/v1/',
      'https://example.com/v1/?tenant=one',
      'https://example.com/v1/#fragment',
    ]) {
      await writeConfig(configPath, { baseUrl })
      await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'provider-failure' })
    }
    await writeConfig(configPath, { baseUrl: 'https://speech.example.com/v1' })
    await expect(provider.transcribe(request())).resolves.toMatchObject({ text: 'ok' })
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://speech.example.com/v1/audio/transcriptions'),
      expect.any(Object),
    )
  })

  it('maps transport, redirect, and HTTP failures without following redirects', async () => {
    const root = await fixtureRoot()
    const configPath = join(root, 'config.json')
    await writeConfig(configPath)
    const throwingBody = new ReadableStream({ cancel: () => { throw new Error('cleanup failed') } })
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(throwingBody, { status: 302 }))
      .mockResolvedValueOnce(new Response('no', { status: 503 }))
    const provider = new QqConfiguredSpeechProvider(config(configPath), credentials(), fetch)

    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'provider-unavailable' })
    const redirect = provider.transcribe(request())
    await expect(redirect).rejects.toMatchObject({ code: 'provider-failure' })
    await expect(redirect).rejects.toThrow('redirects are not allowed')
    const rejected = provider.transcribe(request())
    await expect(rejected).rejects.toMatchObject({ code: 'provider-failure' })
    await expect(rejected).rejects.toThrow('HTTP 503')
  })

  it('preserves caller cancellation instead of remapping it as a service outage', async () => {
    const root = await fixtureRoot()
    const configPath = join(root, 'config.json')
    await writeConfig(configPath)
    const controller = new AbortController()
    const cancellation = new Error('cancelled by caller')
    controller.abort(cancellation)
    const provider = new QqConfiguredSpeechProvider(config(configPath), credentials(), vi.fn(async () => {
      throw cancellation
    }))

    await expect(provider.transcribe(request(), controller.signal)).rejects.toBe(cancellation)
  })

  it('rejects invalid, missing, empty, and oversized service responses', async () => {
    const root = await fixtureRoot()
    const configPath = join(root, 'config.json')
    await writeConfig(configPath)
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(new Response('{'))
      .mockResolvedValueOnce(Response.json({ value: 'missing transcript' }))
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
    const provider = new QqConfiguredSpeechProvider(config(configPath), credentials(), fetch)

    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'empty-result' })
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(provider.transcribe(request())).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('validates configuration and registers the provider on the speech service', async () => {
    const root = await fixtureRoot()
    const configPath = join(root, 'config.json')
    expect(ConfigSchema({ configPath } as never)).toMatchObject({
      configPath,
      credentialRef: 'DSH_QQ_ASR_API_KEY',
      timeoutMs: 120_000,
    })
    expect(() => new QqConfiguredSpeechProvider(config('relative.json'), credentials()))
      .toThrow('must be absolute')
    const registerProvider = vi.fn()
    apply({ speech: { registerProvider }, credentials: credentials() } as never, config(configPath))
    expect(registerProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'qq-config' }))
  })

  it('registers its explained empty invariant companion', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, installer: () => void) => {
      installer()
      return dispose
    })
    await expect(invariant.apply({ invariants: { register } } as never)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-speech-qq', expect.any(Function))
  })
})
