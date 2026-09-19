import { cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-settings'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  fixtureUserPrompts,
  launchWebScaffold,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/univer-viewer', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')

describe('bundled Univer content tools without their own interface', () => {
  let scaffold: WebScaffold
  let handle: AgentHandle
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    vi.stubEnv('UNIVER_LICENSE', undefined)
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: true })
    await cp(join(SNAPSHOT_DIR, 'workspace'), scaffold.workspaceCwd, { recursive: true })
    handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('univer-viewer'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    for (const prompt of fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))) {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
    }
    const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results.every(event => event.data.message.content.every(block => !block.isError))).toBe(true)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  }, 60_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    vi.unstubAllEnvs()
    if (failures.length > 0) throw new AggregateError(failures, 'Univer Viewer teardown failed')
  })

  it('keeps the recorded draft readable without loading a Viewer or settings card', async () => {
    onTestFailed(() => saveFailureShot(page, 'univer-headless'))
    expect(scaffold.ctx.clientModules.graph().entries.some(entry => entry.id === 'dsh-univer-office')).toBe(false)
    expect(scaffold.ctx.settings.describe().some(row => row.ns === 'univer-office')).toBe(false)
    const requests: string[] = []
    page.on('request', (request) => {
      if (/\/univer-(?:api|viewer)(?:\/|\?)/u.test(request.url())) requests.push(request.url())
    })
    const group = page.getByRole('treeitem').first()
    await group.waitFor({ timeout: 15_000 })
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.getByRole('treeitem').nth(1).click()
    await page.getByText('UNIVER_VIEWER_OK', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await page.locator('iframe[src*="univer-viewer"]').count()).toBe(0)
    expect(requests).toEqual([])
    for (const path of ['/univer-api/status', '/univer-api/state', '/univer-viewer/']) {
      const response = await scaffold.hostFetch(path)
      expect(response.status, path).toBe(404)
    }
    await compareOrRefreshGolden(
      join(SNAPSHOT_DIR, 'ui.expected.md'), await page.getByText('UNIVER_VIEWER_OK', { exact: true }).ariaSnapshot(), scaffold.mode,
    )
  })

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'ui.expected.md', 'workspace'])
  })
})
