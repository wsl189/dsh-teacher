/** Exercise the patched third-party entry loaded by the shipped Web bundle. */

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const entry = pathToFileURL(require.resolve('@xmanrui/dsh-im')).href
const { createImHostPlugin, inject } = await import(entry) as {
  createImHostPlugin: (internals: Record<string, (ctx: object, config: Record<string, unknown>) => void>) => {
    apply(ctx: object, config?: Record<string, unknown>): Promise<void>
  }
  inject: readonly string[]
}
const qqProduction = pathToFileURL(join(
  dirname(fileURLToPath(entry)),
  'plugin-src/host/channels/qq/production.mjs',
)).href
const harnessConnectionModule = pathToFileURL(join(
  dirname(fileURLToPath(entry)),
  'plugin-src/host/harness-connection.mjs',
)).href
const harnessClientModule = pathToFileURL(join(
  dirname(fileURLToPath(entry)),
  'src/channels/shared/harness-client.mjs',
)).href
const { createDshSpeechTranscriber } = await import(qqProduction) as {
  createDshSpeechTranscriber: (
    speech: {
      transcribeAbortable(request: { mediaType: string; contentBase64: string }, signal?: AbortSignal):
      Promise<
      | { ok: true; value: { text: string; provider: string } }
      | { ok: false; error: { code: string; message: string } }
      >
    },
    options?: { fetchImpl?: typeof fetch },
  ) => {
    transcribe(
      attachment: { asr_refer_text?: string; voice_wav_url?: string },
      options?: { signal?: AbortSignal },
    ): Promise<string>
  }
}
const weixinRuntimeModule = pathToFileURL(join(
  dirname(fileURLToPath(entry)),
  'src/channels/weixin/weixin-runtime.mjs',
)).href
const { harnessConnection } = await import(harnessConnectionModule) as {
  harnessConnection: (
    ctx: object,
    config?: { harnessBaseUrl?: string },
  ) => { apiProxy?: object; baseUrl?: URL; interactionScope?: object }
}
const { HarnessClient } = await import(harnessClientModule) as {
  HarnessClient: new (options: Record<string, unknown>) => {
    health(): Promise<boolean>
    sessionExists(sessionId: string): Promise<boolean>
  }
}
const { WeixinRuntime } = await import(weixinRuntimeModule) as {
  WeixinRuntime: new (options: Record<string, unknown>) => {
    start(): Promise<unknown>
  }
}

const channels = ['Feishu', 'Weixin', 'Dingtalk', 'Wecom', 'Qq', 'Slack', 'Telegram', 'Discord', 'Whatsapp']

function channelCallbacks() {
  return Object.fromEntries([...channels, 'Office'].map(channel => [
    `apply${channel}`, vi.fn<(ctx: object, config: Record<string, unknown>) => void>(),
  ]))
}

afterEach(() => { vi.unstubAllEnvs() })

describe('bundled IM bot workspace defaults', () => {
  it('declares the shared speech runtime as a shipped Host dependency', () => {
    expect(inject).toContain('speech')
  })

  it('passes the system desktop to all nine platforms while leaving Office settings intact', async () => {
    const desktop = join(homedir(), 'OneDrive', '课程资料', '桌面')
    vi.stubEnv('DSH_DESKTOP_DIR', desktop)
    const callbacks = channelCallbacks()
    const office = { enabled: false }
    await createImHostPlugin(callbacks).apply({}, { office })

    for (const channel of channels) {
      expect(callbacks[`apply${channel}`]).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ workspace: desktop }),
      )
    }
    expect(callbacks.applyOffice).toHaveBeenCalledWith({}, office)
  })

  it('uses the Host home Desktop directory without an Electron-provided path', async () => {
    vi.stubEnv('DSH_DESKTOP_DIR', undefined)
    const callbacks = channelCallbacks()
    await createImHostPlugin(callbacks).apply({})

    for (const channel of channels) {
      expect(callbacks[`apply${channel}`]).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ workspace: join(homedir(), 'Desktop') }),
      )
    }
  })

  it('preserves explicit platform workspaces and settings without mutating the caller', async () => {
    vi.stubEnv('DSH_DESKTOP_DIR', join(homedir(), 'Desktop'))
    const callbacks = channelCallbacks()
    const configs = Object.freeze(Object.fromEntries(channels.map(channel => [
      channel.toLowerCase(), Object.freeze({ workspace: join(homedir(), channel), agentPreset: 'standard' }),
    ])))
    await createImHostPlugin(callbacks).apply({}, configs)

    for (const channel of channels) {
      expect(callbacks[`apply${channel}`]).toHaveBeenCalledWith(
        {},
        expect.objectContaining(configs[channel.toLowerCase()]),
      )
    }
  })

  it.each(['', 'relative-desktop'])('rejects a non-absolute desktop path: %j', async (desktop) => {
    vi.stubEnv('DSH_DESKTOP_DIR', desktop)
    const callbacks = channelCallbacks()
    await expect(createImHostPlugin(callbacks).apply({})).rejects.toThrow(
      'DSH_DESKTOP_DIR must be an absolute directory path',
    )
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled()
  })
})

describe('bundled IM Host RPC adapter', () => {
  it('runs the shared Harness health check through the same-process Host adapter', async () => {
    const fetchImpl = vi.fn(() => { throw new Error('HTTP must not be used') })
    const ctx = {
      typertGateway: { invoke: vi.fn(), stream: vi.fn() },
    }
    const harness = new HarnessClient({
      ...harnessConnection(ctx),
      workspace: process.cwd(),
      fetchImpl,
    })

    await expect(harness.health()).resolves.toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('leaves an explicitly configured remote Harness URL on HTTP', () => {
    const connection = harnessConnection({}, { harnessBaseUrl: 'https://harness.example.test' })
    expect(connection).toEqual({ baseUrl: new URL('https://harness.example.test') })
  })
})

describe('bundled Weixin connection diagnosis', () => {
  it('reports an expired scan token as an actionable stale-token error', async () => {
    const runtime = new WeixinRuntime({
      api: {
        notifyStart: vi.fn(async () => ({ errcode: -14 })),
      },
      config: { botId: 'wx-course', baseUrl: 'https://ilinkai.weixin.qq.com' },
      token: 'expired-token',
      harness: { ensureRunning: vi.fn(async () => true) },
      state: {},
      startRetryDelaysMs: [],
    })

    await expect(runtime.start()).rejects.toMatchObject({
      code: 'stale-token',
      message: '微信登录凭据已失效，请移除账号后重新扫码。',
    })
  })
})

describe('bundled QQ speech bridge', () => {
  it('downloads QQ WAV audio and delegates transcription to ctx.speech', async () => {
    const transcribeAbortable = vi.fn(async () => ({
      ok: true as const,
      value: { text: '课堂口述', provider: 'model-settings' },
    }))
    const fetchImpl = vi.fn(async () => new Response(Buffer.from('qq voice')))
    const transcriber = createDshSpeechTranscriber({ transcribeAbortable }, { fetchImpl })

    await expect(transcriber.transcribe({
      voice_wav_url: 'https://voice.qq.com/course.wav',
    })).resolves.toBe('课堂口述')
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://voice.qq.com/course.wav'),
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    )
    expect(transcribeAbortable).toHaveBeenCalledWith({
      mediaType: 'audio/wav',
      contentBase64: Buffer.from('qq voice').toString('base64'),
    }, undefined)
  })

  it('keeps a platform transcript local and maps shared-provider failures for QQ users', async () => {
    const transcribeAbortable = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'provider-disabled', message: 'no speech model selected' },
      })
    const fetchImpl = vi.fn(async () => new Response(Buffer.from('qq voice')))
    const transcriber = createDshSpeechTranscriber({ transcribeAbortable }, { fetchImpl })

    await expect(transcriber.transcribe({ asr_refer_text: ' 平台转写 ' })).resolves.toBe('平台转写')
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(transcriber.transcribe({
      voice_wav_url: 'https://voice.qq.com/course.wav',
    })).rejects.toMatchObject({
      code: 'dsh-speech-provider-disabled',
      userMessage: '请先在设置 → 模型 → 使用场景中选择并配置语音识别模型。',
    })
  })
})
