/** Real Windows-MCP composition with an inert external desktop and an optional user-mode switch. */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-permission-presets'
import * as WindowsMcp from '@deepseek-ai/dsh-windows-mcp'

/** Fixture plugin name. */
export const name = 'windows-mcp-permission-snapshot'
/** Services exercised through the shipped headless profile. */
export const inject = ['loader', 'tools', 'agents', 'permissionPresets']

/** External desktop fixture selected by the recorded scenario. */
export interface Config {
  /** Exercise regional capture and nested sampling instead of permission-only calls. */
  capabilities?: boolean
}

/**
 * Mount the production plugin against the inert MCP process.
 * @param ctx - profile context carrying the real permission and tool services.
 * @param config - inert external desktop selection.
 * @returns after MCP discovery and policy installation complete.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  if (process.env.DSH_WINDOWS_MCP_TEST_DOWNGRADE === '1') {
    let switched = false
    ctx.on('tools/result', (exec) => {
      if (!switched && exec.name === 'mcp__windows__Snapshot' && exec.agent !== undefined) {
        switched = true
        ctx.permissionPresets.set(exec.agent.session, 'workspace-write')
      }
    })
  }
  await ctx.plugin(WindowsMcp, {
    runtimeCommand: fileURLToPath(new URL(config.capabilities === true ? './capabilities-server.mjs' : './desktop-server.mjs', import.meta.url)),
    runtimeCwd: process.cwd(),
  })
}
