import { cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  fixtureUserPrompts,
  launchWebScaffold,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/univer-viewer', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')

describe('bundled Univer Viewer without a license', () => {
  let scaffold: WebScaffold
  let handle: AgentHandle
  let browser: Browser
  let page: Page
  let viewerUrl: string

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
    const results = handle.agent.session.events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results.every(event => event.data.message.content.every(block => !block.isError))).toBe(true)
    const query = new URLSearchParams({
      file: join(scaffold.workspaceCwd, 'evaluation.univer'), sessionId: String(handle.agent.session.id),
    })
    const response = await scaffold.hostFetch('/univer-api/state?' + query.toString())
    expect(response.status).toBe(200)
    const state = await response.json() as { gateway: string; worktrees: { worktreeUrl: string }[] }
    expect(await (await fetch(state.gateway + '/runtime-config')).json()).toEqual({ license: '' })
    const worktree = state.worktrees[0]
    if (worktree === undefined) throw new Error('the recorded Univer Sheet has no draft worktree')
    viewerUrl = worktree.worktreeUrl
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
  }, 60_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    vi.unstubAllEnvs()
    if (failures.length > 0) throw new AggregateError(failures, 'Univer Viewer teardown failed')
  })

  it('opens the recorded draft Sheet with the upstream evaluation limits', async () => {
    onTestFailed(() => saveFailureShot(page, 'univer-viewer-unlicensed'))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(viewerUrl, { waitUntil: 'load' })
    await page.getByText('Sheet1', { exact: true }).waitFor({ timeout: 20_000 })
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('tab', { name: 'Formulas', exact: true }).waitFor({ timeout: 20_000 })
    await page.getByText('General', { exact: true }).waitFor({ timeout: 20_000 })
    expect(await page.locator('body').innerText()).not.toContain('requires a valid UNIVER_LICENSE')
    expect(errors).toEqual([])
    await compareOrRefreshGolden(
      join(SNAPSHOT_DIR, 'ui.expected.md'), await page.locator('body').ariaSnapshot(), scaffold.mode,
    )
  })

  it('still rejects a malformed runtime license value', async () => {
    await page.route('**/runtime-config', route => route.fulfill({ json: { license: 123 } }))
    await page.goto(viewerUrl, { waitUntil: 'load' })
    await page.getByText(/requires a valid UNIVER_LICENSE/).waitFor({ timeout: 20_000 })
    expect(await page.locator('canvas').count()).toBe(0)
  })

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'ui.expected.md', 'workspace'])
  })
})

it('forwards an explicitly configured license to the Univer Viewer', async () => {
  vi.stubEnv('UNIVER_LICENSE', ' configured-license ')
  let scaffold: WebScaffold | undefined
  try {
    scaffold = await launchWebScaffold()
    const response = await scaffold.hostFetch('/univer-api/gateway/start', { method: 'POST' })
    const started = await response.json() as { ok: boolean; gateway: string }
    expect(started.ok).toBe(true)
    expect(await (await fetch(started.gateway + '/runtime-config')).json()).toEqual({ license: 'configured-license' })
  } finally {
    try {
      await scaffold?.close()
    } finally {
      vi.unstubAllEnvs()
    }
  }
})
