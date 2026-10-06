import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, Packer, Paragraph } from 'docx'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
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

/** A non-embedded GB1 font needs the packaged CMaps before its Chinese glyphs can be drawn. */
async function chinesePdf(): Promise<Buffer> {
  const document = await PDFDocument.create()
  const context = document.context
  const descendant = context.register(context.obj({
    Type: 'Font', Subtype: 'CIDFontType0', BaseFont: 'STSong-Light', DW: 1000,
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('GB1'), Supplement: 4 },
    FontDescriptor: {
      Type: 'FontDescriptor', FontName: 'STSong-Light', Flags: 6, FontBBox: [0, -200, 1000, 900],
      ItalicAngle: 0, Ascent: 880, Descent: -120, CapHeight: 700, StemV: 80,
    },
  }))
  const font = context.register(context.obj({
    Type: 'Font', Subtype: 'Type0', BaseFont: 'STSong-Light', Encoding: 'UniGB-UCS2-H', DescendantFonts: [descendant],
  }))
  const page = document.addPage([400, 260])
  page.node.set(PDFName.of('Resources'), context.obj({ Font: { CJK: font } }))
  page.node.set(PDFName.of('Contents'), context.register(context.stream('BT /CJK 36 Tf 36 150 Td <4e2d65878bba658778147a76> Tj ET')))
  return Buffer.from(await document.save())
}

/** Two opposite black squares encoded as a 32 × 32 CCITT Group 4 scan. */
async function scannedPdf(): Promise<Buffer> {
  const document = await PDFDocument.create()
  const context = document.context
  const image = context.register(context.stream(Buffer.from('NQL/////k1Bf///////wAQAQ', 'base64'), {
    Type: 'XObject', Subtype: 'Image', Width: 32, Height: 32, BitsPerComponent: 1,
    ColorSpace: 'DeviceGray', Filter: 'CCITTFaxDecode',
    DecodeParms: { K: -1, Columns: 32, Rows: 32, BlackIs1: false },
  }))
  const page = document.addPage([320, 320])
  page.node.set(PDFName.of('Resources'), context.obj({ XObject: { Scan: image } }))
  page.node.set(PDFName.of('Contents'), context.register(context.stream('q 320 0 0 320 0 0 cm /Scan Do Q')))
  return Buffer.from(await document.save())
}

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

  it('renders Chinese PDF glyphs without missing CMaps or external font requests', async () => {
    onTestFailed(() => saveFailureShot(page, 'paper-cjk'))
    const messages: string[] = []
    const resources: string[] = []
    const consoleMessage = (message: { text(): string }): void => { messages.push(message.text()) }
    const resourceRequest = (request: { url(): string }): void => {
      if (/cmaps\/|standard_fonts\/|\.bcmap(?:$|\?)|\.pfb(?:$|\?)/u.test(request.url())) resources.push(request.url())
    }
    page.on('console', consoleMessage)
    page.on('request', resourceRequest)
    try {
      await openPapers()
      const root = page.locator('[data-paper-collection]')
      await root.getByRole('button', { name: '添加论文', exact: true }).first().click()
      const originalPath = process.env.DSH_PAPER_CJK_FILE
      const original = originalPath === undefined ? await chinesePdf() : await readFile(originalPath)
      await root.locator('input[type="file"]').setInputFiles({ name: '中文字体论文.pdf', mimeType: 'application/pdf', buffer: original })
      const first = root.getByRole('img', { name: /中文字体论文.pdf.*1/ })
      await first.waitFor({ timeout: 30_000 })
      const density = await first.evaluate(async (element) => {
        if (!(element instanceof HTMLImageElement)) throw new Error('Expected a PDF page image')
        await element.decode()
        const canvas = document.createElement('canvas')
        canvas.width = element.naturalWidth
        canvas.height = element.naturalHeight
        const context = canvas.getContext('2d')!
        context.drawImage(element, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        let ink = 0
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index]! < 160 && pixels[index + 1]! < 160 && pixels[index + 2]! < 160) ink++
        }
        return ink / (canvas.width * canvas.height)
      })
      const screenshots = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
      await mkdir(screenshots, { recursive: true })
      const png = (await first.getAttribute('src'))!.split(',')[1]!
      await writeFile(join(screenshots, `paper-cjk-${process.env.DSH_PAPER_CJK_RESULT ?? 'regression'}.png`), Buffer.from(png, 'base64'))
      expect(density).toBeGreaterThan(0.005)
      const sourceDocument = await PDFDocument.load(original)
      await expect.poll(() => root.getByRole('img', { name: /中文字体论文.pdf/ }).count()).toBe(sourceDocument.getPageCount())
      const download = page.waitForEvent('download')
      await root.getByRole('link', { name: '下载原件', exact: true }).click()
      expect(await readFile(await (await download).path())).toEqual(original)
      expect(messages.filter(message => /CMap|standardFontDataUrl|font.*(?:failed|not found)|Unable to load/iu.test(message))).toEqual([])
      expect(resources).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      page.off('console', consoleMessage)
      page.off('request', resourceRequest)
    }
  }, 60_000)

  it('renders compressed scans without dropping images in the browser client bundle', async () => {
    onTestFailed(() => saveFailureShot(page, 'paper-scanned-image'))
    const messages: string[] = []
    const consoleMessage = (message: { text(): string }): void => { messages.push(message.text()) }
    page.on('console', consoleMessage)
    try {
      await openPapers()
      const root = page.locator('[data-paper-collection]')
      await root.getByRole('button', { name: '添加论文', exact: true }).first().click()
      await root.locator('input[type="file"]').setInputFiles({ name: '扫描论文.pdf', mimeType: 'application/pdf', buffer: await scannedPdf() })
      const preview = root.getByRole('img', { name: /扫描论文.pdf.*1/ })
      await preview.waitFor({ timeout: 30_000 })
      const pixels = await preview.evaluate(async (element: HTMLImageElement) => {
        await element.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 32
        const context = canvas.getContext('2d')!
        context.drawImage(element, 0, 0, 32, 32)
        const data = context.getImageData(0, 0, 32, 32).data
        let ink = 0
        for (let index = 0; index < data.length; index += 4) if (data[index]! < 128) ink++
        return { ink, quadrants: [[8, 8], [24, 8], [8, 24], [24, 24]].map(([x, y]) => data[(y! * 32 + x!) * 4]!) }
      })
      expect(pixels.ink).toBeGreaterThan(450)
      expect(pixels.ink).toBeLessThan(570)
      expect(pixels.quadrants[0]).toBe(pixels.quadrants[3])
      expect(pixels.quadrants[1]).toBe(pixels.quadrants[2])
      expect(Math.abs(pixels.quadrants[0]! - pixels.quadrants[1]!)).toBeGreaterThan(200)
      const decoderWarnings = messages.filter(message =>
        /ignoring XObject|Unable to decode image|instantiateWasm|missed the module table/iu.test(message))
      expect(decoderWarnings).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      page.off('console', consoleMessage)
    }
  }, 60_000)
})
