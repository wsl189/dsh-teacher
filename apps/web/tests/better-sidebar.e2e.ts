/** Built-in better-sidebar workbench through the shipped Web composition. */

import { readFile } from 'node:fs/promises'
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
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/better-sidebar', import.meta.url))
const FREE_WINDOW_MENU_EXPECTED = join(SNAPSHOT_DIR, 'free-window-menu.expected.md')
const SIDE_CHAT_TRANSCRIPT_EXPECTED = join(SNAPSHOT_DIR, 'side-chat-transcript.expected.md')
const TASKS_DISABLED_MENU_EXPECTED = join(SNAPSHOT_DIR, 'tasks-disabled-menu.expected.md')
const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.jsonl', import.meta.url))
const PDF_FIXTURE = fileURLToPath(new URL(
  '../../cli/tests/profiles/acp/tests/snapshots/read-document/workspace/roster.pdf',
  import.meta.url,
))
const SEED_ID = 'better-sidebar-web-e2e'

describe('web e2e: built-in better-sidebar workbench', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('mounts once, starts closed, and opens the Files workbench', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-better-sidebar'))
    const workbench = page.locator('[data-dsh-better-sidebar]')
    await workbench.waitFor({ state: 'attached', timeout: 30_000 })
    expect(await workbench.count()).toBe(1)
    expect(await page.locator('style[data-plugin="dsh-better-sidebar"]').count()).toBeGreaterThan(0)

    const toggle = page.getByRole('button', { name: 'Expand sidebar' })
    await toggle.waitFor({ timeout: 15_000 })
    const panel = page.locator('[data-dsh-panel="true"]:not([data-dsh-bottom-panel])')
    expect(await panel.isVisible()).toBe(false)

    await toggle.click()
    await page.getByPlaceholder('Search files by name').waitFor({ timeout: 15_000 })
    expect(await panel.isVisible()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('moves the Files tab into a free window and docks it back', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-better-sidebar-free-window'))
    const workbench = page.locator('[data-dsh-better-sidebar]')
    const filesTab = workbench.locator('[title="Files"][draggable="true"]').first()
    await filesTab.waitFor({ timeout: 15_000 })
    await filesTab.click({ button: 'right' })

    const menu = page.locator('[role="menu"]')
    await menu.getByRole('menuitem', { name: 'Move to Free Window' }).waitFor({ timeout: 15_000 })
    await compareOrRefreshGolden(
      FREE_WINDOW_MENU_EXPECTED,
      await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd),
      MODE,
    )
    await menu.getByRole('menuitem', { name: 'Move to Free Window' }).click()

    const freeWindow = page.locator('[data-dsh-float-window]')
    await freeWindow.waitFor({ timeout: 15_000 })
    const freeContent = freeWindow.locator('[class*="floatContent"]')
    expect((await freeContent.boundingBox())?.width).toBeGreaterThan(200)

    await freeWindow.locator('[class*="floatHeader"]').click({ button: 'right' })
    const dock = page.getByRole('menuitem', { name: 'Dock Back to Sidebar' })
    await dock.waitFor({ timeout: 15_000 })
    await dock.click()
    await freeWindow.waitFor({ state: 'detached', timeout: 15_000 })
    await workbench.locator('[title="Files"][draggable="true"]').first().waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('opens a browser-held composer upload in the right sidebar', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-better-sidebar-upload-preview'))
    const toggles = page.locator('[data-dsh-toggle-cluster]')
    const collapse = toggles.getByRole('button', { name: 'Collapse sidebar' })
    if (await collapse.count() > 0) await collapse.click()
    const panel = page.locator('[data-dsh-panel="true"]:not([data-dsh-bottom-panel])')
    await panel.waitFor({ state: 'hidden', timeout: 15_000 })

    const composer = page.locator('[data-composer-card]')
    await composer.locator('input[type="file"][accept*=".pdf"]').setInputFiles(PDF_FIXTURE)
    const preview = composer.getByRole('button', { name: 'Preview file roster.pdf in the right sidebar' })
    await preview.waitFor({ timeout: 15_000 })
    await preview.click()

    await panel.waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('[data-upload-document-preview="roster.pdf"]').waitFor({ timeout: 15_000 })
    await page.locator('iframe[title="roster.pdf preview"]').waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])

    await composer.getByRole('button', { name: 'Remove file roster.pdf' }).click()
    await page.locator('[data-upload-document-preview="roster.pdf"]').waitFor({ state: 'detached', timeout: 15_000 })
  })

  it('renders Side Chat user and assistant messages through its own event route', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-better-sidebar-side-chat'))
    const childId = 'session-side-chat-e2e'
    const prompt = 'Show this side-chat question.'
    const reply = 'This side-chat answer is visible.'
    let events: Array<Record<string, unknown>> = []

    await page.route('**/sidebar/api/**', async (route) => {
      const method = new URL(route.request().url()).pathname.split('/').at(-1)
      if (method?.startsWith('sidechat.') !== true) {
        await route.fallback()
        return
      }
      const payload = route.request().postDataJSON() as { afterSeq?: number }
      let value: unknown
      switch (method) {
        case 'sidechat.start':
          value = { childId }
          break
        case 'sidechat.prompt':
          events = [{
            type: 'user/message',
            seq: 1,
            time: 1,
            data: { content: [{ type: 'text', text: prompt }], source: { kind: 'user' } },
          }, {
            type: 'assistant/message',
            seq: 2,
            time: 2,
            data: {
              turn: 1,
              step: 1,
              message: { content: [{ type: 'text', text: reply }] },
            },
          }]
          value = { accepted: true }
          break
        case 'sidechat.events': {
          const { afterSeq } = payload
          value = {
            events: afterSeq === undefined
              ? events
              : events.filter(event => typeof event.seq === 'number' && event.seq > afterSeq),
          }
          break
        }
        case 'sidechat.info':
          value = { live: true, status: 'idle', preset: 'standard', model: 'mock' }
          break
        default:
          value = { accepted: true }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, value }),
      })
    })

    try {
      const workbench = page.locator('[data-dsh-better-sidebar]')
      const panel = page.locator('[data-dsh-panel="true"]:not([data-dsh-bottom-panel])')
      if (!await panel.isVisible()) await page.getByRole('button', { name: 'Expand sidebar' }).click()
      await workbench.getByRole('button', { name: 'New tab' }).first().click()
      await page.getByRole('menuitem', { name: 'Side Chat (beta)' }).click()

      const composer = page.getByPlaceholder('Ask the first question — context inherited…')
      await composer.waitFor({ timeout: 15_000 })
      await composer.fill(prompt)
      await composer.press('Enter')
      await page.getByText(prompt, { exact: true }).waitFor({ timeout: 15_000 })
      await page.getByText(reply, { exact: true }).waitFor({ timeout: 15_000 })
      await compareOrRefreshGolden(
        SIDE_CHAT_TRANSCRIPT_EXPECTED,
        await captureStableAria(page, '[data-dsh-better-sidebar]', scaffold.workspaceCwd),
        MODE,
      )
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      await page.unroute('**/sidebar/api/**')
    }
  })

  it('hides its top-right toggles while a shell overlay owns that corner', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-better-sidebar-shell-overlay'))
    const toggles = page.locator('[data-dsh-toggle-cluster]')
    const expandedSidebar = toggles.getByRole('button', { name: 'Collapse sidebar' })
    if (await expandedSidebar.count() > 0) await expandedSidebar.click()

    await toggles.waitFor({ timeout: 15_000 })
    expect(await toggles.isVisible()).toBe(true)

    await page.getByRole('button', { name: 'Open workbench', exact: true }).click()
    await page.getByRole('button', { name: 'Daily management', exact: true }).click()
    await page.getByRole('region', { name: 'Workbench', exact: true }).waitFor({ timeout: 15_000 })
    expect(await page.locator("[data-shell-overlay] [data-slot='shell.overlay'] > *").count()).toBeGreaterThan(0)
    expect(await toggles.isVisible()).toBe(false)

    await page.locator('[role="treeitem"]').nth(1).click()
    await page.getByRole('region', { name: 'Workbench', exact: true }).waitFor({ state: 'hidden', timeout: 15_000 })
    expect(await toggles.isVisible()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('defaults Tasks off and preserves a user opt-in across reloads', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-better-sidebar-tasks-default'))
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: /^(Expand|Collapse) sidebar$/ }).waitFor({ timeout: 15_000 })
    const workbench = page.locator('[data-dsh-better-sidebar]')
    const panel = page.locator('[data-dsh-panel="true"]:not([data-dsh-bottom-panel])')
    if (!await panel.isVisible()) await page.getByRole('button', { name: 'Expand sidebar' }).click()
    await workbench.getByRole('button', { name: 'New tab' }).first().click()
    const menu = page.getByRole('menu')
    await menu.getByRole('menuitem', { name: 'Side Chat (beta)' }).waitFor({ timeout: 15_000 })
    expect(await menu.getByRole('menuitem', { name: 'Tasks', exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(
      TASKS_DISABLED_MENU_EXPECTED,
      await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd),
      MODE,
    )
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Side card', exact: true }).click()
    const tasksSwitch = dialog.locator('button[title="subagent"][aria-pressed]')
    await expect.poll(() => tasksSwitch.getAttribute('aria-pressed')).toBe('false')
    const committed = page.waitForResponse(response => (
      response.url().endsWith('/sidebar/api/settings.update') && response.ok()
    ))
    await tasksSwitch.click()
    await committed
    await expect.poll(() => tasksSwitch.getAttribute('aria-pressed')).toBe('true')
    await page.keyboard.press('Escape')

    await workbench.getByRole('button', { name: 'New tab' }).first().click()
    await menu.getByRole('menuitem', { name: 'Tasks', exact: true }).waitFor({ timeout: 15_000 })
    await page.keyboard.press('Escape')

    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await dialog.getByRole('button', { name: 'Side card', exact: true }).click()
    await expect.poll(() => tasksSwitch.getAttribute('aria-pressed')).toBe('true')
    const disabled = page.waitForResponse(response => (
      response.url().endsWith('/sidebar/api/settings.update') && response.ok()
    ))
    await tasksSwitch.click()
    await disabled
    await expect.poll(() => tasksSwitch.getAttribute('aria-pressed')).toBe('false')
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'free-window-menu.expected.md',
      'side-chat-transcript.expected.md',
      'tasks-disabled-menu.expected.md',
    ])
  })
})
