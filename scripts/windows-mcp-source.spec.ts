/** Execute the cross-platform source-input checks used by the Windows runtime assembler. */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('validates the reviewed source, complete tool signatures, patches, and installation', () => {
  const output = execFileSync(process.platform === 'win32' ? 'python' : 'python3', [
    '-m', 'unittest', 'discover', '-s', 'third-party/windows-mcp/tests', '-p', 'test_source.py',
  ], {
    cwd: resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  expect(output).toBe('')
})
