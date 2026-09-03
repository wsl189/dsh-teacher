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
    ?? info.reasoning?.efforts[0]
  return effort === undefined ? selection : { ...selection, reasoningEffort: effort.id }
}

/**
 * Select an enabled reasoning effort for semantic workbench agents.
 * A route that advertises only Off receives no explicit effort so its provider
 * default remains available instead of being forced into non-reasoning mode.
 * @param selection - User-selected provider, model, and optional reasoning effort.
 * @param info - Resolved capabilities for the selected model.
 * @returns The same route with an enabled effort when the model advertises one.
 */
export function reasoningEnabledToolSelection(
  selection: ToolModelSelection,
  info: LlmResolvedModelInfo,
): ToolModelSelection {
  if (selection.reasoningEffort !== undefined && selection.reasoningEffort !== 'off') return selection
  const defaultEffort = info.reasoning?.defaultEffort
  const effort = defaultEffort !== undefined && defaultEffort !== 'off'
    ? info.reasoning?.efforts.find(candidate => candidate.id === defaultEffort)
    : info.reasoning?.efforts.find(candidate => candidate.id === 'low')
      ?? info.reasoning?.efforts.find(candidate => candidate.id !== 'off')
  const { reasoningEffort: _disabledEffort, ...route } = selection
  return effort === undefined ? route : { ...route, reasoningEffort: effort.id }
}

/**
 * Apply the configured reasoning policy for question-boundary children.
 * @param selection - User-selected provider, model, and optional reasoning effort.
 * @param info - Resolved capabilities for the selected model.
 * @param enabled - Whether question cutting should retain an enabled reasoning effort.
 * @returns The selected route with enabled or low-latency reasoning policy applied.
 */
export function questionSegmentationToolSelection(
  selection: ToolModelSelection,
  info: LlmResolvedModelInfo,
  enabled: boolean,
): ToolModelSelection {
  return enabled
    ? reasoningEnabledToolSelection(selection, info)
    : lowLatencyToolSelection(selection, info)
}
