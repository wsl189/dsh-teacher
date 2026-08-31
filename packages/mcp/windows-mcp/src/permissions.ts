/** Session-scoped discovery and execution policy for bundled Windows-MCP tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { effectiveSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

/** Stable MCP namespace used in every model-facing tool name. */
export const WINDOWS_MCP_SERVER_NAME = 'windows'

/** Desktop tools available with per-call approval outside Full access. */
export const WINDOWS_MCP_DESKTOP_TOOLS = Object.freeze([
  'App', 'Click', 'DisplayInventory', 'Move', 'MultiEdit', 'MultiSelect',
  'Screenshot', 'Scroll', 'Shortcut', 'Snapshot', 'Type', 'Wait', 'WaitFor',
] as const)

/** System tools available only to sessions that explicitly select Full access. */
export const WINDOWS_MCP_SYSTEM_TOOLS = Object.freeze([
  'Clipboard', 'FileSystem', 'Notification', 'PowerShell', 'Process', 'Registry', 'Scrape',
] as const)

/** Complete tool catalog of the pinned Windows-MCP release. */
export const WINDOWS_MCP_ALLOWED_TOOLS = Object.freeze([
  ...WINDOWS_MCP_DESKTOP_TOOLS, ...WINDOWS_MCP_SYSTEM_TOOLS,
])

const PUBLIC_PREFIX = `mcp__${WINDOWS_MCP_SERVER_NAME}__`

/** Public names admitted by the pinned built-in catalog. */
export const WINDOWS_MCP_PUBLIC_TOOLS: ReadonlySet<string> = new Set(
  WINDOWS_MCP_ALLOWED_TOOLS.map(rawName => `${PUBLIC_PREFIX}${rawName}`),
)
const SYSTEM_PUBLIC_TOOLS = WINDOWS_MCP_SYSTEM_TOOLS.map(rawName => `${PUBLIC_PREFIX}${rawName}`)

/** Only a durable session mode grants desktop-wide authority. */
function fullAccess(session?: Session): boolean {
  return session !== undefined && effectiveSandboxMode(session.events) === 'danger-full-access'
}

/** Denials that neither an approval answer nor an earlier policy listener can waive. */
function denial(toolName: string, session?: Session): string | undefined {
  if (!toolName.startsWith(PUBLIC_PREFIX)) return undefined
  if (!WINDOWS_MCP_PUBLIC_TOOLS.has(toolName)) {
    return `Windows MCP tool "${toolName}" is not in the built-in catalog`
  }
  if (SYSTEM_PUBLIC_TOOLS.includes(toolName) && !fullAccess(session)) {
    return `Windows MCP tool "${toolName}" requires Full access in the calling session`
  }
  return undefined
}

/**
 * Preserve downstream policy and require explicit Full access for system tools.
 * Desktop tools require approval in every other mode. Missing session policy
 * fails closed; the mode is read after downstream policy settles.
 * @param toolName - model-facing ToolRuntime name.
 * @param next - downstream policy decision.
 * @param session - calling session whose latest sandbox mode grants Full access.
 * @returns downstream denial/approval request, or this plugin's final decision.
 */
export async function decideWindowsMcpCall(
  toolName: string,
  next: () => Promise<PreToolDecision>,
  session?: Session,
): Promise<PreToolDecision> {
  if (!toolName.startsWith(PUBLIC_PREFIX)) return next()
  const downstream = await next()
  if (downstream.kind === 'deny') return downstream
  const reason = denial(toolName, session)
  if (reason !== undefined) return { kind: 'deny', reason }
  if (downstream.kind !== 'allow' || fullAccess(session)) return downstream
  return {
    kind: 'ask',
    reason: 'Windows desktop automation can read or control applications outside the DSH sandbox',
  }
}

interface Restriction {
  readonly names: readonly string[]
  readonly dispose: () => void
}

/**
 * Hide system tools from restricted sessions and guard their execution. Mode
 * changes and MCP discovery update existing scopes without restarting the child.
 * @param ctx - owner of the policy, with the live agent and tool registries.
 * @returns disposer for listeners, guards, and every owned scoped restriction.
 */
export function installWindowsMcpPolicy(ctx: Context): () => void {
  const dispose = ctx.effect(function* () {
    const restrictions = new Map<Agent, Restriction>()
    let syncing = false
    let dirty = false
    let stopped = false

    const remove = (agent: Agent): void => {
      const previous = restrictions.get(agent)
      restrictions.delete(agent)
      previous?.dispose()
    }

    const sync = (): void => {
      if (stopped) return
      dirty = true
      if (syncing) return
      syncing = true
      try {
        do {
          dirty = false
          const available = SYSTEM_PUBLIC_TOOLS.filter(name => ctx.tools.get(name) !== undefined)
          for (const agent of ctx.agents.list()) {
            const names = fullAccess(agent.session) ? [] : available
            const previous = restrictions.get(agent)
            if (names.length === 0) {
              remove(agent)
            } else if (previous?.names.length !== names.length
              || previous.names.some((name, index) => name !== names[index])) {
              const dispose = agent.ctx.tools.restrict({ deny: names })
              restrictions.set(agent, { names, dispose })
              previous?.dispose()
            }
          }
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- tools/change can set dirty during restriction updates.
        } while (dirty)
      } finally {
        syncing = false
      }
    }

    yield () => {
      stopped = true
      for (const agent of restrictions.keys()) remove(agent)
    }
    yield ctx.on('agent/created', sync)
    yield ctx.on('agent/disposed', ({ agent }) => { remove(agent) })
    yield ctx.on('session/event', (_session, event) => {
      if (event.type === 'sandbox/mode') sync()
    })
    yield ctx.on('tools/change', sync)
    yield ctx.on('tools/pre-execute', (exec, next) => decideWindowsMcpCall(exec.name, next, exec.agent?.session))
    yield ctx.tools.guard(exec => denial(exec.name, exec.agent?.session))
    sync()
  }, 'windows-mcp: session permissions')
  // oxlint-disable-next-line typescript/no-misused-promises -- exact synchronous disposer preserves Cordis effect identity.
  return dispose
}
