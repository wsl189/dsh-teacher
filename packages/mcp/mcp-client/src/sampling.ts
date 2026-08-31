/** Opt-in text sampling tied to an approved tool invocation, its logged model route, and cancellation. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'
import {
  BlockAssembler, createAssistantMessage, createUserMessage, deepFreeze,
} from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig, Message, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  CreateMessageRequestSchema, ErrorCode, McpError,
} from '@modelcontextprotocol/sdk/types.js'
import type { CreateMessageRequest, CreateMessageResult } from '@modelcontextprotocol/sdk/types.js'

/** Metadata key echoed from `tools/call` `_meta` into sampling `metadata` by an opted-in server. */
export const SAMPLING_TOKEN_KEY = 'deepseek-harness/sampling-token'

/** Deployment policy for servers that echo the per-call sampling token. Omission disables sampling. */
export interface SamplingConfig {
  /** Exact raw tool names permitted to request one text completion per invocation. */
  includeTools: string[]
  /** Maximum UTF-8 bytes of sampling parameters, including prompts, messages, and metadata. */
  maxInputBytes: number
  /** Upper bound on the server-requested output-token limit. */
  maxOutputTokens: number
}

/** Detached sampling policy validated before client initialization. */
export interface ResolvedSamplingConfig {
  /** Exact raw tool names admitted for correlated sampling. */
  readonly includeTools: ReadonlySet<string>
  /** Complete request byte limit. */
  readonly maxInputBytes: number
  /** Completion token ceiling. */
  readonly maxOutputTokens: number
}

/** Exact auxiliary input logged before dispatch to the initiating session's model. */
export interface McpSamplingRequestData {
  /** Locally configured server namespace, not the server-advertised name. */
  readonly serverName: string
  /** Approved tool invocation responsible for this completion. */
  readonly callId: ToolCallId
  /** Model-requested root invocation, including PTC sub-dispatch ancestry. */
  readonly rootCallId: ToolCallId
  /** Prepared provider/model route and generation settings. */
  readonly config: LlmCallConfig
  /** Server-supplied system prompt, with no conversation context appended. */
  readonly system?: string
  /** Exact immutable auxiliary message list. */
  readonly messages: Message[]
}

/** Complete model response, including cancellation or failure, for auxiliary replay. */
export interface McpSamplingResponseData {
  /** Sequence of the preceding `mcp/sampling-request` in the same session. */
  readonly requestSeq: number
  /** Raw model chunks ending with a terminal finish chunk. */
  readonly chunks: StreamChunk[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only input for a tool-correlated MCP completion. */
    'mcp/sampling-request': McpSamplingRequestData
    /** Log-only output for one preceding MCP completion request. */
    'mcp/sampling-response': McpSamplingResponseData
  }
}

/**
 * Validate an explicit sampling opt-in; no model access is granted by omission.
 * @param config - deployment policy supplied through the plugin configuration.
 * @returns detached policy, or `undefined` when sampling is disabled.
 */
export function resolveSamplingConfig(config: SamplingConfig | undefined): ResolvedSamplingConfig | undefined {
  if (config === undefined) return undefined
  const includeTools = new Set(config.includeTools)
  if (includeTools.size === 0 || includeTools.size !== config.includeTools.length
    || [...includeTools].some(name => name.length === 0)) {
    throw new Error('mcp-client: sampling.includeTools must contain distinct, non-empty raw tool names')
  }
  for (const field of ['maxInputBytes', 'maxOutputTokens'] as const) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) {
      throw new Error(`mcp-client: sampling.${field} must be a positive safe integer`)
    }
  }
  return Object.freeze({ includeTools, maxInputBytes: config.maxInputBytes, maxOutputTokens: config.maxOutputTokens })
}

type SamplingToken = Branded<'McpSamplingToken'>

interface ActiveCall {
  readonly exec: ToolExecution
  readonly controller: AbortController
  pending?: Promise<CreateMessageResult>
}

/** One connection generation's sampling authority and in-flight completion lifetime. */
export interface SamplingBridge {
  /**
   * Invoke a tool with a token only when its name and session are admitted.
   * @param rawName - raw MCP tool name.
   * @param exec - approved invocation carrying its session and cancellation.
   * @param send - transport call receiving private metadata and the coupled signal.
   * @returns the transport result after any nested completion has stopped.
   */
  call<T>(
    rawName: string,
    exec: ToolExecution,
    send: (meta: Record<string, string> | undefined, signal: AbortSignal) => Promise<T>,
  ): Promise<T>
  /** Abort completions, refuse further sampling, and wait for in-flight model calls to settle. */
  dispose(): Promise<void>
}

/** Translate text-only MCP messages without granting tools, images, or other sessions' context. */
function messagesFor(request: CreateMessageRequest['params'], config: LlmCallConfig): Message[] {
  if (request.messages.length === 0) throw new McpError(ErrorCode.InvalidParams, 'MCP sampling requires at least one message')
  return request.messages.map((message) => {
    const content = Array.isArray(message.content) ? message.content : [message.content]
    const text = content.map((block) => {
      if (block.type !== 'text') throw new McpError(ErrorCode.InvalidParams, 'MCP sampling accepts text content only')
      return { type: 'text' as const, text: block.text }
    })
    return message.role === 'user'
      ? createUserMessage({ source: { kind: 'plugin', plugin: 'mcp-client' }, content: text })
      : createAssistantMessage({ source: { provider: config.provider, model: config.model }, content: text })
  })
}

/** Execute and log one already-correlated request using the caller's exact recorded route. */
async function sample(
  ctx: Context,
  serverName: string,
  policy: ResolvedSamplingConfig,
  call: ActiveCall,
  params: CreateMessageRequest['params'],
  signal: AbortSignal,
): Promise<CreateMessageResult> {
  signal.throwIfAborted()
  if (Buffer.byteLength(JSON.stringify(params), 'utf8') > policy.maxInputBytes) {
    throw new McpError(ErrorCode.InvalidParams, 'MCP sampling request exceeds sampling.maxInputBytes')
  }
  if ((params.includeContext !== undefined && params.includeContext !== 'none')
    || params.tools !== undefined || params.toolChoice !== undefined) {
    throw new McpError(ErrorCode.InvalidParams, 'MCP sampling does not grant tools or additional context')
  }
  if (!Number.isSafeInteger(params.maxTokens) || params.maxTokens < 1) {
    throw new McpError(ErrorCode.InvalidParams, 'MCP sampling maxTokens must be a positive safe integer')
  }
  const session = call.exec.agent?.session
  const route = session?.requestHeader()?.config
  if (session === undefined || route === undefined) {
    throw new McpError(ErrorCode.InvalidRequest, 'MCP sampling requires a calling session with a logged model route')
  }
  const llm = ctx.get('llm')
  if (llm === undefined) throw new McpError(ErrorCode.InternalError, 'MCP sampling model service is unavailable')
  const config: LlmCallConfig = {
    provider: route.provider,
    model: route.model,
    maxTokens: Math.min(params.maxTokens, policy.maxOutputTokens),
    ...params.temperature === undefined ? {} : { temperature: params.temperature },
    ...params.stopSequences === undefined ? {} : { stop: params.stopSequences },
  }
  const messages = messagesFor(params, config)
  const prepared = await llm.prepareCall(config, signal)
  signal.throwIfAborted()
  const request = session.append('mcp/sampling-request', {
    serverName, callId: call.exec.callId, rootCallId: call.exec.rootCallId,
    config: prepared.config, messages,
    ...params.systemPrompt === undefined ? {} : { system: params.systemPrompt },
  })
  const chunks: StreamChunk[] = []
  try {
    for await (const chunk of prepared.stream(deepFreeze({
      ...request.data.config, messages: request.data.messages,
      ...request.data.system === undefined ? {} : { system: request.data.system },
      sessionId: session.id, purpose: 'mcp-sampling', signal,
    }))) {
      signal.throwIfAborted()
      chunks.push(chunk)
    }
    signal.throwIfAborted()
    if (chunks.at(-1)?.type !== 'finish') throw new Error('MCP sampling model stream has no terminal finish')
  } catch (error) {
    if (chunks.at(-1)?.type === 'finish') chunks.pop()
    chunks.push({
      type: 'finish',
      reason: signal.aborted
        ? { kind: 'aborted', failure: { code: 'ABORTED', message: 'MCP sampling was canceled' } }
        : { kind: 'error', failure: { code: 'MCP_SAMPLING_FAILED', message: error instanceof Error ? error.message : String(error) } },
    })
  }
  session.append('mcp/sampling-response', { requestSeq: request.seq, chunks })
  const assembler = new BlockAssembler()
  for (const chunk of chunks) assembler.push(chunk)
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new McpError(ErrorCode.InternalError, finish.failure.message)
  }
  if (finish.kind !== 'stop' && finish.kind !== 'max-tokens') {
    // Provider-extensible finish reasons do not grant execution of generated tools.
    throw new McpError(ErrorCode.InternalError, 'MCP sampling model did not finish with text')
  }
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) {
    throw new McpError(ErrorCode.InternalError, 'MCP sampling model returned unsupported content')
  }
  const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('')
  if (text.length === 0) throw new McpError(ErrorCode.InternalError, 'MCP sampling model returned no text')
  return {
    role: 'assistant', model: prepared.config.model, content: { type: 'text', text },
    stopReason: finish.kind === 'max-tokens' ? 'maxTokens' : 'endTurn',
  }
}

/**
 * Register the generation's text-sampling handler before MCP initialization.
 * @param ctx - context with the configured LLM service.
 * @param client - one client generation advertising the sampling capability.
 * @param serverName - locally configured server identity for durable records.
 * @param policy - validated explicit sampling policy.
 * @returns invocation correlation and joined teardown for this generation.
 */
export function createSamplingBridge(
  ctx: Context,
  client: Client,
  serverName: string,
  policy: ResolvedSamplingConfig,
): SamplingBridge {
  const calls = new Map<SamplingToken, ActiveCall>()
  let disposed = false
  client.setRequestHandler(CreateMessageRequestSchema, (request, extra) => {
    const metadata = request.params.metadata
    const token = metadata !== undefined && SAMPLING_TOKEN_KEY in metadata ? metadata[SAMPLING_TOKEN_KEY] : undefined
    const call = typeof token === 'string' ? calls.get(token as SamplingToken) : undefined
    if (disposed || call === undefined || call.controller.signal.aborted || call.exec.signal.aborted) {
      throw new McpError(ErrorCode.InvalidRequest, 'MCP sampling does not belong to an active permitted tool call')
    }
    if (call.pending !== undefined) {
      throw new McpError(ErrorCode.InvalidRequest, 'MCP sampling permits one completion per tool call')
    }
    call.pending = sample(ctx, serverName, policy, call, request.params,
      AbortSignal.any([call.exec.signal, call.controller.signal, extra.signal]))
    return call.pending
  })
  return {
    async call(rawName, exec, send) {
      if (disposed) throw new Error('MCP sampling connection is closed')
      if (!policy.includeTools.has(rawName) || exec.agent === undefined) return send(undefined, exec.signal)
      const token = randomUUID() as SamplingToken
      const call: ActiveCall = { exec, controller: new AbortController() }
      const transport = new AbortController()
      const abortTransport = () => { transport.abort(call.controller.signal.reason) }
      call.controller.signal.addEventListener('abort', abortTransport, { once: true })
      calls.set(token, call)
      try {
        return await send({ [SAMPLING_TOKEN_KEY]: token }, AbortSignal.any([exec.signal, transport.signal]))
      } finally {
        // The SDK retains abort listeners after replies; completed requests must not receive cancellation.
        call.controller.signal.removeEventListener('abort', abortTransport)
        call.controller.abort()
        if (call.pending !== undefined) await Promise.allSettled([call.pending])
        calls.delete(token)
      }
    },
    async dispose() {
      disposed = true
      const active = [...calls.values()]
      for (const call of active) call.controller.abort()
      await Promise.allSettled(active.flatMap(call => call.pending === undefined ? [] : [call.pending]))
    },
  }
}
