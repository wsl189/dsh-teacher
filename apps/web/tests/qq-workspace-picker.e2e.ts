// Web e2e scenario: the shipped QQ settings surface preserves saved workspaces
// and initializes unassigned bots on the desktop. Seeded bots stay offline
// and no model call occurs; the real Host directory listing and third-party
// client module still run through the shipped HTTP and browser composition.

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/qq-workspace-picker', import.meta.url))
const PICKER_EXPECTED = join(SNAPSHOT_DIR, 'picker.expected.md')
const WORKSPACES_EXPECTED = join(SNAPSHOT_DIR, 'workspaces.expected.md')
const MODE = webSnapshotMode()

async function openQqSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置' })
  await settings.waitFor({ timeout: 10_000 })
  await settings.getByRole('button', { name: '插件', exact: true }).click()
  const connected = settings.getByRole('tab', { name: '连接平台', exact: true })
  await connected.click()
  await settings.getByRole('tab', { name: '连接平台', exact: true, selected: true }).waitFor({ timeout: 5_000 })
  await settings.getByRole('tab', { name: 'QQ', exact: true }).click()
  await settings.getByRole('heading', { name: '已绑定的 QQ 机器人' }).waitFor({ timeout: 10_000 })
}

describe('web e2e: QQ bot workspace defaults and directory picker', () => {
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

    scaffold = await launchWebScaffold({ harnessHome })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openQqSettings(page)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (harnessHome !== undefined) await rm(harnessHome, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('initializes an unassigned bot on the desktop without replacing an existing workspace', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-qq-desktop-default'))
    expect(await page.getByText('语音模型', { exact: true }).count()).toBe(0)
    expect(await page.getByLabel('ASR Base URL').count()).toBe(0)
    const newWorkspace = page.locator(`[data-bot-id="${newBotId}"] .dim-workspacePath`)
    const existingWorkspace = page.locator(`[data-bot-id="${savedBotId}"] .dim-workspacePath`)
    await expect.poll(() => newWorkspace.textContent()).toBe(desktop)
    expect(await existingWorkspace.textContent()).toBe(savedWorkspace)
    expect(JSON.parse(await readFile(workspacesPath, 'utf8'))).toEqual({
      version: 1,
      workspaces: { [newBotId]: desktop, [savedBotId]: savedWorkspace },
    })
    await compareOrRefreshGolden(
      WORKSPACES_EXPECTED,
      await captureStableAria(page, '.dim-botList', harnessHome),
      MODE,
    )
  })

  it('lists Host directories instead of invoking an operating-system dialog', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-qq-workspace-picker'))
    let rootRequests = 0
    await page.route('**/api/directoryPicker/listRoots', async (route) => {
      const envelope = route.request().postDataJSON() as { rpcId: string }
      rootRequests += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: {
            ok: true,
            value: [
              { name: 'C:\\', path: 'C:\\', hidden: false },
              { name: 'D:\\', path: 'D:\\', hidden: false },
            ],
          },
        }),
      })
    })
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
    const drive = picker.getByRole('combobox', { name: '选择磁盘' })
    await drive.waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      PICKER_EXPECTED,
      await captureStableAria(page, '.dim-directoryPicker', harnessHome),
      MODE,
    )
    await drive.selectOption('D:\\')
    await picker.getByRole('button', { name: '跨盘课程' }).waitFor({ timeout: 10_000 })
    expect(await drive.inputValue()).toBe('D:\\')
    expect(rootRequests).toBe(1)
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
    expect(JSON.parse(await readFile(workspacesPath, 'utf8'))).toEqual({
      version: 1,
      workspaces: { [newBotId]: selected, [savedBotId]: savedWorkspace },
    })

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openQqSettings(page)
    await expect.poll(() => bot.locator('.dim-workspacePath').textContent()).toBe(selected)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['picker.expected.md', 'workspaces.expected.md'])
  })
})
