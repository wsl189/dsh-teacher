/** A bounded model request whose diagnostic session records the exact input and response. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { AssistantStreamAccumulator, BlockAssembler, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { canonicalHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { ModelCheckRequest, ModelCheckResult } from './types.ts'

/** Limits resolved by the Session Controller before a check starts. */
export interface ModelCheckPolicy {
  /** Wall-clock limit including provider setup and streaming. */
  timeoutMs: number
  /** Maximum generated tokens for the connectivity request. */
  maxTokens: number
}

/**
 * Send a tool-free request through the saved model route and retain its diagnostic log.
 * @param ctx - Host context owning the LLM registry and session store.
 * @param request - saved provider and model to exercise.
 * @param policy - resolved deadline and token limit.
 * @param callerSignal - Remote cancellation.
 * @returns the checked model and diagnostic session id after a successful provider finish.
 * @throws when configuration, provider streaming, cancellation, or persistence fails.
 */
export async function checkModel(
  ctx: Context,
  request: ModelCheckRequest,
  policy: ModelCheckPolicy,
  callerSignal: AbortSignal,
): Promise<ModelCheckResult> {
  const controller = new AbortController()
  const signal = AbortSignal.any([callerSignal, controller.signal])
  const timer = setTimeout(() => { controller.abort(new Error('Model connection check timed out')) }, policy.timeoutMs)
  let complete!: () => void
  const completed = new Promise<void>((resolve) => { complete = resolve })
  const dispose = ctx.effect(() => async () => {
    controller.abort()
    await completed
  }, 'session-controller: model connection check')
  try {
    signal.throwIfAborted()
    const prepared = await ctx.llm.prepareCall({ ...request, maxTokens: policy.maxTokens }, signal)
    signal.throwIfAborted()
    const session = ctx.sessions.prepare(SessionId(randomUUID()), { meta: { origin: 'subagent' } })
    const detach = ctx.sessions.enter(session)
    try {
      ctx.sessions.announce(session)
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('request/header', {
        header: canonicalHeader({ config: prepared.config, adapterDefaults: prepared.adapterDefaults }), reason: 'initial',
      })
      const input = createUserMessage({
        content: [{ type: 'text', text: 'Reply with OK.' }],
        source: { kind: 'plugin', plugin: 'dsh-api-session-controller' },
      })
      session.append('user/message', input, { surfaceOp: 'append' })
      const assembler = new BlockAssembler()
      const stream = new AssistantStreamAccumulator()
      let finished = false
      try {
        for await (const chunk of prepared.stream({
          ...prepared.config, messages: [input], sessionId: session.id, signal,
        })) {
          signal.throwIfAborted()
          stream.push({ time: Date.now(), chunk })
          assembler.push(chunk)
          if (chunk.type === 'finish') finished = true
        }
        signal.throwIfAborted()
        if (!finished) throw new Error('The model closed the response without a completion result')
        switch (assembler.finish.kind) {
          case 'stop':
          case 'max-tokens':
            break
          case 'error':
          case 'aborted':
            throw new Error(assembler.finish.failure.message)
          case 'tool-calls':
            throw new Error('The model requested an unavailable tool')
          default:
            assertNever(assembler.finish)
        }
        const message = createAssistantMessage({ content: assembler.blocks(), source: request })
        session.append('assistant/message', {
          turn: 1, step: 1, message, stream: [...stream.snapshot()], ...assembler.usage === undefined ? {} : { usage: assembler.usage },
        }, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      } catch (error) {
        session.append('assistant/attempt', { turn: 1, step: 1, stream: [...stream.snapshot()] })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1, reason: { kind: 'error', error: {
            code: 'MODEL_CHECK_FAILED', message: error instanceof Error ? error.message : String(error),
          } },
        })
        throw error
      } finally {
        await ctx.sessions.flush(session)
      }
      return { ...request, sessionId: session.id }
    } finally {
      detach()
    }
  } finally {
    clearTimeout(timer)
    complete()
    await dispose()
  }
}
