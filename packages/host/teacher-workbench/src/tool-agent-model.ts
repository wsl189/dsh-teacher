/** Shared model selection for short-lived, tool-constrained workbench agents. */

import type { ToolModelSelection } from '@deepseek-ai/dsh-agent-default-model'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'

/**
 * Prefer the model's non-reasoning or lowest reasoning mode for validated tool loops.
 * @param selection - User-selected provider, model, and optional reasoning effort.
 * @param info - Resolved capabilities for the selected model.
 * @returns The same route with the lowest advertised low-latency effort when available.
 */
export function lowLatencyToolSelection(
  selection: ToolModelSelection,
  info: LlmResolvedModelInfo,
): ToolModelSelection {
  const effort = info.reasoning?.efforts.find(candidate => candidate.id === 'off')
    ?? info.reasoning?.efforts.find(candidate => candidate.id === 'low')
  return effort === undefined ? selection : { ...selection, reasoningEffort: effort.id }
}
