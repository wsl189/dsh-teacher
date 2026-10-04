/** Check the installed Electron binary against the CLI's native profile resolver before packaging. */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cliRequire = createRequire(new URL('../../cli/package.json', import.meta.url))
const subprocessRequire = createRequire(new URL('../../../packages/subprocess/subprocess-local/package.json', import.meta.url))
const probe = `
  const { requireBuiltin } = require(process.argv[1]);
  const loader = requireBuiltin('internal/modules/esm/loader').getOrInitializeCascadedLoader();
  if (typeof loader.resolveSync !== 'function') throw new Error('ESM resolver unavailable');
  for (const id of ['internal/modules/cjs/loader', 'internal/modules/helpers', 'internal/modules/esm/utils', 'internal/modules/esm/resolve']) {
    if (!requireBuiltin(id)) throw new Error('Missing profile module: ' + id);
  }
  const pty = require(process.argv[2]);
  const child = pty.spawn('powershell.exe', ['-NoProfile', '-Command', "Write-Output 'DSH_NATIVE_PTY_OK'"], {
    cols: 80, rows: 24, env: process.env,
  });
  let output = '';
  child.onData(data => { output += data; });
  child.onExit(({ exitCode }) => {
    if (exitCode !== 0 || !output.includes('DSH_NATIVE_PTY_OK')) {
      process.stderr.write('Native PTY failed: ' + output);
      process.exit(1);
    }
    process.stdout.write('profile resolver and native PTY available');
    process.exit(0);
  });
`
const result = spawnSync(require('electron'), ['-e', probe, cliRequire.resolve('node-addon-require-builtin'), subprocessRequire.resolve('node-pty')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true,
})

if (result.error) throw result.error
assert.equal(result.signal, null, `Electron probe terminated by ${result.signal}`)
assert.equal(result.status, 0, result.stderr)
assert.equal(result.stdout, 'profile resolver and native PTY available')
console.log('verify-native-loader: Electron loads the CLI profile resolver and runs the Node-API terminal prebuild.')
