/** Shared low-latency tool-agent model selection behavior. */

import type { ToolModelSelection } from '@deepseek-ai/dsh-agent-default-model'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { lowLatencyToolSelection } from '../src/tool-agent-model.ts'

const selection: ToolModelSelection = {
  provider: 'provider',
  model: 'model',
  reasoningEffort: ReasoningEffortId('high'),
}

function modelInfo(efforts?: readonly ReasoningEffortId[]): LlmResolvedModelInfo {
  return {
    provider: selection.provider,
    id: selection.model,
    name: 'Model',
    ...(efforts === undefined
      ? {}
      : { reasoning: { efforts: efforts.map(id => ({ id, name: id })) } }),
  }
}

describe('lowLatencyToolSelection', () => {
  it('prefers an advertised non-reasoning effort', () => {
    expect(lowLatencyToolSelection(selection, modelInfo([
      ReasoningEffortId('low'),
      ReasoningEffortId('off'),
    ]))).toEqual({
      provider: 'provider',
      model: 'model',
      reasoningEffort: 'off',
    })
  })

  it('falls back to the lowest advertised reasoning effort', () => {
    expect(lowLatencyToolSelection(selection, modelInfo([
      ReasoningEffortId('high'),
      ReasoningEffortId('low'),
    ]))).toEqual({
      provider: 'provider',
      model: 'model',
      reasoningEffort: 'low',
    })
  })

  it('preserves the original selection when neither low-latency effort is advertised', () => {
    expect(lowLatencyToolSelection(selection, modelInfo([ReasoningEffortId('high')]))).toBe(selection)
    expect(lowLatencyToolSelection(selection, modelInfo())).toBe(selection)
  })
})
