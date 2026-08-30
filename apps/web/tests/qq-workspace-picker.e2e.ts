// Web e2e scenario: the shipped QQ settings surface opens its workspace
// picker through the composed browse capability. The seeded bot stays offline
// and no model call occurs; the real Host directory listing and third-party
// client module still run through the shipped HTTP and browser composition.

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/qq-workspace-picker', import.meta.url))
const PICKER_EXPECTED = join(SNAPSHOT_DIR, 'picker.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: QQ bot workspace directory picker', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let harnessHome: string

  beforeAll(async () => {
    harnessHome = await mkdtemp(join(tmpdir(), 'dsh-web-e2e-qq-picker-home-'))
    const appId = '1029384756'
    const digest = createHash('sha256').update(appId).digest('hex').slice(0, 24)
    const qqDirectory = join(harnessHome, 'integrations', 'dsh-qq')
    await mkdir(qqDirectory, { recursive: true })
    await writeFile(join(qqDirectory, 'config.json'), `${JSON.stringify({
      version: 1,
      bots: [{
        botId: `qq_${digest}`,
        appId,
        secretRef: `DSH_QQBOT_APP_SECRET_${digest.toUpperCase()}`,
        ownerUserOpenid: 'qq-picker-owner',
        displayName: '目录选择测试机器人',
        createdAt: '2026-08-30T00:00:00.000Z',
      }],
    }, null, 2)}\n`)

    scaffold = await launchWebScaffold({ harnessHome })
    await mkdir(join(scaffold.workspaceCwd, '课程资料'))
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (harnessHome !== undefined) await rm(harnessHome, { recursive: true, force: true })
  })

  it('lists Host directories instead of invoking an operating-system dialog', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-qq-workspace-picker'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '插件', exact: true }).click()
    const connected = settings.getByRole('tab', { name: '连接平台', exact: true })
    await connected.click()
    await expect.poll(() => connected.getAttribute('aria-selected'), { timeout: 5_000 }).toBe('true')
    await settings.getByRole('tab', { name: 'QQ', exact: true }).click()
    await settings.getByRole('heading', { name: '已绑定的 QQ 机器人' }).waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '选择目录', exact: true }).click()

    const picker = page.getByRole('dialog', { name: '选择机器人工作区目录' })
    await picker.getByRole('button', { name: '选择此目录' }).waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      PICKER_EXPECTED,
      await captureStableAria(page, '.dim-directoryPicker', scaffold.workspaceCwd),
      MODE,
    )
    expect(await picker.getByRole('button', { name: '课程资料' }).count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['picker.expected.md'])
  })
})
