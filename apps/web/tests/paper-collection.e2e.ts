import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, Packer, Paragraph } from 'docx'
import { PDFDocument } from 'pdf-lib'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type {} from '@deepseek-ai/dsh-host-teacher-workbench'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./snapshots/teacher-workbench/papers.expected.md', import.meta.url))
const SEARCH_EXPECTED = fileURLToPath(new URL('./snapshots/teacher-workbench/papers-search.expected.md', import.meta.url))

describe('web e2e: paper collection', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let pdf: Buffer
  let word: Buffer
  let fixtures: string

  async function openPapers(): Promise<void> {
    const entry = page.getByRole('button', { name: '论文收集', exact: true })
    if (!await entry.isVisible()) await page.getByRole('button', { name: '打开工作台', exact: true }).click()
    await entry.click()
    await page.locator('[data-paper-collection]').waitFor()
  }

  beforeAll(async () => {
    const document = await PDFDocument.create()
    document.addPage([595, 842]).drawText('Paper original preview')
    pdf = Buffer.from(await document.save())
    word = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('论文原文：数学课堂研究')] }] }))
    fixtures = await mkdtemp(join(tmpdir(), 'dsh-paper-browser-'))
    const output = join(fixtures, 'preview.pdf')
    const converter = join(fixtures, 'paper-converter.cjs')
    const overlay = join(fixtures, 'paper.overlay.yml')
    await writeFile(output, pdf)
    await writeFile(converter, 'require("node:fs").copyFileSync(process.argv[2], process.argv[3]);\n')
    await writeFile(overlay, '- id: xmanrui-dsh-im\n  disabled: true\n- id: teacher-workbench\n  config:\n    paperCajCommand: '
      + JSON.stringify([process.execPath, converter, output, '{output}']) + '\n')
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'paper-collection')
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (fixtures !== undefined) await rm(fixtures, { recursive: true, force: true })
  })

  it('collects originals, edits custom numbers and searchable notes, and previews PDF/image/DOCX', async () => {
    onTestFailed(() => saveFailureShot(page, 'paper-collection'))
    await openPapers()
    const root = page.locator('[data-paper-collection]')
    const screenshots = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
    await mkdir(screenshots, { recursive: true })
    const sidebar = page.locator('[data-sidebar-root]')
    const labels = await sidebar.getByRole('button').allTextContents()
    expect(labels.findIndex(text => text.includes('论文收集'))).toBe(labels.findIndex(text => text.includes('典例收集')) + 1)
    await root.getByRole('button', { name: '添加论文', exact: true }).first().click()
    const directory = root.getByRole('complementary', { name: '论文目录' })
    await directory.getByRole('button', { name: '1', exact: true }).dblclick()
    await directory.getByRole('textbox', { name: '修改论文序号' }).fill('P-01')
    await directory.getByRole('textbox', { name: '修改论文序号' }).press('Enter')
    await root.getByRole('textbox', { name: '论文描述', exact: true }).fill('课堂观察与几何教学的实证研究')
    await root.getByRole('textbox', { name: '论文描述', exact: true }).blur()
    await root.getByRole('button', { name: '添加标签', exact: true }).click()
    const tagDialog = page.getByRole('dialog')
    await tagDialog.getByRole('textbox').fill('数学教育')
    await tagDialog.getByRole('button', { name: '保存', exact: true }).click()
    await root.getByRole('button', { name: '选择预设标签', exact: true }).click()
    const preset = root.getByRole('button', { name: '数学教育', exact: true })
    await expect.poll(() => preset.evaluate((button) => {
      const rect = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
    await page.screenshot({ path: join(screenshots, 'paper-collection-tag-dropdown.png'), fullPage: false })
    await preset.click()
    await root.getByRole('button', { name: '选择预设标签', exact: true }).click()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    await root.locator('input[type="file"]').setInputFiles([
      { name: '研究论文.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: '论文图表.png', mimeType: 'image/png', buffer: png },
      { name: '课堂研究.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: word },
    ])
    await root.getByRole('img', { name: /研究论文.pdf.*1/ }).waitFor({ timeout: 30_000 })
    await root.getByRole('tab', { name: '论文图表.png' }).click()
    await root.getByRole('img', { name: '论文图表.png', exact: true }).waitFor()
    await root.getByRole('tab', { name: '课堂研究.docx' }).click()
    await root.getByLabel('论文 Word 文档内容').getByText('论文原文：数学课堂研究', { exact: true }).waitFor()
    await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, '[data-paper-collection]', scaffold.workspaceCwd, {
      replacements: [[scaffold.baseUrl, '{{webOrigin}}']],
    }), webSnapshotMode())
    await page.screenshot({ path: join(screenshots, 'paper-collection-preview.png'), fullPage: false })
    const download = page.waitForEvent('download')
    await root.getByRole('link', { name: '下载原件', exact: true }).click()
    const original = await download
    expect(original.suggestedFilename()).toBe('课堂研究.docx')
    expect(await readFile(await original.path())).toEqual(word)
    await root.getByRole('textbox', { name: '搜索论文', exact: true }).fill('数学教育 几何教学')
    await root.getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('dialog', { name: '论文搜索结果' }).waitFor()
    await compareOrRefreshGolden(SEARCH_EXPECTED, await captureStableAria(page, 'dialog', scaffold.workspaceCwd), webSnapshotMode())
    await page.getByRole('dialog').getByRole('button', { name: /P-01/ }).click()
    await page.reload({ waitUntil: 'load' })
    await openPapers()
    await directory.getByRole('button', { name: 'P-01', exact: true }).waitFor()
    expect(await root.getByRole('textbox', { name: '论文描述', exact: true }).inputValue()).toBe('课堂观察与几何教学的实证研究')
    await root.getByRole('img', { name: /研究论文.pdf.*1/ }).waitFor({ timeout: 30_000 })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)

  it('automatically generates a CAJ preview while retaining the original download', async () => {
    onTestFailed(() => saveFailureShot(page, 'paper-collection-caj'))
    const root = page.locator('[data-paper-collection]')
    await root.getByRole('button', { name: '添加论文', exact: true }).first().click()
    await expect.poll(() => root.getByRole('complementary', { name: '论文目录' })
      .getByRole('button', { name: '2', exact: true }).getAttribute('aria-current')).toBe('page')
    const original = Buffer.from('CAJ\0original research paper')
    await root.locator('input[type="file"]').setInputFiles({ name: '知网论文.caj', mimeType: '', buffer: original })
    await root.getByRole('img', { name: /知网论文.pdf.*1/ }).waitFor({ timeout: 30_000 })
    const download = page.waitForEvent('download')
    await root.getByRole('link', { name: '下载原件', exact: true }).click()
    const source = await download
    expect(source.suggestedFilename()).toBe('知网论文.caj')
    expect(await readFile(await source.path())).toEqual(original)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
