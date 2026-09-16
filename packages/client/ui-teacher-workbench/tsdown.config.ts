import { clientBundle } from '../tsdown.client.ts'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-teacher-workbench', ['lib/types/index.js'])
const require = createRequire(import.meta.url)
const fontStyles = new Set(['mathlive/fonts.css', 'katex/dist/katex.min.css', './fonts/symbols.css'])

export default (options: Parameters<typeof bundle>[0]) => bundle(options).map(config => ({
  ...config,
  plugins: [{
    name: 'example-equation-fonts',
    resolveId: { order: 'pre' as const, handler(source: string) { return fontStyles.has(source) ? `\0example-equation-fonts:${source}.js` : null } },
    load(id: string) {
      if (!id.startsWith('\0example-equation-fonts:')) return null
      const source = id.slice('\0example-equation-fonts:'.length, -3)
      const file = require.resolve(source === './fonts/symbols.css' ? './src/client/fonts/symbols.css' : source)
      const css = readFileSync(file, 'utf8')
        .replaceAll(/,\s*url\([^)]*\.(?:woff|ttf)["']?\)\s*format\(["'](?:woff|truetype)["']\)/gu, '')
        .replaceAll(/url\(([^)]+)\)/gu, (_match: string, path: string) => `url(data:font/woff2;base64,${readFileSync(resolve(dirname(file), path.replaceAll(/["']/gu, ''))).toString('base64')})`)
      return `const style = document.createElement('style'); style.dataset.plugin = '@deepseek-ai/dsh-client-ui-teacher-workbench'; style.textContent = ${JSON.stringify(css)}; document.head.append(style);`
    },
  }, ...config.plugins ?? []],
}))
