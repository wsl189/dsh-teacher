// Web e2e: a bundled image-generation Tool result remains beside the final
// Assistant answer as an independent Chat node. The scenario cold-seeds one
// closed Turn and a real attachment, so it exercises the shipped Client graph,
// provider-owned loopback route, compact-process boundary, browser image load,
// wheel zoom, and native save handoff without a model or image-provider network call.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/image-generation-result', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL(
  './expected/image-generation-result/ui.expected.md', import.meta.url,
))
const MODE = webSnapshotMode()
const SEED_ID = 'image-generation-result-web-e2e'
const DONE = 'IMAGE_GENERATION_RESULT_DONE'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

/** Build one settled image-generation Turn with provider presentation metadata. */
function imageGenerationFixture(image: ImageAttachmentRef): string {
  const session = Session.create(SessionId('image-generation-result-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Generate a preview image.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Generated image preview', messageSeqs: [user.seq], source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  const callId = ToolCallId('image-generation-call')
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{
        type: 'tool-call', id: callId, name: 'generate_image',
        arguments: JSON.stringify({ prompt: 'a red pixel' }),
      }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  const source = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'generate_image',
    arguments: JSON.stringify({ prompt: 'a red pixel' }),
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: '{"status":"completed"}' }],
      isError: false,
    }),
    meta: {
      images: [{
        attachment_id: String(image.attachmentId),
        media_type: image.mediaType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        ...(image.name === undefined ? {} : { name: image.name }),
      }],
    },
  }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `The image is ready.\n\n${DONE}` }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event, time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: generated images follow the final answer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const image = await scaffold.ctx.attachments.saveImage({
      data: PNG,
      mediaType: 'image/png',
      name: 'generated-preview.webp',
    })
    expect(image).toMatchObject({ mediaType: 'image/webp', width: 1, height: 1, name: 'generated-preview.webp' })
    await seedSession(scaffold, imageGenerationFixture(image), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('renders a real image node after the answer and outside compact process folding', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-image-generation-result'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    const imageRow = page.locator('[data-chat-flow-kind="image-generation-result"]')
    await imageRow.waitFor({ timeout: 15_000 })
    const preview = imageRow.getByAltText('generated-preview.webp')
    await expect.poll(() => preview.evaluate((element) => {
      const image = element as HTMLImageElement
      return image.complete && image.naturalWidth
    }), { timeout: 15_000 }).toBe(1)

    const kinds = await page.locator('[data-chat-flow-kind]').evaluateAll(elements =>
      elements.map(element => element.getAttribute('data-chat-flow-kind')))
    const answerIndex = kinds.lastIndexOf('assistant-step')
    const imageIndex = kinds.indexOf('image-generation-result')
    const tailIndex = kinds.indexOf('turn-tail')
    expect(answerIndex).toBeGreaterThanOrEqual(0)
    expect(imageIndex).toBeGreaterThan(answerIndex)
    expect(tailIndex).toBeGreaterThan(imageIndex)
    expect(await imageRow.getAttribute('data-turn-process-hidden')).toBeNull()
    const open = imageRow.getByRole('button', {
      name: 'generated-preview.webp, click to view original',
    })
    const card = imageRow.locator('[data-generated-image-card]')
    const download = imageRow.getByRole('button', { name: 'Download image generated-preview.webp' })
    expect(await download.evaluate(element => getComputedStyle(element).opacity)).toBe('0')
    await card.hover()
    await expect.poll(() => download.evaluate(element => getComputedStyle(element).opacity)).toBe('1')

    await page.evaluate(() => {
      const probe = { suggestedName: '', writes: [] as Array<{ type: string; size: number }>, closed: 0 }
      Reflect.set(window, '__dshGeneratedImageSaveProbe', probe)
      Reflect.set(window, 'showSaveFilePicker', async (options: { readonly suggestedName: string }) => {
        probe.suggestedName = options.suggestedName
        return {
          createWritable: async () => ({
            write: async (blob: Blob) => { probe.writes.push({ type: blob.type, size: blob.size }) },
            close: async () => { probe.closed += 1 },
          }),
        }
      })
    })
    await download.click()
    await expect.poll(() => page.evaluate(() => {
      const probe: unknown = Reflect.get(window, '__dshGeneratedImageSaveProbe')
      return probe
    }))
      .toMatchObject({ suggestedName: 'generated-preview.webp', writes: [{ type: 'image/webp' }], closed: 1 })

    await open.click()
    const dialog = page.getByRole('dialog', { name: 'Original image preview' })
    await dialog.waitFor()
    const viewport = dialog.locator('[data-generated-image-preview-viewport]')
    await viewport.hover()
    await page.mouse.wheel(0, -120)
    await expect.poll(() => dialog.getAttribute('data-zoom')).toBe('1.25')
    await page.mouse.wheel(0, 120)
    await expect.poll(() => dialog.getAttribute('data-zoom')).toBe('1')
    await dialog.getByRole('button', { name: 'Close original image preview' }).click()
    await expect.poll(() => dialog.count()).toBe(0)

    const snapshot = (await captureStableAria(
      page, '[data-image-generation-results]', scaffold.workspaceCwd,
    )).replace(/blob:http:\/\/127\.0\.0\.1:\d+\//g, 'blob:http://127.0.0.1:{{port}}/')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
