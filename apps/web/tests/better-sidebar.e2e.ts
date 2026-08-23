/** Built-in better-sidebar workbench through the shipped Web composition. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/fresh-round-trip/session.jsonl', import.meta.url))
const PDF_FIXTURE = fileURLToPath(new URL(
  '../../../examples/acp-agent/tests/snapshots/read-document/workspace/roster.pdf',
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
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
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

})
