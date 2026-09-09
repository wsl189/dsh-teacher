/** Real LLM/session services exercise bounded verification with only the remote model replaced. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { checkModel } from '../src/model-check.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

class CheckAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = []
  constructor(private readonly response: (options: GenerateOptions) => AsyncIterable<StreamChunk>) { super() }
  override async listModels(): Promise<LlmModelInfo[]> { return [{ provider: 'test', id: 'model', name: 'Model' }] }
  override async resolveModel(): Promise<LlmModelInfo> { return { provider: 'test', id: 'model', name: 'Model' } }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    return this.response(options)
  }
}

async function harness(response: (options: GenerateOptions) => AsyncIterable<StreamChunk>) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  const adapter = new CheckAdapter(response)
  ctx.llm.registerAdapter(['test'], adapter)
  const logs: SessionEvent[][] = []
  ctx.on('session/flush', (session) => { logs.push([...session.events]) })
  const disposed: Session[] = []
  ctx.on('session/disposed', (session) => { disposed.push(session) })
  return { ctx, adapter, logs, disposed }
}

describe('saved model connectivity checks', () => {
  it('records the exact tool-free input, a completed provider response, and closes the diagnostic session', async () => {
    const { ctx, adapter, logs, disposed } = await harness(async function* () {
      yield { type: 'text-delta', index: 0, text: 'OK' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const result = await checkModel(ctx, { provider: 'test', model: 'model' }, { timeoutMs: 1_000, maxTokens: 16 }, new AbortController().signal)
    expect(result).toMatchObject({ provider: 'test', model: 'model' })
    expect(ctx.sessions.get(result.sessionId)).toBeUndefined()
    expect(disposed[0]?.header.origin).toBe('subagent')
    expect(adapter.calls).toHaveLength(1)
    const call = adapter.calls[0]!
    expect(call.tools).toBeUndefined()
    expect(call.system).toBeUndefined()
    expect(call.maxTokens).toBe(16)
    const log = logs[0]!
    expect(log.find(event => event.type === 'user/message')?.data).toEqual(call.messages[0])
    expect(log.map(event => event.type)).toEqual([
      'turn/start', 'step/start', 'request/header', 'user/message',
      'assistant/chunk', 'assistant/chunk', 'assistant/message', 'step/end', 'turn/end',
    ])
    expect(call.messages[0]?.content).toEqual([{ type: 'text', text: 'Reply with OK.' }])
  })

  it.each(['error', 'aborted'] as const)('retains a %s response as a failed check', async (kind) => {
    const { ctx, logs } = await harness(async function* () {
      yield { type: 'finish', reason: { kind, failure: { code: 'AUTH', message: 'Invalid API key' } } }
    })
    await expect(checkModel(ctx, { provider: 'test', model: 'model' }, { timeoutMs: 1_000, maxTokens: 16 }, new AbortController().signal))
      .rejects.toThrow('Invalid API key')
    expect(logs[0]?.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'error' } } })
  })

  it('rejects a stream that closes without a terminal result', async () => {
    const { ctx } = await harness(async function* () { yield { type: 'text-delta', index: 0, text: 'partial' } })
    await expect(checkModel(ctx, { provider: 'test', model: 'model' }, { timeoutMs: 1_000, maxTokens: 16 }, new AbortController().signal))
      .rejects.toThrow()
  })

  it('accepts a completed response at the token limit and rejects requests for unavailable tools', async () => {
    const { ctx } = await harness(async function* () { yield { type: 'finish', reason: { kind: 'max-tokens' } } })
    await expect(checkModel(ctx, { provider: 'test', model: 'model' }, { timeoutMs: 1_000, maxTokens: 16 }, new AbortController().signal))
      .resolves.toMatchObject({ provider: 'test', model: 'model' })
    const toolHarness = await harness(async function* () { yield { type: 'finish', reason: { kind: 'tool-calls' } } })
    await expect(checkModel(toolHarness.ctx, { provider: 'test', model: 'model' }, { timeoutMs: 1_000, maxTokens: 16 }, new AbortController().signal))
      .rejects.toThrow('unavailable tool')
  })

  it('aborts a stalled request at the configured deadline and waits for cleanup', async () => {
    const stopped = vi.fn()
    const { ctx, disposed } = await harness(async function* (options) {
      try {
        await new Promise<void>((resolve) => { options.signal!.addEventListener('abort', () => { resolve() }, { once: true }) })
        options.signal!.throwIfAborted()
      } finally { stopped() }
    })
    await expect(checkModel(ctx, { provider: 'test', model: 'model' }, { timeoutMs: 20, maxTokens: 16 }, new AbortController().signal))
      .rejects.toThrow('timed out')
    expect(stopped).toHaveBeenCalledOnce()
    expect(disposed).toHaveLength(1)
  })

  it('does not dispatch a cancelled request or invent a missing adapter', async () => {
    const { ctx, adapter } = await harness(async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
    await expect(checkModel(ctx, { provider: 'test', model: 'model' }, { timeoutMs: 100, maxTokens: 16 }, AbortSignal.abort()))
      .rejects.toThrow()
    await expect(checkModel(ctx, { provider: 'missing', model: 'model' }, { timeoutMs: 100, maxTokens: 16 }, new AbortController().signal))
      .rejects.toThrow('no adapter')
    expect(adapter.calls).toHaveLength(0)
  })
})
