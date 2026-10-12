/** Multiple solution originals, Word edits, and exports through the shipped Web composition. */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-host-teacher-workbench'
import type {} from '@deepseek-ai/dsh-ocr'
import type {} from '@deepseek-ai/dsh-settings'
import { ExampleCorrectionAdapter } from './example-correction-fixture.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh, ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/teacher-workbench/multiple-explanations.expected.md', import.meta.url))
const IMAGE = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))

describe('web e2e: multiple collected-question explanations', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let restoreModel: (() => void) | undefined

  async function openCollection(): Promise<void> {
    if (!await page.getByRole('button', { name: '典例收集', exact: true }).first().isVisible()) {
      await page.getByRole('button', { name: '打开工作台', exact: true }).click()
    }
    await page.getByRole('button', { name: '典例收集', exact: true }).first().click()
    await page.getByRole('heading', { name: '典例收集', exact: true }).waitFor()
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    const adapter = new ExampleCorrectionAdapter()
    restoreModel = scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['multiple-explanations-test'], adapter), 'Multiple solutions model fixture')
    await scaffold.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      ...scaffold.ctx.agentDefaultModel.currentSelection(), toolProvider: 'multiple-explanations-test', toolModel: 'proofreader',
    })
    vi.spyOn(scaffold.ctx.ocr, 'extractAbortable').mockImplementation(async (request, signal) => {
      signal?.throwIfAborted()
      const markdown = request.name === 'factor.png' ? '因式分解法：分解得到两个根。'
        : request.name === 'formula.png' ? '求根公式法：代入公式得到两个根。' : '题目原文：求一元二次方程的根。'
      return { ok: true, value: { markdown, name: request.name, mediaType: request.mediaType, provider: 'test', truncated: false } }
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'document-upload')
  }, 120_000)

  afterAll(async () => {
    try { await browser?.close() }
    finally {
      vi.restoreAllMocks()
      restoreModel?.()
      await scaffold?.close()
    }
  })

  it('switches, edits, reloads, exports, and deletes only the chosen solution', async () => {
    await openCollection()
    await page.getByRole('button', { name: '添加新题', exact: true }).first().click()
    await page.getByRole('tab', { name: '解析 1', exact: true }).waitFor()
    const surface = page.getByRole('region', { name: '工作台', exact: true })
    const original = surface.getByRole('region', { name: '题目原件', exact: true })
    const explanation = surface.getByRole('region', { name: '题目解析', exact: true })
    const word = surface.getByRole('region', { name: '解析 Word 预览', exact: true })
    await original.getByLabel('添加图片或 PDF', { exact: true }).setInputFiles({ name: 'question.png', mimeType: 'image/png', buffer: await readFile(IMAGE) })
    await surface.getByRole('region', { name: 'Word 预览', exact: true }).getByText('题目原文：求一元二次方程的根。', { exact: true }).waitFor()
    await explanation.getByLabel('添加解析图片或 PDF', { exact: true }).setInputFiles({ name: 'factor.png', mimeType: 'image/png', buffer: await readFile(IMAGE) })
    await word.getByText('因式分解法：分解得到两个根。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '添加新解析', exact: true }).click()
    const second = page.getByRole('tab', { name: '解析 2', exact: true })
    await expect.poll(() => second.getAttribute('aria-selected')).toBe('true')
    await explanation.getByLabel('添加解析图片或 PDF', { exact: true }).setInputFiles({ name: 'formula.png', mimeType: 'image/png', buffer: await readFile(IMAGE) })
    await word.getByText('求根公式法：代入公式得到两个根。', { exact: true }).waitFor()
    await word.getByRole('button', { name: '放大解析 Word 预览', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '解析 Word 预览大窗口', exact: true })
    await editor.getByRole('textbox', { name: '编辑 Word 内容', exact: true }).fill('求根公式法：人工补充说明。')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => editor.getByRole('button', { name: '保存', exact: true }).isEnabled()).toBe(false)
    await editor.getByRole('button', { name: '关闭预览', exact: true }).click()
    await editor.waitFor({ state: 'detached' })
    await word.getByText('求根公式法：人工补充说明。', { exact: true }).waitFor()
    await page.getByRole('tab', { name: '解析 1', exact: true }).click()
    await word.getByText('因式分解法：分解得到两个根。', { exact: true }).waitFor()
    const saved = await scaffold.ctx.teacherWorkbench.listExamples({})
    if (!saved.ok) throw new Error(saved.error.code)
    const question = saved.value.questions[0]!
    expect(question.documents.explanation.source?.name).toBe('factor.png')
    expect(question.explanations[0]!.document.source?.name).toBe('formula.png')
    for (const layout of ['paired', 'grouped'] as const) {
      const result = await scaffold.ctx.teacherWorkbench.exportExamplesWord({ ids: [question.id], layout })
      if (!result.ok) throw new Error(result.error.code)
      const xml = strFromU8(unzipSync(Buffer.from(result.value.contentBase64, 'base64'))['word/document.xml']!)
      expect(xml).toContain('因式分解法')
      expect(xml).toContain('人工补充说明')
    }
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openCollection()
    await page.getByRole('tab', { name: '解析 2', exact: true }).click()
    await word.getByText('求根公式法：人工补充说明。', { exact: true }).waitFor()
    const aria = (await captureStableAria(page, '[aria-label="工作台"] main', scaffold.workspaceCwd))
      .replaceAll(new URL(scaffold.authenticatedUrl).origin, '{{origin}}')
    await compareOrRefreshGolden(EXPECTED, aria, MODE)
    const screenshots = process.env.DSH_MULTIPLE_EXPLANATIONS_SCREENSHOT_DIR
    if (screenshots !== undefined) {
      await mkdir(screenshots, { recursive: true })
      await page.screenshot({ path: join(screenshots, 'light.png'), fullPage: true, animations: 'disabled' })
    }
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '深色', exact: true }).click()
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
    expect(await word.locator('[class*="wordPage"]').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)')
    if (screenshots !== undefined) await page.screenshot({ path: join(screenshots, 'dark.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '删除当前解析', exact: true }).click()
    const deletion = page.getByRole('dialog', { name: '删除当前解析', exact: true })
    await deletion.press('Escape')
    await deletion.waitFor({ state: 'detached' })
    expect(await second.count()).toBe(1)
    await page.getByRole('button', { name: '删除当前解析', exact: true }).click()
    await deletion.getByRole('button', { name: '删除', exact: true }).click()
    await deletion.waitFor({ state: 'detached' })
    await second.waitFor({ state: 'detached' })
    await word.getByText('因式分解法：分解得到两个根。', { exact: true }).waitFor()
    expect(await scaffold.ctx.teacherWorkbench.listExamples({})).toMatchObject({ ok: true, value: { questions: [{ explanations: [], documents: { question: { status: 'ready' }, explanation: { source: { name: 'factor.png' }, status: 'ready' } } }] } })
    expect(tripwire.pageErrors).toEqual([])
  })
})
