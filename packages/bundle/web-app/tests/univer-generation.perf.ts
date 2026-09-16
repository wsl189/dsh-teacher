/** Measure built Univer workers with fixed content and independent Office export checks. */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

type UnitKind = 'doc' | 'sheet' | 'slide'

interface FileAddress {
  workspace: string
  file: string
}

interface WorktreeAddress extends FileAddress {
  worktreeId: string
}

interface UnitAddress extends WorktreeAddress {
  unitId: string
}

interface OperationResult<T> {
  ok: boolean
  result: T
}

interface WorktreeStatus {
  selectedWorktree?: { units: { unitId: string }[] }
}

// The repacked plugin has no declarations; this adapter covers only the measured public calls.
interface GatewayApi {
  ensureGateway(): Promise<{ ok: boolean; reason?: string }>
  newFile(request: FileAddress): Promise<unknown>
  worktree(request: FileAddress & { action: 'create' }): Promise<OperationResult<{ worktreeId: string }>>
  unit(request: WorktreeAddress & { action: 'create'; kind: UnitKind; name: string }): Promise<unknown>
  status(request: WorktreeAddress): Promise<OperationResult<WorktreeStatus>>
  executeUnitContent(request: UnitAddress & { code: string }): Promise<OperationResult<{ value: unknown }>>
  exportUnitContent(request: UnitAddress & { outputWorkspace: string; output: string }): Promise<unknown>
}

interface Fiber {
  dispose(): Promise<void>
}

interface CordisModule {
  Context: new () => {
    plugin(plugin: { name: string; apply(context: object): void }): Fiber & PromiseLike<Fiber>
  }
}

interface UniverModule {
  GatewayUniverService: new (context: object, config: unknown) => GatewayApi
  resolveConfig: (config: {
    gatewayPort: number
    telemetry: boolean
    tools: boolean
    skills: boolean
    resourceCacheRoot: string
  }) => unknown
}

interface ZipModule {
  unzipSync: (bytes: Uint8Array) => Record<string, Uint8Array>
  strFromU8: (bytes: Uint8Array) => string
}

const args = process.argv.slice(2)
assert.ok(args.every(arg => arg === '--disable-cache' || arg === '--fragmented'),
  'Usage: node univer-generation.perf.mjs [--disable-cache] [--fragmented]')
const cache = !args.includes('--disable-cache')
const fragmented = args.includes('--fragmented')
const samples = fragmented ? 1 : 3
const kinds: UnitKind[] = fragmented ? ['doc'] : ['doc', 'sheet', 'slide']
const paragraphs = Array.from({ length: 20 }, (_, index) =>
  `Section ${String(index + 1)}: This is fixed synthetic teaching material with explanations, examples, and review exercises.`)
const slideTitles = Array.from({ length: 3 }, (_, index) => `Page ${String(index + 1)}: Fixed synthetic presentation`)
const sheetValues = Array.from({ length: 200 }, (_, row) => Array.from({ length: 8 }, (_, column) => ({
  value: column === 7 ? row * 56 + 21 : row * 8 + column,
  formula: column === 7 ? `=SUM(A${String(row + 1)}:G${String(row + 1)})` : null,
})))

function documentWrite(start: number, end: number): string {
  return `
const first = doc.getParagraphs()[0];
if (!first) throw new Error('Initial paragraph missing');
for (let index = ${String(start)}; index < ${String(end)}; index += 1) {
  const text = 'Section ' + (index + 1) + ': This is fixed synthetic teaching material with explanations, examples, and review exercises.';
  if (index === 0) {
    if (!first.setText(text)) throw new Error('Paragraph update failed');
  } else {
    doc.appendParagraph(text);
  }
}
return true;
`
}

const sheetWrite = `
const sheet = workbook.getActiveSheet();
sheet.setRowCount(200);
const calculated = api.getFormula().onCalculationResultApplied();
sheet.getRange(0, 0, 200, 8).setValues(Array.from({ length: 200 }, (_, row) =>
  Array.from({ length: 8 }, (_, column) => column === 7
    ? { f: '=SUM(A' + (row + 1) + ':G' + (row + 1) + ')' }
    : { v: row * 8 + column, t: 2 })));
await calculated;
return true;
`
const slideWrite = `
const first = presentation.getSlides()[0];
if (!first) throw new Error('Initial slide missing');
for (let index = 0; index < 3; index += 1) {
  const page = index === 0 ? first : presentation.appendSlide({ name: 'Page ' + (index + 1) });
  const shape = page.insertShape({
    shapeType: api.Enum.ShapeTypeEnum.Rect,
    transform: { left: 60, top: 80, width: 840, height: 120 },
    name: 'Title ' + (index + 1),
  });
  if (!shape) throw new Error('Text shape missing');
  shape.setNoneFill().setStrokeLineType(api.Enum.ShapeLineTypeEnum.NoLine);
  shape.getText().setText('Page ' + (index + 1) + ': Fixed synthetic presentation').setFontSize(28).setColor('#111827');
}
return true;
`
const readCode: Record<UnitKind, string> = {
  doc: 'return doc.getParagraphs().map(paragraph => paragraph.getText());',
  sheet: `return workbook.getActiveSheet().getRange(0, 0, 200, 8).getCellDatas()
    .map(row => row.map(cell => ({ value: cell?.v, formula: cell?.f ?? null })));`,
  slide: 'return presentation.getSlides().map(page => page.getShapes().map(shape => shape.getText().getPlainText()));',
}
const expectedRead: Record<UnitKind, unknown> = {
  doc: paragraphs,
  sheet: sheetValues,
  slide: slideTitles.map(title => [title]),
}
const extension: Record<UnitKind, string> = { doc: 'docx', sheet: 'xlsx', slide: 'pptx' }

// Both tests/ and the compiled .dsh-build/ output resolve the installed Web bundle packages.
const require = createRequire(new URL('../package.json', import.meta.url))
const officeRequire = createRequire(new URL('../../../host/teacher-workbench/package.json', import.meta.url))
const workspace = await mkdtemp(join(await realpath(tmpdir()), 'dsh-office-generation-perf-'))
const envKeys = ['DSH_HOME', 'NODE_PATH', 'NODE_COMPILE_CACHE', 'NODE_DISABLE_COMPILE_CACHE', 'UNIVER_LICENSE'] as const
const savedEnv = envKeys.map(key => [key, process.env[key]] as const)
let fiber: Fiber | undefined

try {
  process.env.DSH_HOME = join(workspace, 'home')
  delete process.env.NODE_PATH
  delete process.env.NODE_COMPILE_CACHE
  delete process.env.UNIVER_LICENSE
  if (cache) delete process.env.NODE_DISABLE_COMPILE_CACHE
  else process.env.NODE_DISABLE_COMPILE_CACHE = '1'
  await mkdir(process.env.DSH_HOME)

  // Dynamic file URLs prevent tsconfig source aliases from replacing the shipped runtime.
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) as CordisModule
  const { GatewayUniverService, resolveConfig } = await import(pathToFileURL(require.resolve('dsh-univer-office')).href) as UniverModule
  const { unzipSync, strFromU8 } = await import(pathToFileURL(officeRequire.resolve('fflate')).href) as ZipModule
  const ctx = new Context()
  let service: GatewayApi | undefined
  const pending = ctx.plugin({
    name: 'univer-generation-performance',
    apply(context) {
      service = new GatewayUniverService(context, resolveConfig({
        gatewayPort: 32100,
        telemetry: false,
        tools: false,
        skills: false,
        resourceCacheRoot: join(workspace, 'resources'),
      }))
    },
  })
  fiber = pending
  await pending
  assert.ok(service, 'Univer service did not initialize')

  const setupStart = performance.now()
  const gateway = await service.ensureGateway()
  assert.equal(gateway.ok, true, gateway.reason)
  console.log(JSON.stringify({
    setupMs: performance.now() - setupStart,
    cache,
    fragmented,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  }))
  const records = []
  for (let sample = 0; sample < samples; sample += 1) {
    for (const kind of kinds) {
      const base = { workspace, file: join(workspace, `${kind}-${String(sample)}.univer`) }
      await service.newFile(base)
      const tree = await service.worktree({ ...base, action: 'create' })
      const worktree = { ...base, worktreeId: tree.result.worktreeId }
      await service.unit({ ...worktree, action: 'create', kind, name: 'Synthetic Office benchmark' })
      const status: OperationResult<WorktreeStatus> = await service.status(worktree)
      const units = status.result.selectedWorktree?.units
      assert.equal(units?.length, 1)
      const unit = units?.[0]
      assert.ok(unit, 'Created Unit missing from worktree status')
      const address = { ...worktree, unitId: unit.unitId }

      const start = performance.now()
      const writeCalls = kind === 'doc' && fragmented ? 20 : 1
      for (let index = 0; index < writeCalls; index += 1) {
        const code = kind === 'doc' ? documentWrite(index, fragmented ? index + 1 : 20)
          : kind === 'sheet' ? sheetWrite : slideWrite
        const written = await service.executeUnitContent({ ...address, code })
        assert.equal(written.result.value, true)
      }
      const writeMs = performance.now() - start
      const read = await service.executeUnitContent({ ...address, code: readCode[kind] })
      assert.deepEqual(read.result.value, expectedRead[kind])
      const readMs = performance.now() - start - writeMs
      const output = join(workspace, `${kind}-${String(sample)}.${extension[kind]}`)
      await service.exportUnitContent({ ...address, outputWorkspace: workspace, output })
      const exportMs = performance.now() - start - writeMs - readMs
      const bytes = await readFile(output)
      const parts = unzipSync(bytes)
      assert.ok(parts['[Content_Types].xml'])
      assert.ok(parts['_rels/.rels'])

      function xmlPart(name: string): string {
        const value = parts[name]
        assert.ok(value, `Office export is missing ${name}`)
        return strFromU8(value)
      }

      if (kind === 'doc') {
        const xml = xmlPart('word/document.xml')
        assert.deepEqual([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/gu)].map(match => match[1]), paragraphs)
      } else if (kind === 'sheet') {
        const xml = xmlPart('xl/worksheets/sheet1.xml')
        const cells = [...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)]
        assert.equal(cells.length, 1600)
        assert.deepEqual(cells.map(match => Number(/<v>([^<]*)<\/v>/u.exec(match[2]!)?.[1])),
          sheetValues.flat().map(cell => cell.value))
        assert.deepEqual(cells.filter(match => /\br="H\d+"/u.test(match[1]!))
          .map(match => /<f(?:\s[^>]*)?>([^<]*)<\/f>/u.exec(match[2]!)?.[1]),
        sheetValues.map((_, row) => `SUM(A${String(row + 1)}:G${String(row + 1)})`))
      } else {
        for (let index = 0; index < slideTitles.length; index += 1) {
          const xml = xmlPart(`ppt/slides/slide${String(index + 1)}.xml`)
          assert.ok(xml.includes(slideTitles[index]!))
        }
      }
      const record = { sample, kind, writeMs, readMs, exportMs, totalMs: performance.now() - start,
        contentOperations: writeCalls + 2, outputBytes: bytes.length }
      records.push(record)
      console.log(JSON.stringify(record))
    }
  }
  console.log(JSON.stringify({ records }))
} finally {
  try {
    await fiber?.dispose()
  } finally {
    for (const [key, value] of savedEnv) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
    await rm(workspace, { recursive: true, force: true, maxRetries: 3 })
  }
}
