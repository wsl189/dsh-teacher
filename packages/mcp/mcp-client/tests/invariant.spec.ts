/** Sampling log relationships across live responses and restored sessions. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as SamplingInvariant from '../src/invariant.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  const session = ctx.sessions.create()
  const request = session.append('mcp/sampling-request', {
    serverName: 'windows', callId: ToolCallId('scrape'), rootCallId: ToolCallId('scrape'),
    config: { provider: 'test', model: 'model' }, messages: [],
  })
  const response: Extract<SessionEvent, { type: 'mcp/sampling-response' }> = {
    type: 'mcp/sampling-response', seq: request.seq + 1, time: 0,
    data: { requestSeq: request.seq, chunks: [{ type: 'finish', reason: { kind: 'stop' } }] },
  }
  return { ctx, session, request, response }
}

describe('MCP sampling log invariants', () => {
  it('accepts one terminated response, including restored records and unrelated events', async () => {
    const { ctx, session, response } = await setup()
    session.append(response.type, response.data)
    await ctx.plugin(SamplingInvariant)
    expect(() => { ctx.emit('tools/change') }).not.toThrow()
    expect(() => { session.append('turn/start', { turn: 1 }) }).not.toThrow()
  })

  it.each(['missing', 'future', 'unterminated', 'double-finish', 'duplicate'] as const)('rejects a %s response', async (kind) => {
    const { ctx, session, request, response } = await setup()
    await ctx.plugin(SamplingInvariant)
    if (kind === 'missing') response.data = { ...response.data, requestSeq: 100 }
    if (kind === 'future') response.seq = request.seq
    if (kind === 'unterminated') response.data = { ...response.data, chunks: [] }
    if (kind === 'double-finish') response.data = { ...response.data, chunks: [...response.data.chunks, ...response.data.chunks] }
    if (kind === 'duplicate') {
      session.append(response.type, response.data)
      response.seq += 1
    }
    expect(() => { ctx.emit('session/event', session, response) }).toThrow(/sampling/)
  })

  it('rejects an invalid response already present on late registration', async () => {
    const { ctx, session, response } = await setup()
    session.append(response.type, { ...response.data, requestSeq: 99 })
    await expect(ctx.plugin(SamplingInvariant)).rejects.toThrow('earlier sampling request')
  })
})
