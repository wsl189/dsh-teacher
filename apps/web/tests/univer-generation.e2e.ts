/** Exercise Office authoring and native exports through the shipped chat tools. */

import { once } from 'node:events'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { request, type IncomingMessage } from 'node:http'
import { dirname, join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { LlmAdapter, ToolCallId, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
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

/** Image admission uses a declared test route; authoring and rendering use the real tools. */
class UniverVisionAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 128_000 }, inputModalities: ['text', 'image'] })
  }

  override async *stream(): AsyncIterable<StreamChunk> {
    throw new Error('Univer generation tests must not request model inference')
  }
}

describe('bundled Univer chat generation', () => {
  let scaffold: WebScaffold
  let workspace: string
  let handle: AgentHandle
  let callNumber = 0
  const finalFiles = ['user-original.txt']

  beforeAll(async () => {
    // Native dependencies must resolve from the shipped plugin, not a developer's NODE_PATH.
    vi.stubEnv('NODE_PATH', undefined)
    vi.stubEnv('UNIVER_LICENSE', undefined)
    vi.stubEnv('NODE_COMPILE_CACHE', undefined)
    vi.stubEnv('NODE_DISABLE_COMPILE_CACHE', undefined)
    scaffold = await launchWebScaffold()
    workspace = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspace)
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['univer-generation-fixture'], new UniverVisionAdapter()), 'Univer image admission fixture')
    handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('univer-generation'),
      meta: { cwd: workspace, agentPreset: 'standard' },
      agentOptions: { provider: 'univer-generation-fixture', model: 'vision' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    handle.agent.session.append('turn/start', { turn: 1 })
    await writeFile(join(workspace, 'user-original.txt'), 'keep user original')
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
    if (name === 'office_workspace') return JSON.parse(text) as Record<string, unknown>
    const output = JSON.parse(text) as OperationOutput
    expect(output.ok).toBe(true)
    return output.result
  }

  async function createUnit(kind: 'doc' | 'sheet' | 'slide', name: string = kind): Promise<UnitAddress> {
    const { directory } = await call('office_workspace', { action: 'create' })
    if (typeof directory !== 'string') throw new Error('Office workspace returned no directory')
    const file = join(directory, `${name}.univer`)
    await call('univer_new', { file })
    const created = await call('univer_worktree', { action: 'create', file, name: `Synthetic ${kind}` })
    const worktreeId = stringField(created, 'worktreeId')
    const unit = await call('univer_unit', { action: 'create', file, worktreeId, kind, name: `Synthetic ${kind}` })
    return { file, worktreeId, unitId: stringField(unit, 'unitId') }
  }

  async function executeFile(address: UnitAddress, code: string): Promise<Record<string, unknown>> {
    const codeFile = `${address.file}.js`
    await writeFile(codeFile, `${code.trim()}\n`)
    return call('univer_execute', { ...address, codeFile })
  }

  async function finish(address: UnitAddress, filename: string): Promise<void> {
    const source = join(dirname(address.file), filename)
    const before = await readFile(source)
    const result = await call('office_workspace', {
      action: 'finish', directory: dirname(address.file),
      files: [{ source, destination: filename }],
    })
    expect(result).toMatchObject({ cleaned: true, files: [join(workspace, filename)] })
    expect(await readFile(join(workspace, filename))).toEqual(before)
    await expect(stat(dirname(address.file))).rejects.toMatchObject({ code: 'ENOENT' })
    finalFiles.push(filename)
    expect((await readdir(workspace)).sort()).toEqual([...finalFiles].sort())
    expect(await readFile(join(workspace, 'user-original.txt'), 'utf8')).toBe('keep user original')
  }

  async function screenshot(address: UnitAddress, selection: Record<string, unknown>): Promise<void> {
    const output = join(dirname(address.file), 'screens')
    await call('univer_screenshot', { ...address, ...selection, output })
    const images = (await readdir(output)).filter(name => name.endsWith('.png'))
    expect(images.length).toBeGreaterThan(0)
    for (const name of images) {
      expect((await readFile(join(output, name))).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    }
  }

  it('closes only idle databases in the managed directory and keeps editing after reopening', async () => {
    const address = await createUnit('sheet', 'release-check')
    await call('univer_execute', { ...address, code: "workbook.getActiveSheet().getRange('A1').setValue('Retained after close'); return true;" })
    // The external plugin ships JavaScript; only the public calls used here are declared.
    const service = scaffold.ctx.get('univer') as unknown as {
      ensureGateway(): Promise<{ gateway: string }>
    }
    const { gateway } = await service.ensureGateway()
    for (const path of ['/', '/univer-viewer/', '/assets/viewer.js']) {
      expect((await fetch(`${gateway}${path}`)).status).toBe(404)
    }
    const release = (directory: string): Promise<Response> => fetch(`${gateway}/dsh/release-directory`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ directory }), signal: AbortSignal.timeout(10_000),
    })
    expect((await release('relative')).status).toBe(409)
    expect(await (await release(`${dirname(address.file)}-unrelated`)).json()).toEqual({ ok: true, released: 0 })
    const key = Buffer.from(address.file).toString('base64url')
    const socket = new WebSocket(`${gateway.replace('http:', 'ws:')}/uf/${key}/events`)
    try {
      await once(socket, 'open', { signal: AbortSignal.timeout(10_000) })
      const busy = await release(dirname(address.file))
      expect(busy.status).toBe(409)
      const failure = await busy.json() as { ok: boolean; error: { message: string } }
      expect(failure.ok).toBe(false)
      expect(failure.error.message).toContain('still in use')
    } finally {
      const closed = once(socket, 'close', { signal: AbortSignal.timeout(10_000) })
      socket.close()
      await closed
    }
    // The SDK waits for this body before validating it; no document mutation is requested.
    const upload = request(`${gateway}/uf/${key}/universer-api/snapshot/-/units/recover`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': 'office-cleanup-test', expect: '100-continue' },
    })
    const responded = new Promise<IncomingMessage>((resolve, reject) => {
      upload.once('response', resolve)
      upload.on('error', reject)
    })
    const uploadClosed = new Promise<void>((resolve) => { upload.once('close', resolve) })
    upload.setTimeout(30_000, () => upload.destroy(new Error('SDK fixture upload timed out')))
    const completed = responded.then(async (response) => {
      response.resume()
      await once(response, 'end', { signal: AbortSignal.timeout(10_000) })
      return response.statusCode
    })
    // Attach rejection handling before any assertion can trigger teardown.
    void completed.catch(() => undefined)
    try {
      const accepted = once(upload, 'continue', { signal: AbortSignal.timeout(10_000) })
      upload.flushHeaders()
      await accepted
      upload.write('{"unitIds":')
      expect((await release(dirname(address.file))).status).toBe(409)
      upload.end('[]}')
      expect(await completed).toBe(400)
    } finally {
      upload.destroy()
      await uploadClosed
      await completed.catch(() => undefined)
    }
    expect(await (await release(dirname(address.file))).json()).toEqual({ ok: true, released: 1 })
    expect(await (await release(dirname(address.file))).json()).toEqual({ ok: true, released: 0 })
    expect(await call('univer_execute', { ...address, code: "return workbook.getActiveSheet().getRange('A1').getValue();" }))
      .toMatchObject({ committed: false, value: 'Retained after close' })
    await call('univer_export', { ...address, output: join(dirname(address.file), 'release-check.xlsx') })
    await finish(address, 'release-check.xlsx')
  })

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

    await screenshot(address, { pages: [1] })

    await call('univer_export', { ...address, output: join(dirname(address.file), 'lesson.docx') })
    const document = xmlPart(await officeParts(join(dirname(address.file), 'lesson.docx')), 'word/document.xml')
    for (const text of PARAGRAPHS) expect(document).toContain(text)
    expect([...document.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/gu)].map(match => match[1]))
      .toEqual(PARAGRAPHS)

    const cache = join(scaffold.harnessHome, 'cache', 'dsh-univer-office', 'node')
    const entries = await readdir(cache, { recursive: true })
    const files = await Promise.all(entries.map(entry => stat(join(cache, entry))))
    expect(files.some(file => file.isFile() && file.size > 0)).toBe(true)
    await finish(address, 'lesson.docx')
  })

  it('exports chat-authored formulas as native Word math with Times New Roman letters and digits', async () => {
    const address = await createUnit('doc', 'native-word')
    const paragraphs = [
      'Native Word equations 2026 中文',
      String.raw`Quadratic equation \(x=\frac{-b+\sqrt{b^2-4ac}}{2a}\).`,
      String.raw`\[\int_0^1 x^2\,dx=\frac{1}{3}\]`,
      String.raw`Matrix \(A=\begin{pmatrix}1&2\\3&4\end{pmatrix}\).`,
      String.raw`Comparisons \(0<x<1,\quad a>b>0,\quad x_1+x_2=-\frac{B}{A},\quad \text{A\&B}\).`,
    ]
    await executeFile(address, `
const paragraphs = ${JSON.stringify(paragraphs)};
const first = doc.getParagraphs()[0];
if (!first || !first.setText(paragraphs[0])) throw new Error('Initial paragraph update failed');
for (const text of paragraphs.slice(1)) doc.appendParagraph(text);
return true;
    `)
    await call('univer_export', { ...address, output: join(dirname(address.file), 'native-word.docx') })
    const parts = await officeParts(join(dirname(address.file), 'native-word.docx'))
    const document = xmlPart(parts, 'word/document.xml')
    expect(document).toContain(paragraphs[0])
    expect(document).toContain('<m:f>')
    expect(document).toContain('<m:rad>')
    expect(document).toContain('<m:sSup>')
    expect(document).toContain('<m:nary>')
    expect(document).toContain('<m:m>')
    expect(document).toContain('<m:oMathPara>')
    expect(document.match(/<m:oMath(?:\s|>)/gu)).toHaveLength(4)
    expect(document).toContain('&lt;')
    expect(document).toContain('&gt;')
    expect(document).toContain('&amp;')
    expect(document).not.toMatch(/[‹›]/u)
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
    await finish(address, 'native-word.docx')
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

    await screenshot(address, { range: 'A1:H6' })

    await call('univer_export', { ...address, output: join(dirname(address.file), 'scores.xlsx') })
    const worksheet = xmlPart(await officeParts(join(dirname(address.file), 'scores.xlsx')), 'xl/worksheets/sheet1.xml')
    const cells = [...worksheet.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)]
    expect(cells).toHaveLength(160)
    expect(cells.map(match => Number(/<v>([^<]*)<\/v>/u.exec(match[2]!)?.[1]))).toEqual(ROWS.flat())
    expect(cells.filter(match => /\br="H\d+"/u.test(match[1]!)).map(match => /<f(?:\s[^>]*)?>([^<]*)<\/f>/u.exec(match[2]!)?.[1]))
      .toEqual(ROWS.map((_, index) => `SUM(A${String(index + 1)}:G${String(index + 1)})`))
    await finish(address, 'scores.xlsx')
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

    expect(await call('office_workspace', { action: 'pause', directory: dirname(address.file) })).toMatchObject({ paused: true })
    handle.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    handle.agent.session.append('turn/start', { turn: 2 })
    expect(await call('office_workspace', { action: 'resume', directory: dirname(address.file) })).toMatchObject({ paused: false })

    await call('univer_export', { ...address, output: join(dirname(address.file), 'lesson.pptx') })
    const parts = await officeParts(join(dirname(address.file), 'lesson.pptx'))
    expect(Object.keys(parts).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path))).toHaveLength(3)
    for (const [index, title] of SLIDE_TITLES.entries()) {
      const slide = xmlPart(parts, `ppt/slides/slide${String(index + 1)}.xml`)
      expect([...slide.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/gu)].map(match => match[1])).toEqual([title])
      expect(slide).toContain('<p:sp>')
    }
    await finish(address, 'lesson.pptx')
  })

  it('publishes a requested native Univer project and keeps it editable outside scratch', async () => {
    const address = await createUnit('doc', 'native-project')
    await finish(address, 'native-project.univer')
    const file = join(workspace, 'native-project.univer')
    expect(await call('univer_execute', {
      ...address, file,
      code: "doc.getParagraphs()[0].setText('Continue editing the requested native project.'); return true;",
    })).toMatchObject({ committed: true, value: true })
    expect(await call('univer_execute', {
      ...address, file, code: 'return doc.getParagraphs()[0].getText();',
    })).toMatchObject({ value: 'Continue editing the requested native project.' })
    expect((await readdir(workspace)).sort()).toEqual([...finalFiles].sort())
  })

  it('keeps real Office exports after presentation and turn cleanup when finish is omitted', async () => {
    const { directory } = await call('office_workspace', { action: 'create' })
    if (typeof directory !== 'string') throw new Error('Office workspace returned no directory')
    const exports = ['lesson.docx', 'scores.xlsx', 'lesson.pptx']
    const expected = await Promise.all(exports.map(name => readFile(join(workspace, name))))
    for (const [index, name] of exports.entries()) await writeFile(join(directory, `recovered-${name}`), expected[index]!)
    await writeFile(join(directory, 'author.js'), 'intermediate script')
    await writeFile(join(directory, 'draft.univer'), 'intermediate project')
    const files = [exports[0]!, exports[2]!].map(name => ({ path: join(directory, `recovered-${name}`) }))
    const result = await scaffold.ctx.tools.execute({
      name: 'present', arguments: { files }, callId: ToolCallId('temporary-office-delivery'),
      signal: new AbortController().signal, agent: handle.agent,
    })
    expect(result.isError).toBe(false)
    const delivered = [exports[0]!, exports[2]!].map(name => ({ path: join(workspace, `recovered-${name}`) }))
    expect(result.value).toMatchObject({ files: delivered })
    expect(handle.agent.session.snapshotEvents().filter(event => event.type === 'deliverables/presented').at(-1)?.data.files).toEqual(delivered)
    handle.agent.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    finalFiles.push(...exports.map(name => `recovered-${name}`))
    await vi.waitFor(async () => { expect((await readdir(workspace)).sort()).toEqual([...finalFiles].sort()) })
    for (const [index, name] of exports.entries()) {
      const file = join(workspace, `recovered-${name}`)
      expect(await readFile(file)).toEqual(expected[index])
      await officeParts(file)
    }
  })
})
