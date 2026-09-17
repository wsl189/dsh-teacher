// Web e2e scenario: the shipped QQ settings surface preserves saved workspaces
// and initializes unassigned bots on the desktop. Seeded bots stay offline;
// reminder discovery uses a scripted model and the real bundled IM provider.

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import {
  createUserMessage, LlmAdapter, ToolCallId,
  type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  fixtureUserPrompts,
  launchWebScaffold,
  recordFixture,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/qq-workspace-picker', import.meta.url))
const PICKER_EXPECTED = join(SNAPSHOT_DIR, 'picker.expected.md')
const WORKSPACES_EXPECTED = join(SNAPSHOT_DIR, 'workspaces.expected.md')
const MODE = webSnapshotMode()
const SESSION_DIR = fileURLToPath(new URL('../../../snapshots/web/qq-reminder-discovery', import.meta.url))
const SESSION_FIXTURE = join(SESSION_DIR, 'session.v3.jsonl')
const PROVIDER = 'qq-reminder-fixture'
const PROMPT = 'Read Daily Management and list the configured reminder bots. Do not change data or send a message.'

class ReminderDiscoveryAdapter extends LlmAdapter {
  private called = false

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Reminder discovery', context: { contextWindow: 128_000 } })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    if (!this.called) {
      this.called = true
      const id = ToolCallId('read-reminder-bots')
      const name = 'teacher_workbench_read'
      const args = JSON.stringify({ section: 'daily' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = 'Two configured QQ bots are available for reminder selection; both are offline.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function openQqSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置' })
  await settings.waitFor({ timeout: 10_000 })
  await settings.getByRole('button', { name: 'IM机器人', exact: true }).click()
  await settings.getByRole('tab', { name: 'QQ', exact: true }).click()
  await settings.getByRole('heading', { name: '已绑定的 QQ 机器人' }).waitFor({ timeout: 10_000 })
  await settings.locator('.dim-botCard').first().waitFor()
  for (const card of await settings.locator('.dim-botCard').all()) await card.locator('.dim-collapsibleHead').click()
}

describe.skipIf(MODE === 'record')('web e2e: QQ bot workspace defaults and directory picker', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let harnessHome: string
  let desktop: string
  let savedWorkspace: string
  let workspacesPath: string
  let newBotId: string
  let savedBotId: string

  beforeAll(async () => {
    harnessHome = await mkdtemp(join(tmpdir(), 'dsh-web-e2e-qq-picker-home-'))
    desktop = join(harnessHome, 'OneDrive', 'Desktop')
    savedWorkspace = join(harnessHome, 'saved-workspace')
    vi.stubEnv('DSH_DESKTOP_DIR', desktop)
    await mkdir(join(desktop, '课程资料'), { recursive: true })
    await mkdir(join(savedWorkspace, '课程资料'), { recursive: true })
    const bots = ['1029384756', '5647382910'].map((appId, index) => {
      const digest = createHash('sha256').update(appId).digest('hex').slice(0, 24)
      return {
        botId: `qq_${digest}`,
        appId,
        secretRef: `DSH_QQBOT_APP_SECRET_${digest.toUpperCase()}`,
        ownerUserOpenid: 'qq-picker-owner',
        displayName: index === 0 ? '新建机器人' : '已有机器人',
        createdAt: '2026-08-30T00:00:00.000Z',
      }
    })
    newBotId = bots[0]!.botId
    savedBotId = bots[1]!.botId
    const qqDirectory = join(harnessHome, 'integrations', 'dsh-qq')
    await mkdir(qqDirectory, { recursive: true })
    await writeFile(join(qqDirectory, 'config.json'), `${JSON.stringify({
      version: 1,
      bots,
    }, null, 2)}\n`)
    workspacesPath = join(qqDirectory, 'workspaces.json')
    await writeFile(workspacesPath, `${JSON.stringify({
      version: 1,
      workspaces: { [savedBotId]: savedWorkspace },
    }, null, 2)}\n`)

    scaffold = await launchWebScaffold({
      harnessHome,
      ...(MODE === 'refresh' ? {} : {
        replayFixture: SESSION_FIXTURE,
        replayProviders: [{
          id: PROVIDER, name: PROVIDER,
          models: [{ id: 'discovery', name: 'Reminder discovery', contextWindow: 128_000 }],
        }],
      }),
    })
    if (MODE === 'refresh') {
      scaffold.ctx.effect(
        () => scaffold.ctx.llm.registerAdapter([PROVIDER], new ReminderDiscoveryAdapter()),
        'scripted QQ reminder discovery',
      )
    }
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openQqSettings(page)
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      try {
        const notifications = scaffold?.ctx.get('mobileNotifications')
        await scaffold?.close()
        if (notifications !== undefined) expect(await notifications.listTargets()).toEqual([])
      } finally {
        try {
          if (harnessHome !== undefined) await rm(harnessHome, { recursive: true, force: true })
        } finally {
          vi.unstubAllEnvs()
        }
      }
    }
  })

  it('initializes an unassigned bot on the desktop without replacing an existing workspace', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-qq-desktop-default'))
    expect(await page.getByText('语音模型', { exact: true }).count()).toBe(0)
    expect(await page.getByLabel('ASR Base URL').count()).toBe(0)
    const newWorkspace = page.locator(`[data-bot-id="${newBotId}"] .dim-workspacePath`)
    const existingWorkspace = page.locator(`[data-bot-id="${savedBotId}"] .dim-workspacePath`)
    await expect.poll(() => newWorkspace.textContent()).toBe(desktop)
    expect(await existingWorkspace.textContent()).toBe(savedWorkspace)
    expect(JSON.parse(await readFile(workspacesPath, 'utf8'))).toMatchObject({
      version: 2,
      workspaces: { [newBotId]: desktop, [savedBotId]: savedWorkspace },
    })
    await compareOrRefreshGolden(
      WORKSPACES_EXPECTED,
      await captureStableAria(page, '.dim-botList', harnessHome),
      MODE,
    )
  })

  it('lists Host directories and accepts an absolute Windows drive path', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-qq-workspace-picker'))
    await page.route('**/api/directoryPicker/list', async (route) => {
      const envelope = route.request().postDataJSON() as {
        rpcId: string
        payload: { args: { path?: string } }
      }
      if (envelope.payload.args.path !== 'D:\\') {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: {
            ok: true,
            value: {
              path: 'D:\\',
              home: 'C:\\Users\\teacher',
              crumbs: [{ name: 'D:\\', path: 'D:\\', hidden: false }],
              entries: [{ name: '跨盘课程', path: 'D:\\跨盘课程', hidden: false }],
              truncated: false,
            },
          },
        }),
      })
    })
    await page.locator(`[data-bot-id="${savedBotId}"]`).getByRole('button', { name: '选择目录', exact: true }).click()

    const picker = page.getByRole('dialog', { name: '选择机器人工作区目录' })
    await picker.getByRole('button', { name: '选择此目录' }).waitFor({ timeout: 10_000 })
    await picker.getByRole('button', { name: '课程资料' }).waitFor({ timeout: 10_000 })
    const pathInput = picker.getByRole('textbox', { name: '工作区绝对路径' })
    await pathInput.waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      PICKER_EXPECTED,
      await captureStableAria(page, '.dim-directoryPicker', harnessHome),
      MODE,
    )
    await pathInput.fill('D:\\')
    await picker.getByRole('button', { name: '前往', exact: true }).click()
    await picker.getByRole('button', { name: '跨盘课程' }).waitFor({ timeout: 10_000 })
    expect(await pathInput.inputValue()).toBe('D:\\')
    expect(tripwire.pageErrors).toEqual([])
    await picker.getByRole('button', { name: '取消', exact: true }).click()
  }, 60_000)

  it('persists a user-selected workspace for the new bot across page reloads', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-qq-workspace-save'))
    const bot = page.locator(`[data-bot-id="${newBotId}"]`)
    await bot.getByRole('button', { name: '选择目录', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择机器人工作区目录' })
    await picker.getByRole('button', { name: '课程资料', exact: true }).click()
    const selected = join(desktop, '课程资料')
    await picker.getByRole('navigation', { name: '当前目录' }).getByRole('button', { name: '课程资料' }).waitFor()
    await picker.getByRole('button', { name: '选择此目录', exact: true }).click()
    await expect.poll(() => bot.locator('.dim-workspacePath').textContent()).toBe(selected)
    expect(JSON.parse(await readFile(workspacesPath, 'utf8'))).toMatchObject({
      version: 2,
      workspaces: { [newBotId]: selected, [savedBotId]: savedWorkspace },
    })

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openQqSettings(page)
    await expect.poll(() => bot.locator('.dim-workspacePath').textContent()).toBe(selected)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('records configured QQ reminder bots through the real Daily Management tool', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('qq-reminder-discovery'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      agentOptions: { provider: PROVIDER, model: 'discovery' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    onTestFinished(() => handle.dispose())
    const prompts = MODE === 'refresh' ? [PROMPT] : fixtureUserPrompts(await readFile(SESSION_FIXTURE, 'utf8'))
    expect(prompts).toEqual([PROMPT])
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompts[0]! }] }))
    await handle.agent.whenIdle()
    await scaffold.ctx.sessions.flush(handle.agent.session)
    const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    const result = results[0]!.data.message.content[0]
    if (result?.type !== 'tool-result') throw new Error('Missing Daily Management tool result')
    expect(result.isError).not.toBe(true)
    const content = result.content[0]
    if (content?.type !== 'text') throw new Error('Missing Daily Management JSON')
    expect(JSON.parse(content.text)).toMatchObject({
      notificationTargets: [
        { channel: 'qq', botId: newBotId, connected: false },
        { channel: 'qq', botId: savedBotId, connected: false },
      ],
    })
    if (MODE === 'refresh') await recordFixture(scaffold, handle.agent.session.id, SESSION_FIXTURE)
  })

  it('offers configured QQ bots in Daily Management and persists the selected reminder', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-qq-workbench-reminder'))
    const targets = await scaffold.ctx.teacherWorkbench.listNotificationTargets({})
    expect(targets.map(target => ({ channel: target.channel, botId: target.botId, connected: target.connected })))
      .toEqual([
        { channel: 'qq', botId: newBotId, connected: false },
        { channel: 'qq', botId: savedBotId, connected: false },
      ])
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '打开工作台' }).click()
    await page.getByRole('button', { name: '日常管理', exact: true }).first().click()
    const today = page.locator('section[aria-labelledby="daily-todo-title"]')
    await today.getByLabel('新增今日待办').fill('QQ 提醒回归检查')
    const targetsLoaded = page.waitForResponse(response => response.url().endsWith('/api/teacherWorkbench/listNotificationTargets'))
    await today.getByRole('button', { name: '截止时间', exact: true }).click()
    expect((await targetsLoaded).ok()).toBe(true)
    const editor = page.getByRole('dialog', { name: '设置截止时间与提醒' })
    await editor.getByLabel('截止时间', { exact: true }).fill('2099-09-17T18:30')
    await editor.getByRole('checkbox', { name: '发送手机机器人提醒' }).check()
    expect(await editor.getByText('还没有可用机器人', { exact: false }).count()).toBe(0)
    expect(await editor.getByRole('combobox', { name: '手机平台' }).inputValue()).toBe('qq')
    await editor.getByRole('combobox', { name: '机器人' }).selectOption(savedBotId)
    await compareOrRefreshGolden(
      join(SNAPSHOT_DIR, 'reminder.expected.md'),
      await captureStableAria(page, '[role="dialog"]', harnessHome),
      MODE,
    )
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
    await today.getByRole('button', { name: '添加待办', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.teacherWorkbench.read({})).value.state.dailyTodos)
      .toMatchObject([{
        title: 'QQ 提醒回归检查',
        reminder: { channel: 'qq', botId: savedBotId, rule: { kind: 'once', minutesBefore: 30 } },
      }])
    await page.reload({ waitUntil: 'load' })
    expect((await scaffold.ctx.teacherWorkbench.read({})).value.state.dailyTodos[0]?.reminder?.botId).toBe(savedBotId)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['picker.expected.md', 'workspaces.expected.md', 'reminder.expected.md'])
    await assertFixtureInventory(SESSION_DIR, ['session.v3.jsonl'])
  })
})
