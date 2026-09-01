/** Supplier-selected voice transcription through the shipped Host and both browser Consumers. */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-default-model'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/voice-input', import.meta.url))
const COMPOSER_RECORDING_EXPECTED = join(SNAPSHOT_DIR, 'composer-recording.expected.md')
const COMPOSER_EXPECTED = join(SNAPSHOT_DIR, 'composer.expected.md')
const COMPOSER_ERROR_EXPECTED = join(SNAPSHOT_DIR, 'composer-error.expected.md')
const WORKBENCH_RECORDING_EXPECTED = join(SNAPSHOT_DIR, 'workbench-recording.expected.md')
const WORKBENCH_EXPECTED = join(SNAPSHOT_DIR, 'workbench.expected.md')
const WORKBENCH_ERROR_EXPECTED = join(SNAPSHOT_DIR, 'workbench-error.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: supplier-selected voice input', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let server: Server
  let successfulUploads = 0
  let rejectNextUpload = false
  const uploads: string[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => {
        const upload = Buffer.concat(chunks).toString('latin1')
        if (request.method !== 'POST' || request.url !== '/audio/transcriptions') {
          response.writeHead(404).end()
          return
        }
        uploads.push(upload)
        response.setHeader('content-type', 'application/json')
        if (rejectNextUpload) {
          rejectNextUpload = false
          response.writeHead(404).end(JSON.stringify({ detail: 'model is not installed' }))
          return
        }
        successfulUploads += 1
        response.end(JSON.stringify({
          text: successfulUploads === 1 ? '课堂口述' : '批改语音作业',
        }))
      })
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address() as AddressInfo
    scaffold = await launchWebScaffold({
      speechEndpoint: `http://127.0.0.1:${String(address.port)}/audio/transcriptions`,
    })
    await scaffold.ctx.settings.update(settingsNamespace('llm-pi-ai'), {
      providers: {
        'zhipu-cn': {
          displayName: 'Zhipu GLM Standard API',
          apiKeyEnv: 'ZHIPU_CN_API_KEY',
          api: 'openai-completions',
          baseURL: 'https://open.bigmodel.cn/api/paas/v4',
          models: [{ id: 'glm-5.2', name: 'GLM-5.2', input: ['text'] }],
        },
      },
    })
    await scaffold.ctx.credentials.set(credentialRef('ZHIPU_CN_API_KEY'), 'voice-input-e2e-key')
    await scaffold.ctx.settings.update(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      speechProvider: 'zhipu-cn',
      speechModel: 'glm-asr-2512',
    })

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    await page.addInitScript(() => {
      class DeterministicMediaRecorder {
        static isTypeSupported(mediaType: string): boolean {
          return mediaType === 'audio/webm;codecs=opus'
        }

        readonly mimeType: string
        state: RecordingState = 'inactive'
        ondataavailable: ((event: BlobEvent) => void) | null = null
        onerror: ((event: Event & { readonly error: DOMException }) => void) | null = null
        onstop: (() => void) | null = null

        constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
          this.mimeType = options?.mimeType ?? 'audio/webm'
        }

        start(): void { this.state = 'recording' }

        stop(): void {
          this.state = 'inactive'
          this.ondataavailable?.({
            data: new Blob([Uint8Array.of(1, 2, 3)], { type: this.mimeType }),
          } as BlobEvent)
          this.onstop?.()
        }
      }
      class DeterministicAudioContext {
        createMediaStreamSource(_stream: MediaStream): MediaStreamAudioSourceNode {
          return {
            connect: () => {},
            disconnect: () => {},
          } as unknown as MediaStreamAudioSourceNode
        }

        createAnalyser(): AnalyserNode {
          let audibleFrames = 4
          return {
            fftSize: 256,
            smoothingTimeConstant: 0,
            getByteTimeDomainData: (samples: Uint8Array) => {
              const amplitude = audibleFrames > 0 ? 20 : 0
              audibleFrames -= 1
              for (let index = 0; index < samples.length; index += 1) {
                samples[index] = 128 + (index % 2 === 0 ? amplitude : -amplitude)
              }
            },
          } as unknown as AnalyserNode
        }

        async decodeAudioData(_audioData: ArrayBuffer): Promise<AudioBuffer> {
          const samples = Float32Array.from([0.25, 0.25, 0.25, -0.25, -0.25, -0.25])
          return {
            length: samples.length,
            numberOfChannels: 1,
            sampleRate: 48_000,
            getChannelData: () => samples,
          } as unknown as AudioBuffer
        }

        close(): Promise<void> { return Promise.resolve() }
        resume(): Promise<void> { return Promise.resolve() }
      }
      Object.defineProperty(window, 'MediaRecorder', {
        configurable: true,
        value: DeterministicMediaRecorder,
      })
      Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        value: DeterministicAudioContext,
      })
      Object.defineProperty(window.navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }),
        },
      })
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[data-composer-card]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'qq-voice')
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve) => { server?.close(() => { resolve() }) })
  })

  it('transcribes the conversation composer through the selected supplier model', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-voice-composer'))
    const composer = page.locator('[data-composer-card]')
    const idleVoice = composer.getByRole('button', { name: '语音输入（也可长按空格）' })
    const idleClass = await idleVoice.getAttribute('class')
    await idleVoice.click()
    const activeVoice = composer.getByRole('button', { name: '停止语音输入' })
    await activeVoice.waitFor()
    expect(await activeVoice.getAttribute('class')).toBe(idleClass)
    await expect.poll(async () => Number(await activeVoice.locator('[data-voice-level]').getAttribute('data-voice-level')))
      .toBeGreaterThan(0.8)
    await compareOrRefreshGolden(
      COMPOSER_RECORDING_EXPECTED,
      await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd),
      MODE,
    )
    await expect.poll(
      () => composer.locator('[data-composer-input]').textContent(),
      { timeout: 12_000 },
    ).toBe('课堂口述')
    expect(uploads[0]).toContain('name="model"')
    expect(uploads[0]).toContain('glm-asr-2512')
    expect(uploads[0]).toContain('name="stream"')
    expect(uploads[0]).toContain('false')
    expect(uploads[0]).toContain('name="file"; filename="voice-input.wav"')
    expect(uploads[0]).toContain('Content-Type: audio/wav')
    await compareOrRefreshGolden(
      COMPOSER_EXPECTED,
      await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd),
      MODE,
    )
    expect(tripwire.pageErrors).toEqual([])
  })

  it('reports a rejected model request without calling it a network error in the composer', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-voice-composer-error'))
    rejectNextUpload = true
    const composer = page.locator('[data-composer-card]')
    await composer.getByRole('button', { name: '语音输入（也可长按空格）' }).click()
    await composer.getByRole('button', { name: '停止语音输入' }).click()
    const message = '语音识别请求失败，请检查服务地址、模型和 API Key'
    await expect.poll(() => uploads.length, { timeout: 10_000 }).toBe(2)
    expect(uploads[1]).toContain('glm-asr-2512')
    await page.getByRole('alert').filter({ hasText: message }).waitFor()
    await compareOrRefreshGolden(
      COMPOSER_ERROR_EXPECTED,
      await captureStableAria(page, '[role="alert"]', scaffold.workspaceCwd),
      MODE,
    )
    expect(tripwire.pageErrors).toEqual([])
  })

  it('uses the same supplier speech assignment in Workbench daily management', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-voice-workbench'))
    await page.getByRole('button', { name: '打开工作台' }).click()
    await page.getByRole('button', { name: '日常管理', exact: true }).first().click()
    const todo = page.locator('section[aria-labelledby="daily-todo-title"]')
    const idleVoice = todo.getByRole('button', { name: '开始语音输入' })
    const idleClass = await idleVoice.getAttribute('class')
    await idleVoice.click()
    const activeVoice = todo.getByRole('button', { name: '停止语音输入' })
    await activeVoice.waitFor()
    expect(await activeVoice.getAttribute('class')).toBe(idleClass)
    await expect.poll(async () => Number(await activeVoice.locator('[data-voice-level]').getAttribute('data-voice-level')))
      .toBeGreaterThan(0.8)
    await compareOrRefreshGolden(
      WORKBENCH_RECORDING_EXPECTED,
      await captureStableAria(page, 'section[aria-labelledby="daily-todo-title"]', scaffold.workspaceCwd),
      MODE,
    )
    await expect.poll(
      () => todo.getByLabel('新增今日待办').inputValue(),
      { timeout: 12_000 },
    ).toBe('批改语音作业')
    expect(uploads).toHaveLength(3)
    await compareOrRefreshGolden(
      WORKBENCH_EXPECTED,
      await captureStableAria(page, 'section[aria-labelledby="daily-todo-title"]', scaffold.workspaceCwd),
      MODE,
    )
    expect(tripwire.pageErrors).toEqual([])
  })

  it('reports the same rejected model request in Workbench daily management', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-voice-workbench-error'))
    await expect.poll(() => page.getByRole('alert').count(), { timeout: 6_000 }).toBe(0)
    rejectNextUpload = true
    const todo = page.locator('section[aria-labelledby="daily-todo-title"]')
    const uploadCount = uploads.length
    await todo.getByRole('button', { name: '开始语音输入' }).click()
    await todo.getByRole('button', { name: '停止语音输入' }).click()
    const message = '语音识别请求失败，请检查服务地址、模型和 API Key'
    await expect.poll(() => uploads.length, { timeout: 10_000 }).toBe(uploadCount + 1)
    await page.getByRole('alert').filter({ hasText: message }).waitFor()
    expect(uploads.at(-1)).toContain('glm-asr-2512')
    await compareOrRefreshGolden(
      WORKBENCH_ERROR_EXPECTED,
      await captureStableAria(page, '[role="alert"]', scaffold.workspaceCwd),
      MODE,
    )
    expect(tripwire.pageErrors).toEqual([])
  })

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'composer-error.expected.md',
      'composer-recording.expected.md',
      'composer.expected.md',
      'workbench-error.expected.md',
      'workbench-recording.expected.md',
      'workbench.expected.md',
    ])
  })
})
