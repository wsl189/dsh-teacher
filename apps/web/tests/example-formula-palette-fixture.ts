/** Real palette input, emphasis, saved native equations, and both collection export layouts. */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { expect } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { TeacherExampleDocumentRequest, TeacherExampleWordParagraph } from '@deepseek-ai/dsh-host-teacher-workbench'
import type { WebScaffold } from './scaffold.ts'

/**
 * Exercise every visible symbol using the shipped formula editor and native Word service.
 * @param page - page with the explanation Word editor open.
 * @param scaffold - disposable workbench and its file service.
 * @param request - collected explanation used by this test.
 * @param root - artifact directory for the complete downloaded and compiled symbol tables.
 * @returns per-symbol saved TeX for the owner-local regression snapshot.
 */
export async function auditExampleFormulaPalette(page: Page, scaffold: WebScaffold, request: TeacherExampleDocumentRequest, root: string) {
  const expanded = page.getByRole('dialog', { name: '解析 Word 预览大窗口', exact: true })
  const editor = expanded.getByLabel('编辑 Word 内容', { exact: true })
  const dialog = page.getByRole('dialog', { name: '公式编辑器', exact: true })
  const field = dialog.locator('math-field')
  const value = () => field.evaluate(element => (element as HTMLElement & { value: string }).value)
  const toggleBold = async () => {
    await field.locator('[part="menu-toggle"]').click()
    await page.getByRole('menuitem', { name: '字体样式', exact: true }).hover()
    const bold = page.getByRole('menuitemcheckbox', { name: '加粗', exact: true })
    await bold.hover()
    await bold.press('Enter')
    await bold.waitFor({ state: 'hidden', timeout: 10_000 })
  }
  await editor.locator('[data-equation]').last().dblclick()
  await page.evaluate(async () => { await document.fonts.load('20px "DSH Math Symbols"', '∁⫽⃥') })
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('DSH Math Symbols') && font.status === 'loaded'))).toBe(true)
  await page.evaluate(async () => { await document.fonts.load('20px "DSH Set Relations"', '⫋⫌') })
  await dialog.screenshot({ path: join(root, 'all-symbols-palette.png') })
  const labels = await dialog.getByRole('group').getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!))
  const results: {
    label: string
    regular: string
    bold: string
    wordFont?: string
    wordAlternateFont?: string
    wordNegation?: string
    previewFonts?: { font: string; weight: string; style: string }[]
    glyph?: { ascent: number; descent: number; width: number }
  }[] = []
  let activeLabel = ''
  const read = async () => {
    const result = await scaffold.ctx.teacherWorkbench.readExampleWordEditor(request)
    if (!result.ok) throw new Error(result.error.code)
    return result.value
  }
  const save = async () => {
    const input = await value()
    await writeFile(join(root, 'all-symbols-active.json'), JSON.stringify({ label: activeLabel, input }) + '\n')
    await dialog.getByRole('button', { name: '应用公式', exact: true }).click()
    expect(await dialog.getByRole('alert').isVisible(), input).toBe(false)
    await dialog.waitFor({ state: 'detached', timeout: 3000 })
    await expanded.getByRole('button', { name: '保存', exact: true }).click()
    await expanded.getByText('已保存', { exact: true }).waitFor()
    return (await read()).equations.at(-1)!.latex
  }
  await field.evaluate((element) => {
    (element as HTMLElement & { value: string }).value = String.raw`A\subseteq B\quad A\subsetneqq B\qquad B\supseteq A\quad B\supsetneqq A`
  })
  await field.locator('.ML__ams').filter({ hasText: '⫋' }).waitFor({ state: 'visible' })
  const inputFonts = await field.locator('.ML__ams').evaluateAll(elements => elements
    .filter(element => ['⫋', '⫌'].includes(element.textContent ?? ''))
    .map(element => getComputedStyle(element).fontFamily))
  expect(inputFonts).toHaveLength(2)
  expect(inputFonts.every(font => font.includes('DSH Set Relations'))).toBe(true)
  await field.screenshot({ path: join(root, 'latex-set-relations-input.png') })
  await save()
  const comparison = editor.locator('[data-equation]').last()
  const relations = await comparison.locator('.katex-html .mrel').allTextContents()
  expect(relations).toEqual(['⊆', '⫋', '⊇', '⫌'])
  const appliedFonts = await comparison.locator('.katex-html .amsrm').evaluateAll(elements => elements
    .map(element => getComputedStyle(element).fontFamily))
  expect(appliedFonts).toHaveLength(2)
  expect(appliedFonts.every(font => font.includes('DSH Set Relations'))).toBe(true)
  await comparison.screenshot({ path: join(root, 'latex-set-relations-applied.png') })
  await comparison.dblclick()
  await field.evaluate((element) => {
    (element as HTMLElement & { value: string }).value = String.raw`A\text{ ⫽⃥ }B\quad A\ ⫽⃥\ B\quad A\ \mathbf{⫽⃥}\ B\quad A\ \mathit{⫽⃥}\ B`
  })
  await save()
  const symbolFonts = () => comparison.locator('.katex-html span').evaluateAll(elements => elements
    .filter(element => element.childElementCount === 0 && element.textContent?.includes('⃥'))
    .map((element) => {
      const style = getComputedStyle(element)
      return { font: style.fontFamily, weight: style.fontWeight, style: style.fontStyle }
    }))
  const notParallelFonts = await symbolFonts()
  expect(notParallelFonts).toHaveLength(4)
  expect(notParallelFonts.every(symbol => symbol.font.includes('DSH Math Symbols'))).toBe(true)
  expect(notParallelFonts.map(symbol => symbol.weight)).toEqual(['400', '400', '700', '400'])
  await comparison.screenshot({ path: join(root, 'not-parallel-preview-modes.png') })
  await expanded.getByRole('button', { name: '关闭预览', exact: true }).click()
  await page.getByRole('button', { name: '放大解析 Word 预览', exact: true }).click()
  await comparison.waitFor({ state: 'visible' })
  expect(await symbolFonts()).toEqual(notParallelFonts)
  await comparison.dblclick()
  for (const [index, label] of labels.entries()) {
    activeLabel = label
    if (index > 0) await editor.locator('[data-equation]').last().dblclick()
    await field.press('ControlOrMeta+a')
    await field.pressSequentially(label === '补集' ? 'A' : 'x')
    await field.press('ControlOrMeta+a')
    const inheritedBold = await field.evaluate((element) => {
      const input = element as HTMLElement & { queryStyle(style: { fontSeries?: string; variantStyle?: string }): string }
      return input.queryStyle({ fontSeries: 'b' }) === 'all'
        || input.queryStyle({ variantStyle: 'bold' }) === 'all' || input.queryStyle({ variantStyle: 'bolditalic' }) === 'all'
    })
    if (inheritedBold) await toggleBold()
    await dialog.getByRole('button', { name: label, exact: true }).click()
    for (let count = 0; count < 8 && (await value()).includes('\\placeholder'); count++) {
      await field.pressSequentially(label === '补集' ? 'U' : '2')
      await field.press('Tab')
    }
    expect(await value(), label).not.toContain('\\placeholder')
    if (['补集', '真子集 ⫋', '不平行'].some(name => label.startsWith(name))) await field.screenshot({ path: join(root, `palette-${index}.png`) })
    const regular = await save()
    if (label === '补集') {
      const applied = editor.locator('[data-equation]').last()
      const typography = await applied.evaluate(root => [...root.querySelectorAll('.katex-html span')]
        .filter(node => node.childElementCount === 0 && ['∁', 'U', 'A'].includes(node.textContent ?? ''))
        .map(node => ({ text: node.textContent, font: getComputedStyle(node).fontFamily, style: getComputedStyle(node).fontStyle })))
      expect(typography.map(node => node.text)).toEqual(['∁', 'U', 'A'])
      expect(typography[0]!.font).toContain('DSH Math Symbols')
      expect(typography.map(node => node.style)).toEqual(['normal', 'italic', 'italic'])
      await applied.screenshot({ path: join(root, 'complement-applied.png') })
    }
    await editor.locator('[data-equation]').last().dblclick()
    await field.press('ControlOrMeta+a')
    await toggleBold()
    const boldInput = await value()
    const bold = await save()
    expect(bold, `${label}: ${boldInput}`).not.toBe(regular)
    const result: typeof results[number] = { label, regular, bold }
    if (label === '补集' || label.startsWith('不平行')) {
      result.glyph = await page.evaluate((text) => {
        const canvas = document.createElement('canvas').getContext('2d')!
        canvas.font = '1000px "DSH Math Symbols"'
        const metrics = canvas.measureText(text)
        return { ascent: Math.round(metrics.actualBoundingBoxAscent), descent: Math.round(metrics.actualBoundingBoxDescent),
          width: Math.round(metrics.width) }
      }, label === '补集' ? '∁' : '⫽⃥')
      expect(result.glyph.ascent).toBeLessThan(730)
      expect(result.glyph.ascent).toBeGreaterThan(650)
      expect(result.glyph.descent).toBeLessThan(80)
    }
    if (label === '真子集 ⫋' || label === '真包含 ⫌') {
      const glyph = label.endsWith('⫋') ? '⫋' : '⫌'
      result.glyph = await page.evaluate(async (text) => {
        await document.fonts.load('1000px "DSH Set Relations"', text)
        await document.fonts.load('1000px KaTeX_Main', '⊆')
        const canvas = document.createElement('canvas').getContext('2d')!
        canvas.font = '1000px "DSH Set Relations"'
        const metrics = canvas.measureText(text)
        return { ascent: Math.round(metrics.actualBoundingBoxAscent), descent: Math.round(metrics.actualBoundingBoxDescent),
          width: Math.round(metrics.width) }
      }, glyph)
      expect(regular).toContain(glyph === '⫋' ? '\\subsetneqq' : '\\supsetneqq')
      const reference = await page.evaluate(() => {
        const canvas = document.createElement('canvas').getContext('2d')!
        canvas.font = '1000px KaTeX_Main'
        const capital = canvas.measureText('B')
        return { width: canvas.measureText('⊆').width,
          center: (capital.actualBoundingBoxAscent - capital.actualBoundingBoxDescent) / 2 }
      })
      expect(Math.abs(result.glyph.width - reference.width)).toBeLessThan(2)
      expect(Math.abs((result.glyph.ascent - result.glyph.descent) / 2 - reference.center)).toBeLessThan(16)
      expect(result.glyph.ascent + result.glyph.descent).toBeGreaterThan(810)
      expect(result.glyph.ascent + result.glyph.descent).toBeLessThan(850)
    }
    if (label.startsWith('不平行')) {
      result.previewFonts = notParallelFonts
      const proportions = await page.evaluate(() => {
        const canvas = document.createElement('canvas').getContext('2d')!
        canvas.font = '1000px "DSH Math Symbols"'
        const mark = canvas.measureText('⃥')
        const lines = canvas.measureText('⫽')
        return { ratio: (mark.actualBoundingBoxAscent + mark.actualBoundingBoxDescent)
          / (lines.actualBoundingBoxAscent + lines.actualBoundingBoxDescent), advance: mark.width }
      })
      expect(proportions.ratio).toBeGreaterThan(0.5)
      expect(proportions.ratio).toBeLessThan(0.55)
      expect(proportions.advance).toBe(0)
    }
    results.push(result)
    await writeFile(join(root, 'all-symbols-progress.json'), JSON.stringify(results, null, 2) + '\n')
  }
  const model = await read()
  const textFormat = { font: 'Times New Roman', eastAsiaFont: '宋体', size: 12, bold: false, italic: false, underline: false }
  const paragraphs: TeacherExampleWordParagraph[] = results.map((row, index) => ({
    alignment: 'left', lineSpacing: 1.5, indent: 0, firstLine: 0, spaceBefore: 0, spaceAfter: 8, tabs: [],
    content: [
      { kind: 'text', text: `${index + 1}. ${row.label}   `, format: textFormat },
      { kind: 'equation', original: null, latex: row.regular, size: 12, bold: false },
      { kind: 'text', text: '    ', format: textFormat },
      { kind: 'equation', original: null, latex: row.bold, size: 12, bold: false },
      { kind: 'text', text: '    ', format: textFormat },
      { kind: 'equation', original: null, latex: `\\textcolor{blue}{${row.regular}}`, size: 16, bold: true },
    ],
  }))
  const saved = await scaffold.ctx.teacherWorkbench.saveExampleWordEditor({
    ...request, sourceId: model.sourceId, wordRevision: model.wordRevision, paragraphs,
  })
  if (!saved.ok) throw new Error(saved.error.code)
  for (const suffix of ['+1', '+2']) {
    const current = await read()
    const updated = await scaffold.ctx.teacherWorkbench.saveExampleWordEditor({
      ...request, sourceId: current.sourceId, wordRevision: current.wordRevision,
      paragraphs: current.paragraphs.map(row => ({ ...row,
        content: row.content.map(inline => inline.kind === 'equation' ? { ...inline, latex: inline.latex + suffix } : inline),
      })),
    })
    if (!updated.ok) throw new Error(updated.error.code)
    expect(updated.value.editor.equations).toHaveLength(labels.length * 3)
  }
  const download = await scaffold.ctx.teacherWorkbench.readExampleFile({ ...request, kind: 'word' })
  if (!download.ok) throw new Error(download.error.code)
  const bytes = Buffer.from(download.value.contentBase64, 'base64')
  expect(unzipSync(bytes)['word/fonts/dsh-complement.odttf']).toBeUndefined()
  expect(unzipSync(bytes)['word/fonts/dsh-teacher-math.odttf']).toBeUndefined()
  const complement = results.find(result => result.label === '补集')!
  complement.wordFont = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml')
    const math = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
    const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const run = [...document.getElementsByTagNameNS(math, 'r')].find(run => run.textContent === '∁')!
    return run.getElementsByTagNameNS(word, 'rFonts')[0]!.getAttributeNS(word, 'ascii')!
  }, strFromU8(unzipSync(bytes)['word/document.xml']!))
  expect(complement.wordFont).toBe('Segoe UI Symbol')
  complement.wordAlternateFont = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml')
    const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const font = [...document.getElementsByTagNameNS(word, 'font')].find(font => font.getAttributeNS(word, 'name') === 'Segoe UI Symbol')!
    return font.getElementsByTagNameNS(word, 'altName')[0]!.getAttributeNS(word, 'val')!
  }, strFromU8(unzipSync(bytes)['word/fontTable.xml']!))
  expect(complement.wordAlternateFont).toBe('Noto Sans Math')
  const notParallel = results.find(result => result.label.startsWith('不平行'))!
  notParallel.wordNegation = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml')
    const math = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
    const mark = [...document.getElementsByTagNameNS(math, 'phant')].find(mark => mark.textContent?.trim() === '\\')!
    for (const name of ['show', 'zeroWid', 'zeroAsc', 'zeroDesc']) {
      if (mark.getElementsByTagNameNS(math, name)[0]?.getAttributeNS(math, 'val') !== '1') throw new Error('Not-parallel negation must preserve the operator spacing')
    }
    return mark.textContent + mark.nextElementSibling!.textContent
  }, strFromU8(unzipSync(bytes)['word/document.xml']!))
  expect(notParallel.wordNegation).toBe(' \\∥')
  await writeFile(join(root, 'all-symbols-download.docx'), bytes)
  const native = async (content: Uint8Array) => page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml')
    const namespace = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
    for (const text of document.getElementsByTagNameNS(namespace, 't')) {
      if (text.childElementCount > 0) throw new Error('Native equation text contains a nested structure')
    }
    for (const element of document.getElementsByTagNameNS(namespace, '*')) {
      if (element.localName !== 't' && [...element.childNodes].some(node => node.nodeType === 3 && node.textContent?.trim())) {
        throw new Error('Native equation text must be inside a text run')
      }
    }
    for (const run of document.getElementsByTagNameNS(namespace, 'r')) {
      if (!/^[∁⊆⊇⫋⫌∥∦]$/u.test(run.textContent ?? '')) continue
      const fonts = run.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'rFonts')[0]!
      if (fonts.getAttribute('w:ascii') !== 'Segoe UI Symbol' || run.getElementsByTagNameNS(namespace, 'nor').length !== 1) {
        throw new Error('Word textbook symbols must select the Windows system font explicitly')
      }
    }
    return [...document.getElementsByTagNameNS(namespace, 'oMath')].map(equation => new XMLSerializer().serializeToString(equation))
  }, strFromU8(unzipSync(content)['word/document.xml']!))
  const expected = await native(bytes)
  expect(expected).toHaveLength(labels.length * 3)
  for (let index = 0; index < labels.length; index++) {
    const variants = expected.slice(index * 3, index * 3 + 3)
    const texts = await page.evaluate(xml => xml.map(value =>
      new DOMParser().parseFromString(value, 'application/xml').documentElement.textContent?.replace(/\s/gu, '')), variants)
    expect(texts[1], labels[index]).toBe(texts[0])
    expect(texts[2], labels[index]).toBe(texts[0])
    expect(variants[1], labels[index]).toContain('<w:b')
    expect(variants[2], labels[index]).toContain('0000FF')
    const functionName = /^\\(sin|cos|tan|log|lg|ln)\b/u.exec(results[index]!.regular)?.[1]
    if (functionName !== undefined || labels[index] === '求和') {
      const operatorBold = await page.evaluate(({ xml, name }) => {
        const document = new DOMParser().parseFromString(xml, 'application/xml')
        const nodes = document.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', name === undefined ? 'naryPr' : 'r')
        const operator = [...nodes].find(node => name === undefined || node.textContent === name)
        return operator?.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'b').length === 1
      }, { xml: variants[1]!, name: functionName })
      expect(operatorBold, labels[index]).toBe(true)
    }
  }
  for (const equation of expected) {
    expect(equation).not.toContain('undefined')
    expect(equation).toContain('+1+2')
  }
  for (const layout of ['paired', 'grouped'] as const) {
    const exported = await scaffold.ctx.teacherWorkbench.exportExamplesWord({ ids: [request.id], layout })
    if (!exported.ok) throw new Error(exported.error.code)
    const content = Buffer.from(exported.value.contentBase64, 'base64')
    await writeFile(join(root, `all-symbols-${layout}.docx`), content)
    expect(unzipSync(content)['word/fonts/dsh-complement.odttf']).toBeUndefined()
    expect((await native(content)).slice(-expected.length)).toEqual(expected)
  }
  await writeFile(join(root, 'all-symbols.json'), JSON.stringify(results, null, 2) + '\n')
  return results
}
