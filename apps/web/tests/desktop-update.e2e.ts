/** Desktop updater projection through the real shipped Web composition. */

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/desktop-update', import.meta.url))
const CURRENT_EXPECTED = join(SNAPSHOT_DIR, 'current.expected.md')
const AVAILABLE_EXPECTED = join(SNAPSHOT_DIR, 'available.expected.md')
const MODE = webSnapshotMode()
const CURRENT_VERSION = '1.0.7-rc1'
const VERSION = '9.9.9'

describe('web e2e: desktop update action', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    await page.addInitScript((currentVersion) => {
      type State =
        | { status: 'up-to-date'; version: string }
        | { status: 'available'; version: string }
        | { status: 'downloading'; version: string; percent: number }
        | { status: 'downloaded'; version: string }
      let state: State = { status: 'up-to-date', version: currentVersion }
      let nextId = 1
      const listeners = new Map<number, (next: State) => void>()
      const publish = (next: State): void => {
        state = next
        for (const listener of listeners.values()) listener(state)
      }
      Object.defineProperty(window, 'dshDesktopUpdate', {
        configurable: false,
        value: Object.freeze({
          getState: () => state,
          subscribe(listener: (next: State) => void) {
            const id = nextId
            nextId += 1
            listeners.set(id, listener)
            listener(state)
            return id
          },
          unsubscribe(id: number) { listeners.delete(id) },
          async download() { publish({ status: 'downloading', version: '9.9.9', percent: 37 }) },
          async install() { window.__desktopUpdateInstalls += 1 },
        }),
      })
      window.__desktopUpdateInstalls = 0
      window.__publishDesktopUpdate = publish
    }, CURRENT_VERSION)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[data-sidebar-root]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the current version only when expanded and exposes the available Release beside Settings', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-update-available'))
    const settings = page.getByRole('button', { name: '设置', exact: true })
    await settings.waitFor({ timeout: 10_000 })
    const current = page.getByRole('status', { name: `当前版本 ${CURRENT_VERSION}` })
    await current.waitFor({ timeout: 10_000 })
    expect(await current.textContent()).toBe(`版本号 ${CURRENT_VERSION}`)
    const settingsBox = await settings.boundingBox()
    const currentBox = await current.boundingBox()
    if (settingsBox === null || currentBox === null) throw new Error('sidebar footer status has no layout box')
    expect(currentBox.x).toBeGreaterThanOrEqual(settingsBox.x + settingsBox.width)
    await compareOrRefreshGolden(
      CURRENT_EXPECTED,
      await captureStableAria(page, '[data-desktop-update-status="up-to-date"]', scaffold.workspaceCwd),
      MODE,
    )

    await page.getByRole('button', { name: '收起侧边栏', exact: true }).click()
    await page.locator('[data-sidebar-collapsed]').waitFor({ timeout: 10_000 })
    await expect.poll(
      () => page.locator('[data-desktop-update-status="up-to-date"]').count(),
      { timeout: 10_000 },
    ).toBe(0)
    await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
    await page.locator('[data-sidebar-collapsed]').waitFor({ state: 'detached', timeout: 10_000 })
    await current.waitFor({ timeout: 10_000 })

    await page.evaluate((version) => {
      window.__publishDesktopUpdate({ status: 'available', version })
    }, VERSION)
    const update = page.getByRole('button', { name: `发现新版本 ${VERSION}，下载更新` })
    await update.waitFor({ timeout: 10_000 })
    const updateBox = await update.boundingBox()
    if (settingsBox === null || updateBox === null) throw new Error('sidebar footer actions have no layout box')
    expect(updateBox.x).toBeGreaterThanOrEqual(settingsBox.x + settingsBox.width)

    const snapshot = await captureStableAria(page, '[data-desktop-update-status="available"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(AVAILABLE_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('projects download progress and forwards restart installation', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-update-install'))
    await page.getByRole('button', { name: `发现新版本 ${VERSION}，下载更新` }).click()
    const progress = page.getByRole('button', { name: `正在下载版本 ${VERSION}，已完成 37%` })
    await progress.waitFor({ timeout: 10_000 })
    expect(await progress.isDisabled()).toBe(true)

    await page.evaluate((version) => {
      window.__publishDesktopUpdate({ status: 'downloaded', version })
    }, VERSION)
    await page.getByRole('button', { name: `版本 ${VERSION} 已下载，重启并安装` }).click()
    await expect.poll(
      () => page.evaluate(() => window.__desktopUpdateInstalls),
      { timeout: 5_000 },
    ).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['available.expected.md', 'current.expected.md'])
  })
})

declare global {
  interface Window {
    __desktopUpdateInstalls: number
    __publishDesktopUpdate: (state:
      | { status: 'up-to-date'; version: string }
      | { status: 'available'; version: string }
      | { status: 'downloading'; version: string; percent: number }
      | { status: 'downloaded'; version: string },
    ) => void
  }
}
