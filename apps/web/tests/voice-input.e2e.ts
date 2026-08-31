/** QQ-configured voice transcription through the shipped Host and both browser Consumers. */

import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
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
const COMPOSER_EXPECTED = join(SNAPSHOT_DIR, 'composer.expected.md')
const COMPOSER_ERROR_EXPECTED = join(SNAPSHOT_DIR, 'composer-error.expected.md')
const WORKBENCH_EXPECTED = join(SNAPSHOT_DIR, 'workbench.expected.md')
const WORKBENCH_ERROR_EXPECTED = join(SNAPSHOT_DIR, 'workbench-error.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: QQ-configured voice input', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let server: Server
  let configPath: string
  let speechBaseUrl: string
  let successfulUploads = 0
  const uploads: string[] = []
  const configureModel = async (model: string): Promise<void> => {
    await writeFile(configPath, JSON.stringify({
      version: 1,
      speech: {
        enabled: true,
        baseUrl: speechBaseUrl,
        model,
        language: 'zh',
      },
    }))
  }

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => {
        const upload = Buffer.concat(chunks).toString('latin1')
        if (request.method !== 'POST' || request.url !== '/v1/audio/transcriptions') {
          response.writeHead(404).end()
          return
        }
        uploads.push(upload)
        response.setHeader('content-type', 'application/json')
        if (upload.includes('missing-model')) {
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
    speechBaseUrl = `http://127.0.0.1:${String(address.port)}/v1/`
    scaffold = await launchWebScaffold({})
    const qqDirectory = join(scaffold.harnessHome, 'integrations', 'dsh-qq')
    await mkdir(qqDirectory, { recursive: true })
    configPath = join(qqDirectory, 'config.json')
    await configureModel('whisper-large-v3')

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

  it('transcribes the conversation composer through the QQ ASR settings', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-voice-composer'))
    const composer = page.locator('[data-composer-card]')
    await composer.getByRole('button', { name: '语音输入（也可长按空格）' }).click()
    await composer.getByRole('button', { name: '停止语音输入' }).click()
    await expect.poll(
      () => composer.locator('[data-composer-input]').textContent(),
      { timeout: 10_000 },
    ).toBe('课堂口述')
    expect(uploads[0]).toContain('name="model"')
    expect(uploads[0]).toContain('whisper-large-v3')
    expect(uploads[0]).toContain('name="language"')
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
    await configureModel('missing-model')
    try {
      const composer = page.locator('[data-composer-card]')
      await composer.getByRole('button', { name: '语音输入（也可长按空格）' }).click()
      await composer.getByRole('button', { name: '停止语音输入' }).click()
      const message = '语音识别请求失败，请检查服务地址、模型和 API Key'
      await expect.poll(() => uploads.length, { timeout: 10_000 }).toBe(2)
      expect(uploads[1]).toContain('missing-model')
      await page.getByRole('alert').filter({ hasText: message }).waitFor()
      await compareOrRefreshGolden(
        COMPOSER_ERROR_EXPECTED,
        await captureStableAria(page, '[role="alert"]', scaffold.workspaceCwd),
        MODE,
      )
    } finally {
      await configureModel('whisper-large-v3')
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('uses the same QQ ASR settings in Workbench daily management', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-voice-workbench'))
    await page.getByRole('button', { name: '打开工作台' }).click()
    await page.getByRole('button', { name: '日常管理', exact: true }).first().click()
    const todo = page.locator('section[aria-labelledby="daily-todo-title"]')
    await todo.getByRole('button', { name: '开始语音输入' }).click()
    await todo.getByRole('button', { name: '停止语音输入' }).click()
    await expect.poll(
      () => todo.getByLabel('新增今日待办').inputValue(),
      { timeout: 10_000 },
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
    await configureModel('missing-model')
    try {
      const todo = page.locator('section[aria-labelledby="daily-todo-title"]')
      const uploadCount = uploads.length
      await todo.getByRole('button', { name: '开始语音输入' }).click()
      await todo.getByRole('button', { name: '停止语音输入' }).click()
      const message = '语音识别请求失败，请检查服务地址、模型和 API Key'
      await expect.poll(() => uploads.length, { timeout: 10_000 }).toBe(uploadCount + 1)
      await page.getByRole('alert').filter({ hasText: message }).waitFor()
      expect(uploads.at(-1)).toContain('missing-model')
      await compareOrRefreshGolden(
        WORKBENCH_ERROR_EXPECTED,
        await captureStableAria(page, '[role="alert"]', scaffold.workspaceCwd),
        MODE,
      )
    } finally {
      await configureModel('whisper-large-v3')
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'composer-error.expected.md',
      'composer.expected.md',
      'workbench-error.expected.md',
      'workbench.expected.md',
    ])
  })
})
