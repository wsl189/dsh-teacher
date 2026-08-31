/** Real MCP request handling and LLM dispatch with deterministic model responses. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CreateMessageRequest } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, CallToolResultSchema, CancelledNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  createSamplingBridge, resolveSamplingConfig, SAMPLING_TOKEN_KEY,
} from '../src/sampling.ts'
import type { SamplingConfig } from '../src/sampling.ts'

const POLICY: SamplingConfig = { includeTools: ['Scrape'], maxInputBytes: 4096, maxOutputTokens: 2048 }
const PARAMS: CreateMessageRequest['params'] = {
  messages: [{ role: 'user', content: { type: 'text', text: 'The ticket costs 42 yuan.' } }],
  systemPrompt: 'Extract the requested price.',
  maxTokens: 4096,
}

function response(text: string): StreamChunk[] {
  return [{ type: 'text-delta', index: 0, text }, { type: 'finish', reason: { kind: 'stop' } }]
}

class RecordingModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  behavior: (options: GenerateOptions) => AsyncIterable<StreamChunk> = async function* () { yield* response('42 yuan') }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield* this.behavior(options)
  }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function harness(policy: SamplingConfig = POLICY, mountLlm = true) {
  const ctx = new Context()
  const model = new RecordingModel()
  if (mountLlm) {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], model)
  }
  const client = new Client({ name: 'sampling-client', version: '1' }, { capabilities: { sampling: {} } })
  const server = new McpServer({ name: 'sampling-server', version: '1' }, { capabilities: { tools: {} } }).server
  const bridge = createSamplingBridge(ctx, client, 'windows', resolveSamplingConfig(policy)!)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  cleanups.push(async () => {
    await bridge.dispose()
    await client.close()
    await server.close()
    await ctx.fiber.dispose()
  })
  const invoke = (exec: ToolExecution, params = PARAMS, rawName = 'Scrape') =>
    bridge.call(rawName, exec, meta => server.createMessage({ ...params, metadata: meta }))
  return { ctx, model, client, server, bridge, invoke }
}

function execution(id = 'one', loggedRoute = true, signal = new AbortController().signal): ToolExecution {
  const session = Session.create(SessionId(id))
  if (loggedRoute) session.append('request/header', { reason: 'initial', header: { config: { provider: 'test', model: `model-${id}` } } })
  return {
    callId: ToolCallId(`call-${id}`), rootCallId: ToolCallId(`call-${id}`),
    name: 'mcp__windows__Scrape', arguments: {}, signal,
    agent: { id: session.id, session } as NonNullable<ToolExecution['agent']>,
    token: Symbol(id) as ToolExecution['token'],
  }
}

describe('MCP sampling policy', () => {
  it('requires explicit tool names and positive request and completion limits', () => {
    expect(resolveSamplingConfig(undefined)).toBeUndefined()
    expect(resolveSamplingConfig(POLICY)?.includeTools).toEqual(new Set(['Scrape']))
    for (const includeTools of [[], [''], ['Scrape', 'Scrape']]) {
      expect(() => resolveSamplingConfig({ ...POLICY, includeTools })).toThrow('distinct, non-empty')
    }
    for (const value of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveSamplingConfig({ ...POLICY, maxInputBytes: value })).toThrow('positive safe integer')
      expect(() => resolveSamplingConfig({ ...POLICY, maxOutputTokens: value })).toThrow('positive safe integer')
    }
  })

  it('uses the logged caller route and records exact auxiliary input and output', async () => {
    const h = await harness()
    const exec = execution()
    const result = await h.invoke(exec, { ...PARAMS, temperature: 0.2, stopSequences: ['END'], modelPreferences: { hints: [{ name: 'foreign-model' }] } })
    expect(result).toMatchObject({ model: 'model-one', content: { type: 'text', text: '42 yuan' }, stopReason: 'endTurn' })
    expect(h.model.requests).toHaveLength(1)
    const request = h.model.requests[0]!
    expect(request).toMatchObject({ provider: 'test', model: 'model-one', maxTokens: 2048, temperature: 0.2, stop: ['END'], purpose: 'mcp-sampling' })
    expect(request.tools).toBeUndefined()
    const events = exec.agent!.session.events
    const input = events.find(event => event.type === 'mcp/sampling-request')!
    const output = events.find(event => event.type === 'mcp/sampling-response')!
    expect(input.data).toMatchObject({ serverName: 'windows', callId: exec.callId, messages: request.messages, system: request.system })
    expect(output.data).toMatchObject({ requestSeq: input.seq, chunks: response('42 yuan') })
    expect(JSON.stringify(events)).not.toContain(SAMPLING_TOKEN_KEY)
    expect(Object.isFrozen(request)).toBe(true)
  })

  it('preserves assistant text and max-token completion status without exposing reasoning', async () => {
    const h = await harness()
    h.model.behavior = async function* () {
      yield { type: 'reasoning-delta', index: 0, text: 'private reasoning' }
      yield { type: 'text-delta', index: 1, text: 'partial answer' }
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
    }
    const { systemPrompt: _system, ...params } = PARAMS
    const result = await h.invoke(execution(), { ...params, messages: [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      { role: 'assistant', content: { type: 'text', text: 'prior answer' } },
    ] })
    expect(result).toMatchObject({ content: { text: 'partial answer' }, stopReason: 'maxTokens' })
    expect(h.model.requests[0]?.messages[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'prior answer' }] })
    expect(h.model.requests[0]?.system).toBeUndefined()
  })

  it('does not cancel a completed tool request while closing its sampling authority', async () => {
    const h = await harness()
    const canceled: unknown[] = []
    h.server.setNotificationHandler(CancelledNotificationSchema, (notification) => { canceled.push(notification) })
    h.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await h.server.createMessage({ ...PARAMS, metadata: request.params._meta })
      return { content: [result.content] }
    })
    const result = await h.bridge.call('Scrape', execution(), (meta, signal) => h.client.request({
      method: 'tools/call', params: { name: 'Scrape', arguments: {}, _meta: meta },
    }, CallToolResultSchema, { signal }))
    expect(result.content).toEqual([{ type: 'text', text: '42 yuan' }])
    await h.bridge.dispose()
    expect(canceled).toEqual([])
  })

  it('refuses unsolicited, malformed, expired, and repeated sampling tokens', async () => {
    const h = await harness()
    for (const metadata of [undefined, {}, 'invalid', { [SAMPLING_TOKEN_KEY]: 'unknown' }]) {
      await expect(h.server.createMessage({ ...PARAMS, metadata: metadata as object | undefined })).rejects.toThrow(
        typeof metadata === 'string' ? 'Invalid input' : 'active permitted tool call',
      )
    }
    let token: Record<string, string> | undefined
    await h.bridge.call('Scrape', execution(), async (meta) => {
      token = meta
      await h.server.createMessage({ ...PARAMS, metadata: meta })
      await expect(h.server.createMessage({ ...PARAMS, metadata: meta })).rejects.toThrow('one completion per tool call')
    })
    await expect(h.server.createMessage({ ...PARAMS, metadata: token })).rejects.toThrow('active permitted tool call')
    expect(h.model.requests).toHaveLength(1)
  })

  it('does not authorize unlisted tools or callers without a session', async () => {
    const h = await harness()
    await expect(h.invoke(execution(), PARAMS, 'Other')).rejects.toThrow('active permitted tool call')
    const { agent: _agent, ...exec } = execution()
    await expect(h.invoke(exec)).rejects.toThrow('active permitted tool call')
    expect(h.model.requests).toHaveLength(0)
  })

  it('requires a durable model route and an available LLM service', async () => {
    const h = await harness()
    await expect(h.invoke(execution('no-header', false))).rejects.toThrow('logged model route')
    const noLlm = await harness(POLICY, false)
    await expect(noLlm.invoke(execution())).rejects.toThrow('model service is unavailable')
  })

  it('bounds the complete UTF-8 request and refuses empty or non-text messages', async () => {
    const small = await harness({ ...POLICY, maxInputBytes: 16 })
    await expect(small.invoke(execution(), { ...PARAMS, systemPrompt: '中文内容' })).rejects.toThrow('maxInputBytes')
    const h = await harness()
    await expect(h.invoke(execution(), { ...PARAMS, messages: [] })).rejects.toThrow('at least one message')
    await expect(h.invoke(execution(), { ...PARAMS, maxTokens: 0 })).rejects.toThrow('maxTokens')
    await expect(h.invoke(execution(), { ...PARAMS, messages: [{ role: 'user', content: { type: 'image', data: 'AA==', mimeType: 'image/png' } }] })).rejects.toThrow('text content only')
    expect(h.model.requests).toHaveLength(0)
  })

  it('refuses requested tools and implicit context from other sessions', async () => {
    const h = await harness()
    await expect(h.invoke(execution(), { ...PARAMS, includeContext: 'allServers' })).rejects.toThrow()
    await expect(h.invoke(execution(), { ...PARAMS, tools: [] })).rejects.toThrow()
    expect(h.model.requests).toHaveLength(0)
  })

  it('keeps concurrent callers on their own model routes and session logs', async () => {
    const h = await harness()
    const firstEntered: PromiseWithResolvers<void> = Promise.withResolvers()
    const releaseFirst: PromiseWithResolvers<void> = Promise.withResolvers()
    h.model.behavior = async function* (options) {
      if (options.model === 'model-first') { firstEntered.resolve(); await releaseFirst.promise }
      yield* response(options.model)
    }
    const first = execution('first')
    const second = execution('second')
    const pending = h.invoke(first)
    await firstEntered.promise
    const result = await h.invoke(second)
    expect(result.content).toEqual({ type: 'text', text: 'model-second' })
    releaseFirst.resolve()
    expect((await pending).content).toEqual({ type: 'text', text: 'model-first' })
    expect(JSON.stringify(first.agent!.session.events)).not.toContain('model-second')
    expect(JSON.stringify(second.agent!.session.events)).not.toContain('model-first')
  })

  it('closes a permitted invocation before it requests sampling', async () => {
    const h = await harness()
    const entered: PromiseWithResolvers<void> = Promise.withResolvers()
    const pending = h.bridge.call('Scrape', execution(), (_meta, signal) => {
      entered.resolve()
      return new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    })
    await entered.promise
    await h.bridge.dispose()
    await pending
    expect(h.model.requests).toHaveLength(0)
  })

  it('joins a canceled completion when the transport has already returned', async () => {
    const h = await harness()
    const entered: PromiseWithResolvers<void> = Promise.withResolvers()
    const aborted: PromiseWithResolvers<void> = Promise.withResolvers()
    const release: PromiseWithResolvers<void> = Promise.withResolvers()
    h.model.behavior = async function* (options) {
      entered.resolve()
      await new Promise<void>((resolve) => { options.signal!.addEventListener('abort', () => { resolve() }, { once: true }) })
      aborted.resolve()
      await release.promise
      yield* response('late result')
    }
    let sampling: Promise<unknown> | undefined
    const pending = h.bridge.call('Scrape', execution(), async (meta) => {
      sampling = h.server.createMessage({ ...PARAMS, metadata: meta }).catch((error: unknown) => error as Error)
      await entered.promise
    })
    await aborted.promise
    let disposed = false
    const disposal = h.bridge.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    release.resolve()
    await Promise.all([pending, sampling, disposal])
    expect(disposed).toBe(true)
  })

  it('records a non-Error stream middleware exception as a failed completion', async () => {
    const h = await harness()
    h.ctx.on('llm/stream', async function* () {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Third-party stream middleware can reject non-Error values.
      await Promise.reject('middleware rejected')
      yield* []
    })
    await expect(h.invoke(execution())).rejects.toThrow('middleware rejected')
  })

  it('records one terminal outcome when cancellation races the completed model stream', async () => {
    const h = await harness()
    const controller = new AbortController()
    h.model.behavior = async function* () {
      yield* response('completed text')
      controller.abort()
    }
    const exec = execution('late-cancel', true, controller.signal)
    await expect(h.invoke(exec)).rejects.toThrow('canceled')
    const output = exec.agent!.session.events.find(event => event.type === 'mcp/sampling-response')!
    expect(output.data.chunks.filter(chunk => chunk.type === 'finish')).toEqual([
      { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'MCP sampling was canceled' } } },
    ])
  })

  it.each(['caller', 'connection'] as const)('cancels and joins the model when the %s stops', async (cause) => {
    const h = await harness()
    const entered: PromiseWithResolvers<void> = Promise.withResolvers()
    let settled = false
    h.model.behavior = async function* (options) {
      entered.resolve()
      await new Promise<void>((resolve) => { options.signal!.addEventListener('abort', () => { resolve() }, { once: true }) })
      settled = true
      yield* response('late result')
    }
    const controller = new AbortController()
    const exec = execution('cancel', true, controller.signal)
    const outcome = h.invoke(exec).catch((error: unknown) => error as Error)
    await entered.promise
    if (cause === 'caller') controller.abort()
    else await h.bridge.dispose()
    expect((await outcome).message).toContain('canceled')
    expect(settled).toBe(true)
    expect(exec.agent!.session.events.at(-1)?.data).toMatchObject({ chunks: [{ type: 'finish', reason: { kind: 'aborted' } }] })
    if (cause === 'connection') await expect(h.invoke(execution('after-close'))).rejects.toThrow('connection is closed')
  })

  it.each([
    { label: 'provider failure', chunks: [{ type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM', message: 'provider refused' } } }] as StreamChunk[], error: 'provider refused' },
    { label: 'missing finish', chunks: [] as StreamChunk[], error: 'terminal finish' },
    { label: 'tool use', chunks: [{ type: 'finish', reason: { kind: 'tool-calls' } }] as StreamChunk[], error: 'did not finish with text' },
    { label: 'empty completion', chunks: [{ type: 'finish', reason: { kind: 'stop' } }] as StreamChunk[], error: 'no text' },
    { label: 'unsupported content', chunks: [{ type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('unrequested'), name: 'other', arguments: '{}' } }, { type: 'finish', reason: { kind: 'stop' } }] as StreamChunk[], error: 'unsupported content' },
  ])('records $label without reporting it as successful sampling', async ({ chunks, error }) => {
    const h = await harness()
    h.model.behavior = async function* () { yield* chunks }
    const exec = execution()
    await expect(h.invoke(exec)).rejects.toThrow(error)
    expect(exec.agent!.session.events.at(-1)?.type).toBe('mcp/sampling-response')
  })
})
