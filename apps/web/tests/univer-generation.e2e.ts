/** Exercise Office authoring and native exports through the shipped chat tools. */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-tools'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const PARAGRAPHS = Array.from({ length: 20 }, (_, index) => `Section ${String(index + 1)}: Fixed synthetic document content.`)
const SLIDE_TITLES = Array.from({ length: 3 }, (_, index) => `Page ${String(index + 1)}: Fixed synthetic presentation`)
const ROWS = Array.from({ length: 20 }, (_, row) =>
  Array.from({ length: 8 }, (_, column) => column === 7 ? 56 * row + 21 : row * 8 + column))

interface UnitAddress {
  file: string
  worktreeId: string
  unitId: string
}

interface OperationOutput {
  ok: boolean
  result: Record<string, unknown>
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0) throw new Error(`Univer result is missing ${key}`)
  return field
}

async function officeParts(path: string): Promise<Record<string, Uint8Array>> {
  const parts = unzipSync(await readFile(path))
  expect(parts['[Content_Types].xml']).toBeDefined()
  expect(parts['_rels/.rels']).toBeDefined()
  return parts
}

function xmlPart(parts: Record<string, Uint8Array>, path: string): string {
  const bytes = parts[path]
  if (bytes === undefined) throw new Error(`Office export is missing ${path}`)
  return strFromU8(bytes)
}

describe('bundled Univer chat generation', () => {
  let scaffold: WebScaffold
  let handle: AgentHandle
  let callNumber = 0

  beforeAll(async () => {
    // Native dependencies must resolve from the shipped plugin, not a developer's NODE_PATH.
    vi.stubEnv('NODE_PATH', undefined)
    vi.stubEnv('UNIVER_LICENSE', undefined)
    vi.stubEnv('NODE_COMPILE_CACHE', undefined)
    vi.stubEnv('NODE_DISABLE_COMPILE_CACHE', undefined)
    scaffold = await launchWebScaffold()
    handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('univer-generation'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    vi.unstubAllEnvs()
    if (failures.length > 0) throw new AggregateError(failures, 'Univer generation teardown failed')
  })

  async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await scaffold.ctx.tools.execute({
      name,
      arguments: args,
      callId: ToolCallId(`univer-generation-${String(++callNumber)}`),
      signal: new AbortController().signal,
      agent: handle.agent,
    })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(result.isError, `${name}: ${text}`).toBe(false)
    const output = JSON.parse(text) as OperationOutput
    expect(output.ok).toBe(true)
    return output.result
  }

  async function createUnit(kind: 'doc' | 'sheet' | 'slide', name: string = kind): Promise<UnitAddress> {
    const file = `${name}.univer`
    await call('univer_new', { file })
    const created = await call('univer_worktree', { action: 'create', file, name: `Synthetic ${kind}` })
    const worktreeId = stringField(created, 'worktreeId')
    const unit = await call('univer_unit', { action: 'create', file, worktreeId, kind, name: `Synthetic ${kind}` })
    return { file, worktreeId, unitId: stringField(unit, 'unitId') }
  }

  async function executeFile(address: UnitAddress, code: string): Promise<Record<string, unknown>> {
    const codeFile = `${address.file}.js`
    await writeFile(join(scaffold.workspaceCwd, codeFile), `${code.trim()}\n`)
    return call('univer_execute', { ...address, codeFile })
  }

  it('writes twenty document paragraphs and exports their text to DOCX', async () => {
    const address = await createUnit('doc')
    const write = await executeFile(address, `
const paragraphs = ${JSON.stringify(PARAGRAPHS)};
const first = doc.getParagraphs()[0];
if (!first) throw new Error('Initial paragraph missing');
if (!first.setText(paragraphs[0])) throw new Error('Paragraph update failed');
for (const text of paragraphs.slice(1)) doc.appendParagraph(text);
return paragraphs.length;
    `)
    expect(write).toMatchObject({ committed: true, value: 20 })
    const read = await call('univer_execute', {
      ...address,
      code: 'return doc.getParagraphs().map(paragraph => paragraph.getText());',
    })
    expect(read).toMatchObject({ committed: false, value: PARAGRAPHS })

    await call('univer_export', { ...address, output: 'lesson.docx' })
    const document = xmlPart(await officeParts(join(scaffold.workspaceCwd, 'lesson.docx')), 'word/document.xml')
    for (const text of PARAGRAPHS) expect(document).toContain(text)
    expect([...document.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/gu)].map(match => match[1]))
      .toEqual(PARAGRAPHS)

    const cache = join(scaffold.harnessHome, 'cache', 'dsh-univer-office', 'node')
    const entries = await readdir(cache, { recursive: true })
    const files = await Promise.all(entries.map(entry => stat(join(cache, entry))))
    expect(files.some(file => file.isFile() && file.size > 0)).toBe(true)
  })

  it('exports chat-authored formulas as native Word math with Times New Roman letters and digits', async () => {
    const address = await createUnit('doc', 'native-word')
    const paragraphs = [
      'Native Word equations 2026 中文',
      String.raw`Quadratic equation \(x=\frac{-b+\sqrt{b^2-4ac}}{2a}\).`,
      String.raw`\[\int_0^1 x^2\,dx=\frac{1}{3}\]`,
      String.raw`Matrix \(A=\begin{pmatrix}1&2\\3&4\end{pmatrix}\).`,
    ]
    await executeFile(address, `
const paragraphs = ${JSON.stringify(paragraphs)};
const first = doc.getParagraphs()[0];
if (!first || !first.setText(paragraphs[0])) throw new Error('Initial paragraph update failed');
for (const text of paragraphs.slice(1)) doc.appendParagraph(text);
return true;
    `)
    await call('univer_export', { ...address, output: 'native-word.docx' })
    const parts = await officeParts(join(scaffold.workspaceCwd, 'native-word.docx'))
    const document = xmlPart(parts, 'word/document.xml')
    expect(document).toContain(paragraphs[0])
    expect(document).toContain('<m:f>')
    expect(document).toContain('<m:rad>')
    expect(document).toContain('<m:sSup>')
    expect(document).toContain('<m:nary>')
    expect(document).toContain('<m:m>')
    expect(document).toContain('<m:oMathPara>')
    expect(document.match(/<m:oMath(?:\s|>)/gu)).toHaveLength(3)
    expect(document).not.toContain('\\frac')
    expect(document).not.toContain('<w:drawing')
    expect(xmlPart(parts, 'word/styles.xml')).toContain('w:ascii="Times New Roman"')
    expect(document).not.toContain('w:ascii="Arial"')
    const mathRuns = [...document.matchAll(/<m:r>([\s\S]*?)<\/m:r>/gu)].map(match => match[1]!)
    for (const run of mathRuns.filter(run => /<m:t[^>]*>[A-Za-z0-9]+<\/m:t>/u.test(run))) {
      expect(run).toContain('w:ascii="Times New Roman"')
    }
    const source = await call('univer_execute', {
      ...address, code: 'return doc.getParagraphs().map(paragraph => paragraph.getText());',
    })
    expect(source).toMatchObject({ committed: false, value: paragraphs })
  })

  it('writes a twenty by eight spreadsheet and exports calculated formulas to XLSX', async () => {
    const address = await createUnit('sheet')
    const write = await executeFile(address, `
const sheet = workbook.getActiveSheet();
sheet.setRowCount(20);
const rows = Array.from({ length: 20 }, (_, row) => Array.from({ length: 8 }, (_, column) => column === 7
  ? { f: '=SUM(A' + (row + 1) + ':G' + (row + 1) + ')' }
  : { v: row * 8 + column, t: 2 }));
const calculated = api.getFormula().onCalculationResultApplied();
sheet.getRange(0, 0, 20, 8).setValues(rows);
await calculated;
return rows.length;
    `)
    expect(write).toMatchObject({ committed: true, value: 20 })
    const read = await call('univer_execute', {
      ...address,
      code: 'return workbook.getActiveSheet().getRange(0, 0, 20, 8).getCellDatas().map(row => row.map(cell => ({ value: cell?.v, formula: cell?.f ?? null })));',
    })
    expect(read).toMatchObject({
      committed: false,
      value: ROWS.map((row, rowIndex) => row.map((value, column) => ({
        value,
        formula: column === 7 ? `=SUM(A${String(rowIndex + 1)}:G${String(rowIndex + 1)})` : null,
      }))),
    })

    await call('univer_export', { ...address, output: 'scores.xlsx' })
    const worksheet = xmlPart(await officeParts(join(scaffold.workspaceCwd, 'scores.xlsx')), 'xl/worksheets/sheet1.xml')
    const cells = [...worksheet.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)]
    expect(cells).toHaveLength(160)
    expect(cells.map(match => Number(/<v>([^<]*)<\/v>/u.exec(match[2]!)?.[1]))).toEqual(ROWS.flat())
    expect(cells.filter(match => /\br="H\d+"/u.test(match[1]!)).map(match => /<f(?:\s[^>]*)?>([^<]*)<\/f>/u.exec(match[2]!)?.[1]))
      .toEqual(ROWS.map((_, index) => `SUM(A${String(index + 1)}:G${String(index + 1)})`))
  })

  it('writes three editable slide titles and exports their text to PPTX', async () => {
    const address = await createUnit('slide')
    const write = await executeFile(address, `
const titles = ${JSON.stringify(SLIDE_TITLES)};
const first = presentation.getSlides()[0];
if (!first) throw new Error('Initial slide missing');
for (let index = 0; index < titles.length; index += 1) {
  const slide = index === 0 ? first : presentation.appendSlide({ name: 'Page ' + (index + 1) });
  const shape = slide.insertShape({
    shapeType: api.Enum.ShapeTypeEnum.Rect,
    transform: { left: 60, top: 80, width: 840, height: 120 },
    name: 'Title ' + (index + 1),
  });
  if (!shape) throw new Error('Shape insertion failed');
  shape.setNoneFill().setStrokeLineType(api.Enum.ShapeLineTypeEnum.NoLine);
  shape.getText().setText(titles[index]).setFontSize(28).setColor('#111827').setTextBoxOptions({
    textWrap: api.Enum.ShapeTextWrapType.None,
    autoFitType: api.Enum.ShapeTextAutoFitType.NoAutoFit,
    padding: { left: 0, top: 0, right: 0, bottom: 0 },
  });
}
return titles.length;
    `)
    expect(write).toMatchObject({ committed: true, value: 3 })
    const read = await call('univer_execute', {
      ...address,
      code: 'return presentation.getSlides().map(slide => slide.getShapes().map(shape => shape.getText().getPlainText()));',
    })
    expect(read).toMatchObject({ committed: false, value: SLIDE_TITLES.map(text => [text]) })

    await call('univer_export', { ...address, output: 'lesson.pptx' })
    const parts = await officeParts(join(scaffold.workspaceCwd, 'lesson.pptx'))
    expect(Object.keys(parts).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path))).toHaveLength(3)
    for (const [index, title] of SLIDE_TITLES.entries()) {
      const slide = xmlPart(parts, `ppt/slides/slide${String(index + 1)}.xml`)
      expect([...slide.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/gu)].map(match => match[1])).toEqual([title])
      expect(slide).toContain('<p:sp>')
    }
  })
})
