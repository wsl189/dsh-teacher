/** Exercise the retained Office renderer through the official Files and Documents sidebar. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

it('renders a DOCX selected in the official sidebar without better-sidebar', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url)),
    compareReplaySession: false, paceMs: 1,
  })
  onTestFinished(async () => { await scaffold.close() })
  const browser = await chromium.launch()
  try {
    const document = zipSync(Object.fromEntries(Object.entries({
      '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Teacher Office preview</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>',
    }).map(([name, value]) => [name, strToU8(value)])))
    await mkdir(join(scaffold.workspaceCwd, 'workspace'), { recursive: true })
    await writeFile(join(scaffold.workspaceCwd, 'workspace', 'lesson.docx'), document)
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
    await sidebar.locator('[data-files-entry="file"]').getByRole('button', { name: 'lesson.docx', exact: true }).click()
    const preview = sidebar.locator('[data-document-preview]')
    await preview.getByText('Teacher Office preview', { exact: true }).waitFor({ timeout: 20_000 })
    expect(await preview.locator('.docx').count()).toBeGreaterThan(0)
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser.close()
  }
})
