/** Check the installed Electron binary against the CLI's native profile resolver before packaging. */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cliRequire = createRequire(new URL('../../cli/package.json', import.meta.url))
const probe = `
  const { requireBuiltin } = require(process.argv[1]);
  const loader = requireBuiltin('internal/modules/esm/loader').getOrInitializeCascadedLoader();
  if (typeof loader.resolveSync !== 'function') throw new Error('ESM resolver unavailable');
  for (const id of ['internal/modules/cjs/loader', 'internal/modules/helpers', 'internal/modules/esm/utils', 'internal/modules/esm/resolve']) {
    if (!requireBuiltin(id)) throw new Error('Missing profile module: ' + id);
  }
  process.stdout.write('profile resolver available');
`
const result = spawnSync(require('electron'), ['-e', probe, cliRequire.resolve('node-addon-require-builtin')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true,
})

if (result.error) throw result.error
assert.equal(result.signal, null, `Electron probe terminated by ${result.signal}`)
assert.equal(result.status, 0, result.stderr)
assert.equal(result.stdout, 'profile resolver available')
console.log('verify-native-loader: Electron loads the CLI profile resolver internals.')
