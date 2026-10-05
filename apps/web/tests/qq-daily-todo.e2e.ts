/** Conversation-created daily todos persist in the shipped workbench and retain their QQ reminder. */

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh, ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/qq-daily-todo/todo.expected.md', import.meta.url))

class DailyTodoAdapter extends LlmAdapter {
  private step = 0

  constructor(private readonly botId: string) { super() }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Daily todo fixture', context: { contextWindow: 128_000 } })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    const lastResult = options.messages.filter(message => message.role === 'tool').at(-1)
    if (this.step > 0) expect(lastResult).toMatchObject({ isError: false })
    if (this.step === 3) {
      const content = lastResult?.content[0]
      if (content?.type !== 'text') throw new Error('Missing daily todo read-back')
      const readBack: unknown = JSON.parse(content.text)
      expect(readBack).toMatchObject({
        dailyTodos: [{
          title: '对话代办开会', category: 'today', color: 'blue',
          dueAt: '2099-10-06T21:00', completed: false,
          reminder: { channel: 'qq', botId: this.botId },
        }],
      })
      expect(readBack).toHaveProperty('dailyTodos.0.id', expect.any(String))
      expect(readBack).toHaveProperty('dailyTodos.0.createdAt', expect.any(Number))
      expect(readBack).toHaveProperty('dailyTodos.0.updatedAt', expect.any(Number))
      const text = '已读回并确认工作台待办：对话代办开会。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const name = this.step === 1 ? 'teacher_daily_management' : 'teacher_workbench_read'
    const args = JSON.stringify(this.step === 1 ? {
      action: 'save_todo', data: {
        title: '对话代办开会', dueAt: '2099-10-06T21:00',
        reminder: { channel: 'qq', botId: this.botId, rule: { kind: 'once', minutesBefore: 10 } },
      },
    } : { section: 'daily' })
    const id = ToolCallId(`daily-todo-${String(this.step++)}`)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

describe('web e2e: conversation daily todo with QQ reminder', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let harnessHome: string
  let savedBotId: string
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    harnessHome = await mkdtemp(join(tmpdir(), 'dsh-qq-daily-todo-'))
    const desktop = join(harnessHome, 'Desktop')
    vi.stubEnv('DSH_DESKTOP_DIR', desktop)
    const qqDirectory = join(harnessHome, 'integrations', 'dsh-qq')
    await mkdir(qqDirectory, { recursive: true })
    await mkdir(desktop, { recursive: true })
    const appId = '2026100500'
    const digest = createHash('sha256').update(appId).digest('hex').slice(0, 24)
    savedBotId = 'qq_' + digest
    await writeFile(join(qqDirectory, 'config.json'), JSON.stringify({ version: 1, bots: [{
      botId: savedBotId, appId, secretRef: 'DSH_QQBOT_APP_SECRET_' + digest.toUpperCase(),
      ownerUserOpenid: 'todo-test-owner', displayName: '待办测试 QQ', createdAt: '2026-10-05T00:00:00.000Z',
    }] }) + '\n')
    scaffold = await launchWebScaffold({ harnessHome })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'document-upload')
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      try {
        await scaffold?.close()
      } finally {
        vi.unstubAllEnvs()
        if (harnessHome !== undefined) await rm(harnessHome, { recursive: true, force: true })
      }
    }
  })

  it('shows an agent-created 代办 with its QQ reminder in Daily Management after reload', async () => {
    const provider = 'daily-todo-fixture'
    const disposeAdapter = scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter([provider], new DailyTodoAdapter(savedBotId)),
      'scripted Daily Management todo',
    )
    onTestFinished(disposeAdapter)
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('qq-daily-todo'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      agentOptions: { provider, model: 'todo' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    onTestFinished(() => handle.dispose())
    handle.agent.followup(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '添加一条代办，2099年10月6日21点开会，提前10分钟用手机QQ提醒我。' }],
    }))
    await handle.agent.whenIdle()
    const events = handle.agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name))
      .toEqual(['teacher_workbench_read', 'teacher_daily_management', 'teacher_workbench_read'])
    expect(events.filter(event => event.type === 'tool/result').map(event => event.data.message.isError))
      .toEqual([false, false, false])
    const saved = (await scaffold.ctx.teacherWorkbench.read({})).value.state.dailyTodos
      .find(item => item.title === '对话代办开会')
    expect(saved).toMatchObject({
      category: 'today', color: 'blue',
      reminder: { channel: 'qq', botId: savedBotId, rule: { kind: 'once', minutesBefore: 10 } },
    })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    if (!await page.getByRole('button', { name: '日常管理', exact: true }).first().isVisible()) {
      await page.getByRole('button', { name: '打开工作台', exact: true }).click()
    }
    await page.getByRole('button', { name: '日常管理', exact: true }).first().click()
    const today = page.locator('section[aria-labelledby="daily-todo-title"]')
    await today.getByText('对话代办开会', { exact: true }).waitFor()
    expect((await scaffold.ctx.teacherWorkbench.read({})).value.state.dailyTodos.find(item => item.id === saved?.id))
      .toEqual(saved)
    await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, 'section[aria-labelledby="daily-todo-title"]', harnessHome), MODE)
    expect(tripwire.pageErrors).toEqual([])
  })

})
