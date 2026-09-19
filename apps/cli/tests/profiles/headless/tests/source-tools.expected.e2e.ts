/** Source-path resolution must preserve tool dispatch across Loader and tsx imports. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const srcBin = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const patch = fileURLToPath(new URL('./fixtures/headless-profile.patch.yml', import.meta.url))

describe('headless tool dispatch through the source and installed launchers', () => {
  it.each(['src', 'lib'] as const)('records a completed shell call through %s module resolution', async (mode) => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-source-tools-'))
    try {
      const launch = resolveExampleLaunch({
        srcBin,
        tsconfigPath,
        mode,
        sourceImport: 'tsx/esm',
        configArgs: ['headless', '--patch', patch, '--json', 'Run the tool round trip.'],
        env: {
          DSH_HOME: join(cwd, '.dsh'),
          DSH_AGENTS_HOME: join(cwd, '.agents'),
          DSH_PERMISSION_MODE: 'workspace-write',
          DSH_TELEMETRY_DISABLED: '1',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
        },
      })
      const result = await execa(launch.command, launch.args, {
        cwd,
        env: launch.env,
        input: '',
        timeout: 60_000,
        killSignal: 'SIGKILL',
        reject: false,
      })
      expect(result.timedOut, result.stderr).toBe(false)
      expect(result.signal, result.stderr).toBeUndefined()
      expect(result.exitCode, result.stdout + result.stderr).toBe(0)
      const events = result.stdout.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      const toolResult = events.find(event => event.type === 'tool_result')
      expect(JSON.stringify(toolResult)).toContain('CLI_TOOL_ROUND_TRIP')
      expect(events.at(-1)).toMatchObject({
        type: 'final', text: 'CLI tool round trip complete: CLI_TOOL_ROUND_TRIP',
      })
      expect(events.map(event => event.type)).not.toContain('error')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
