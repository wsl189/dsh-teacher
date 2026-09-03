/** Shared tool-agent model selection behavior. */

import type { ToolModelSelection } from '@deepseek-ai/dsh-agent-default-model'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { lowLatencyToolSelection, reasoningEnabledToolSelection } from '../src/tool-agent-model.ts'

const selection: ToolModelSelection = {
  provider: 'provider',
  model: 'model',
  reasoningEffort: ReasoningEffortId('high'),
}

function modelInfo(
  efforts?: readonly ReasoningEffortId[],
  defaultEffort?: ReasoningEffortId,
): LlmResolvedModelInfo {
  return {
    provider: selection.provider,
    id: selection.model,
    name: 'Model',
    ...(efforts === undefined
      ? {}
      : { reasoning: {
        efforts: efforts.map(id => ({ id, name: id })),
        ...defaultEffort === undefined ? {} : { defaultEffort },
      } }),
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

describe('reasoningEnabledToolSelection', () => {
  it('preserves an explicit enabled effort', () => {
    expect(reasoningEnabledToolSelection(selection, modelInfo([
      ReasoningEffortId('off'),
      ReasoningEffortId('low'),
      ReasoningEffortId('high'),
    ], ReasoningEffortId('low')))).toBe(selection)
  })

  it('uses an enabled model default or the lowest enabled effort', () => {
    const disabled = { ...selection, reasoningEffort: ReasoningEffortId('off') }
    expect(reasoningEnabledToolSelection(disabled, modelInfo([
      ReasoningEffortId('off'),
      ReasoningEffortId('high'),
    ], ReasoningEffortId('high')))).toEqual({
      provider: 'provider', model: 'model', reasoningEffort: 'high',
    })
    expect(reasoningEnabledToolSelection(disabled, modelInfo([
      ReasoningEffortId('off'),
      ReasoningEffortId('low'),
      ReasoningEffortId('high'),
    ], ReasoningEffortId('off')))).toEqual({
      provider: 'provider', model: 'model', reasoningEffort: 'low',
    })
  })

  it('omits Off when no enabled effort is advertised', () => {
    expect(reasoningEnabledToolSelection(
      { ...selection, reasoningEffort: ReasoningEffortId('off') },
      modelInfo([ReasoningEffortId('off')]),
    )).toEqual({ provider: 'provider', model: 'model' })
  })
})
