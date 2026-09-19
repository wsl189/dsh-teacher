/** Record and replay model calls that attempt to leave loose Univer outputs in the workspace. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import {
  createUserMessage, LlmAdapter, ToolCallId,
  type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  assertFinalWorkspaceSnapshot, assertFixtureInventory, fixtureUserPrompts, launchWebScaffold,
  recordFixture, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'

const MODE = webSnapshotMode()
const PROVIDER = 'office-output-guard-fixture'
const MODEL = 'scripted-office-outputs'
const PROMPT = 'Check that new Univer projects, screenshots, resource assets, PDF previews, and Office exports cannot be written directly into the workspace without an Office temporary directory. Leave the workspace empty and reply OUTPUTS_BLOCKED.'
const CALLS = [
  { name: 'univer_new', arguments: { file: 'draft.univer' } },
  { name: 'univer_screenshot', arguments: { file: 'draft.univer', unitId: 'unit', output: 'screens' } },
  { name: 'univer_resources', arguments: { action: 'export', handles: ['icon'], output: 'assets' } },
  { name: 'univer_print_pdf', arguments: { file: 'draft.univer', unitId: 'unit', output: 'preview.pdf' } },
  { name: 'univer_export', arguments: { file: 'draft.univer', unitId: 'unit', output: 'draft.docx' } },
] as const

/** The real agent and bundled tools own every recorded result and filesystem effect. */
class OfficeOutputsAdapter extends LlmAdapter {
  private calls = 0

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: MODEL, context: { contextWindow: 128_000 } })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    const call = CALLS[this.calls++]
    if (call !== undefined) {
      const id = ToolCallId(`guard-${call.name}`)
      const args = JSON.stringify(call.arguments)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: call.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.calls !== CALLS.length + 1) throw new Error('Office output fixture received an unexpected model request')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'OUTPUTS_BLOCKED' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'OUTPUTS_BLOCKED' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe.skipIf(MODE === 'record')('bundled Office output ownership', () => {
  const snapshotDir = fileURLToPath(new URL('../../../snapshots/web/office-output-guard', import.meta.url))
  const fixture = join(snapshotDir, 'session.v3.jsonl')
  let scaffold: WebScaffold
  let workspace: string
  let handle: AgentHandle

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'refresh' ? {} : {
      replayFixture: fixture, compareReplaySession: true,
      replayProviders: [{ id: PROVIDER, name: PROVIDER, models: [{ id: MODEL, name: MODEL, contextWindow: 128_000 }] }],
    })
    if (MODE === 'refresh') {
      scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([PROVIDER], new OfficeOutputsAdapter()), 'synthetic Office output recording')
    }
    workspace = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspace)
    handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('office-output-guard'),
      meta: { cwd: workspace, agentPreset: 'standard' },
      agentOptions: { provider: PROVIDER, model: MODEL },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'Office output snapshot teardown failed')
  })

  it('records actionable denials before any loose output is created', async () => {
    const prompts = MODE === 'refresh' ? [PROMPT] : fixtureUserPrompts(await readFile(fixture, 'utf8'))
    expect(prompts).toEqual([PROMPT])
    for (const prompt of prompts) {
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }))
      await handle.agent.whenIdle()
    }
    await scaffold.ctx.sessions.flush(handle.agent.session)
    const events = handle.agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'tool/call').map(event => ({ name: event.data.name, arguments: event.data.arguments })))
      .toEqual(CALLS.map(call => ({ name: call.name, arguments: JSON.stringify(call.arguments) })))
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(CALLS.length)
    for (const event of results) {
      const block = event.data.message.content[0]
      expect(block).toMatchObject({ type: 'tool-result', isError: true })
      if (block?.type !== 'tool-result') throw new Error('Output denial did not return a tool result')
      expect(block.content).toHaveLength(1)
      const content = block.content[0]
      if (content?.type !== 'text') throw new Error('Output denial did not return text')
      expect(content.text).toContain('Call office_workspace with action="create"')
    }
    expect(events.filter(event => event.type === 'assistant/message').at(-1)?.data.message.content)
      .toEqual([{ type: 'text', text: 'OUTPUTS_BLOCKED' }])
    await assertFinalWorkspaceSnapshot(snapshotDir, workspace)
    if (MODE === 'refresh') await recordFixture(scaffold, handle.agent.session.id, fixture)
  })

  it('keeps its recording inventory closed', async () => {
    await assertFixtureInventory(snapshotDir, ['session.v3.jsonl', 'workspace.expected'])
  })
})
