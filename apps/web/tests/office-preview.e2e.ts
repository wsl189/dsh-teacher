/** Exercise the retained Office renderer through the official Files and Documents sidebar. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { realOfficeBytes } from './office-fixture.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

it.each(['xlsx', 'docx', 'pptx'] as const)('renders %s across sidebar resizes and tab switches', async (extension) => {
  const scaffold = await launchWebScaffold({
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url)),
    compareReplaySession: false, paceMs: 1,
  })
  onTestFinished(async () => { await scaffold.close() })
  const browser = await chromium.launch()
  try {
    await mkdir(join(scaffold.workspaceCwd, 'workspace'), { recursive: true })
    const filename = `lesson.${extension}`
    await writeFile(join(scaffold.workspaceCwd, 'workspace', filename), realOfficeBytes(extension))
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const settled = scaffold.whenTurnSettled()
    await page.locator('[data-composer-input]').fill('Reply with the single word LIGHTHOUSE and stop.')
    await page.locator('[data-composer-input]').press('Enter')
    await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
    const sidebar = page.locator('[data-rightbar-col]')
    await page.locator('[data-sidebar-right-expand]').click()
    await sidebar.locator('[data-sidebar-right-guide-entry="files"]').click()
    await sidebar.locator('[data-files-state="tree"]').waitFor({ state: 'visible' })
    await sidebar.locator('[data-files-entry="file"]').getByRole('button', { name: filename, exact: true }).click()
    const preview = sidebar.locator(`[data-document-preview="office/${extension}"]`)
    const body = preview.locator('[data-textpreview-body]')
    await preview.waitFor({ state: 'visible' })
    for (const height of [1000, 700]) {
      await page.setViewportSize({ width: 1400, height })
      await sidebar.getByRole('tab', { name: 'Files Close', exact: true }).click()
      await sidebar.getByRole('tab', { name: `${filename} Close`, exact: true }).click()
      await expect.poll(() => body.evaluate((node) => {
        const viewer = node.querySelector('[data-slot="sidebar.right.tab.document"] > div')
        return viewer === null ? Infinity : Math.abs(viewer.getBoundingClientRect().height - node.clientHeight)
      }), { timeout: 20_000 }).toBeLessThan(1)
      if (extension === 'xlsx') {
        // The formula bar has its own canvas; only a large sheet canvas establishes that cells are visible.
        await expect.poll(() => preview.locator('canvas').evaluateAll(nodes => nodes.some((node) => {
          const canvas = node as HTMLCanvasElement
          if (canvas.clientHeight < 250 || canvas.clientWidth < 200) return false
          const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
          if (pixels === undefined) return false
          let ink = 0
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i]! < 100 && pixels[i + 1]! < 100 && pixels[i + 2]! < 100 && pixels[i + 3]! > 200) ink++
          }
          return ink > 100
        })), { timeout: 20_000 }).toBe(true)
      } else {
        await preview.getByText('Office preview 中文文档', { exact: true }).waitFor({ timeout: 20_000 })
      }
    }
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser.close()
  }
})
