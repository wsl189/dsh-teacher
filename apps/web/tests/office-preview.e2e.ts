/** Exercise the retained Office renderer through the official Files and Documents sidebar. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { realOfficeBytes } from './office-fixture.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

function previewBytes(extension: 'docx' | 'xlsx' | 'pptx'): Uint8Array {
  const bytes = realOfficeBytes(extension)
  if (extension !== 'xlsx') return bytes
  const parts = unzipSync(bytes)
  const columns = Array.from({ length: 9 }, (_, index) => String.fromCharCode(65 + index))
  const rows = Array.from({ length: 16 }, (_, index) => index + 1)
  parts['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(parts['xl/worksheets/sheet1.xml']!)
    .replace(/<cols>.*?<\/cols>/u, '<cols><col min="1" max="1" width="45" customWidth="1"/><col min="2" max="9" width="20" customWidth="1"/></cols>')
    .replace(/<sheetData>.*?<\/sheetData>/u, `<sheetData>${rows.map(row => `<row r="${row}">${columns.map(column => `<c r="${column}${row}" t="inlineStr"><is><t>${column} lesson ${row}</t></is></c>`).join('')}</row>`).join('')}</sheetData>`))
  parts['xl/worksheets/sheet2.xml'] = unzipSync(bytes)['xl/worksheets/sheet1.xml']!
  parts['xl/workbook.xml'] = strToU8(strFromU8(parts['xl/workbook.xml']!).replace('</sheets>', '<sheet name="Notes" sheetId="2" r:id="rId2"/></sheets>'))
  parts['xl/_rels/workbook.xml.rels'] = strToU8(strFromU8(parts['xl/_rels/workbook.xml.rels']!).replace('</Relationships>', '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'))
  parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']!).replace('</Types>', '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'))
  return zipSync(parts)
}

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
    const original = previewBytes(extension)
    const filePath = join(scaffold.workspaceCwd, 'workspace', filename)
    await writeFile(filePath, original)
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
    for (const size of [{ width: 1400, height: 1000 }, { width: 1000, height: 700 }]) {
      await page.setViewportSize(size)
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
          // Fit zoom antialiases text to gray; the lighter grid lines are excluded.
          let ink = 0
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i]! < 150 && pixels[i + 1]! < 150 && pixels[i + 2]! < 150 && pixels[i + 3]! > 200) ink++
          }
          return ink > 100
        })), { timeout: 20_000 }).toBe(true)
      } else {
        await preview.getByText('Office preview 中文文档', { exact: true }).waitFor({ timeout: 20_000 })
      }
      if (extension === 'docx') {
        await expect.poll(() => preview.locator('section.docx').evaluateAll(nodes => nodes.every((node) => {
          const viewport = node.closest('[class$="editorDocxViewport"]')!
          const page = node.getBoundingClientRect()
          const bounds = viewport.getBoundingClientRect()
          return page.left >= bounds.left && page.right <= bounds.right
        }))).toBe(true)
      } else if (extension === 'xlsx') {
        await expect.poll(async () => Number((await preview.getByRole('button', { name: /^\d+%$/u }).textContent())?.replace('%', ''))).toBeLessThan(100)
        const scale = Number((await preview.getByRole('button', { name: /^\d+%$/u }).textContent())!.replace('%', '')) / 100
        const canvas = preview.locator('canvas').last()
        const address = preview.locator('[data-u-comp="defined-name"] input')
        await expect.poll(() => canvas.evaluate(node => node.clientWidth - node.closest('[class$="editorUniverHost"]')!.clientWidth)).toBe(0)
        // The first row lies below the 20-unit column header; both outer columns must be clickable without scrolling.
        const position = { x: await canvas.evaluate(node => node.clientWidth - 35), y: 31 * scale }
        await canvas.click({ position })
        await expect.poll(() => address.inputValue()).toBe('I1')
        await canvas.click({ position: { x: 80 * scale, y: 31 * scale } })
        await expect.poll(() => address.inputValue()).toBe('A1')
      }
    }
    if (extension === 'docx') {
      const zoom = preview.getByRole('slider', { name: 'Zoom', exact: true })
      const viewport = preview.locator('[class$="editorDocxViewport"]')
      await zoom.focus()
      await zoom.press('End')
      await expect.poll(() => zoom.inputValue()).toBe('200')
      await viewport.evaluate((node) => { node.scrollLeft = 0 })
      await expect.poll(() => preview.locator('section.docx').evaluate(node =>
        node.getBoundingClientRect().left - node.closest('[class$="editorDocxViewport"]')!.getBoundingClientRect().left)).toBeGreaterThanOrEqual(0)
      await viewport.evaluate((node) => { node.scrollLeft = node.scrollWidth })
      await expect.poll(() => preview.locator('section.docx').evaluate(node =>
        node.getBoundingClientRect().right - node.closest('[class$="editorDocxViewport"]')!.getBoundingClientRect().right)).toBeLessThanOrEqual(0)
      await page.setViewportSize({ width: 1400, height: 700 })
      await expect.poll(() => zoom.inputValue()).toBe('200')
      await preview.getByRole('button', { name: 'Fit width', exact: true }).click()
      await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThan(100)
      await expect.poll(() => viewport.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
    } else if (extension === 'xlsx') {
      const zoom = preview.getByRole('button', { name: /^\d+%$/u })
      await zoom.click()
      await page.getByRole('menuitemradio', { name: '200%', exact: true }).click()
      await expect.poll(() => zoom.textContent()).toBe('200%')
      await preview.getByRole('tab', { name: 'Notes', exact: true }).click()
      await expect.poll(() => zoom.textContent()).toBe('100%')
      await preview.getByRole('tab', { name: 'Preview', exact: true }).click()
      await expect.poll(() => zoom.textContent()).toBe('200%')
      await page.setViewportSize({ width: 1400, height: 700 })
      await expect.poll(() => zoom.textContent()).toBe('200%')
      const canvas = preview.locator('canvas').last()
      await expect.poll(() => canvas.evaluate((node) => {
        const host = node.closest('[class$="editorUniverHost"]')!
        return Math.abs(node.getBoundingClientRect().left - host.getBoundingClientRect().left)
          + Math.abs(node.clientWidth - host.clientWidth)
      })).toBeLessThan(1)
      await canvas.click({ position: { x: 120, y: 60 } })
      const address = preview.locator('[data-u-comp="defined-name"] input')
      await expect.poll(() => address.inputValue()).toBe('A1')
      const bounds = (await canvas.boundingBox())!
      // Visible scroll thumbs must still reach both ends of an enlarged worksheet.
      const y = bounds.y + bounds.height - 6
      await page.mouse.move(bounds.x + 140, y)
      await page.mouse.down()
      await page.mouse.move(bounds.x + bounds.width - 30, y, { steps: 4 })
      await page.mouse.up()
      await canvas.click({ position: { x: 120, y: 60 } })
      await expect.poll(() => address.inputValue()).not.toBe('A1')
      await page.mouse.move(bounds.x + bounds.width - 100, y)
      await page.mouse.down()
      await page.mouse.move(bounds.x + 100, y, { steps: 4 })
      await page.mouse.up()
      await canvas.click({ position: { x: 120, y: 60 } })
      await expect.poll(() => address.inputValue()).toBe('A1')
      await preview.getByRole('button', { name: 'Fit width', exact: true }).click()
      await expect.poll(async () => Number((await zoom.textContent())?.replace('%', ''))).toBeLessThan(100)
    }
    expect(new Uint8Array(await readFile(filePath))).toEqual(original)
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser.close()
  }
})
