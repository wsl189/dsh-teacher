/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp-client`.
 * @module @deepseek-ai/dsh-mcp-client/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from './sampling.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-client'

/** Cordis companion plugin name. */
export const name = 'mcp-client-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every recorded sampling response resolves one earlier request and terminates exactly once. */
function validateResponse(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'mcp/sampling-response') return
  const request = session.events[event.data.requestSeq]
  if (request?.type !== 'mcp/sampling-request' || request.seq >= event.seq) {
    fail('mcp/sampling-response must reference an earlier sampling request in the same session')
  }
  if (event.data.chunks.at(-1)?.type !== 'finish' || event.data.chunks.filter(chunk => chunk.type === 'finish').length !== 1) {
    fail('mcp/sampling-response must contain exactly one terminal finish chunk')
  }
  if (session.events.some(previous => previous.seq < event.seq
    && previous.type === 'mcp/sampling-response' && previous.data.requestSeq === request.seq)) {
    fail('mcp/sampling-request must not receive more than one response')
  }
}

/** Check restored records and each live response before it enters the durable log. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateResponse(session, event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateResponse(session, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
