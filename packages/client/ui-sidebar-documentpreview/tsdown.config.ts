import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Rolldown, type UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'
import { bundledPdfAssets } from '../pdf-assets.build.ts'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-sidebar-documentpreview', ['lib/types/index.js'], {
  clientBanner: fileName => fileName.endsWith('client.pdf.js') ? pdf.licenseBanner
    : fileName.endsWith('client.excel.js') ? excelLicenseBanner() : undefined,
})
const require = createRequire(import.meta.url)
const pdf = bundledPdfAssets(dirname(require.resolve('pdfjs-dist/package.json')))
const workerSpecifier = 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
const workerModule = '\0dsh-pdf-worker.mjs'

/** FortuneSheet omits its repository license from the npm payload. */
function excelLicenseBanner(): string {
  const fortune = readFileSync(join(import.meta.dirname, 'licenses/FortuneSheet.txt'), 'utf8')
  const excel = readFileSync(join(dirname(require.resolve('exceljs/package.json')), 'LICENSE'), 'utf8')
  const xml = readFileSync(join(dirname(dirname(require.resolve('fast-xml-parser'))), 'LICENSE'), 'utf8')
  const csv = readFileSync(join(dirname(require.resolve('papaparse/package.json')), 'LICENSE'), 'utf8')
  const zip = readFileSync(join(dirname(require.resolve('fflate/package.json')), 'LICENSE'), 'utf8')
  const xlsRoot = dirname(require.resolve('xlsx'))
  const xls = readdirSync(xlsRoot).filter(name => /^(LICENSE|NOTICE)(\.|$)/u.test(name)).sort()
    .map(name => readFileSync(join(xlsRoot, name), 'utf8')).join('\n')
  return ['//! Bundled spreadsheet license notices', ...`${fortune}\n${excel}\n${xml}\n${csv}\n${zip}\n${xls}`.trimEnd().split('\n').map(line => `// ${line}`)].join('\n')
}

/** The dynamic client factory has no module URL from which to resolve a Worker file. */
const pdfWorker: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-pdf-worker-source',
  resolveId(source) {
    return source === workerSpecifier ? workerModule : null
  },
  load(id) {
    if (id !== workerModule) return null
    const path = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    this.addWatchFile(path)
    return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`
  },
}]

/** Embed a self-contained browser parser without giving it a loader-module dependency. */
const excelWorker: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-excel-worker-source',
  resolveId(source) { return source === './worker.ts?raw' ? '\0dsh-excel-worker-source' : null },
  async load(id) {
    if (id !== '\0dsh-excel-worker-source') return null
    const parent = this
    const worker = await Rolldown.rolldown({
      input: join(import.meta.dirname, 'src/client/excel/worker.ts'), platform: 'browser',
      resolve: { mainFields: ['browser', 'module', 'main'], aliasFields: [['browser']] },
      transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
      plugins: [{
        name: 'dsh-excel-worker-dependencies',
        async resolveId(source, importer) {
          // The outer build's license analysis must also see imports embedded in Worker text.
          if (importer?.startsWith(join(import.meta.dirname, 'src')) && !source.startsWith('.')) await parent.resolve(source, importer)
          return null
        },
      }],
    })
    try {
      const result = await worker.generate({ format: 'iife', minify: true })
      const chunk = result.output[0]
      if (chunk?.type !== 'chunk') throw new Error('Excel parser did not emit a JavaScript chunk')
      for (const path of Object.keys(chunk.modules)) this.addWatchFile(path)
      return `export default ${JSON.stringify(chunk.code)};`
    } finally { await worker.close() }
  },
}]

export default (options: Parameters<typeof bundle>[0]): UserConfig[] => bundle(options).map(config =>
  config.name?.endsWith('/client') === true ? {
    ...config,
    inputOptions: {
      ...config.inputOptions,
      resolve: { ...config.inputOptions?.resolve, mainFields: ['browser', 'module', 'main'], aliasFields: [['browser']] },
    },
    plugins: [config.plugins, pdfWorker, excelWorker],
    define: { ...config.define, __DSH_PDFJS_ASSETS__: pdf.assets },
  } : config,
)
