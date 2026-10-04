/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-config-editor'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'agent-default-model'

/** Stored and composed default model selection. */
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
  /** Provider route used by product-owned background agent tasks. */
  toolProvider?: string
  /** Provider-owned model id used by product-owned background agent tasks. */
  toolModel?: string
  /** Provider access route used by product-owned image-generation surfaces. */
  imageProvider?: string
  /** Provider-owned image-generation model id. */
  imageModel?: string
  /** Provider access route used by product-owned speech-recognition surfaces. */
  speechProvider?: string
  /** Provider-owned speech-recognition model id. */
  speechModel?: string
}

/** Model call settings selected for product-owned background agent tasks. */
export interface ToolModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Optional task-owned reasoning effort validated against the exact model. */
  reasoningEffort?: ReturnType<typeof ReasoningEffortId>
}

/** Schema of the default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
  toolProvider: z.string(),
  toolModel: z.string(),
  imageProvider: z.string(),
  imageModel: z.string(),
  speechProvider: z.string(),
  speechModel: z.string(),
})


/** Default model selection supplied by plugin configuration. */
export interface Config {
  /** Registered provider route. */
  provider: Volatile<string>
  /** Provider-owned model id. */
  model: Volatile<string>
  /** Adapter-owned reasoning effort; omission follows the provider default. */
  reasoningEffort: Volatile<string | undefined>
  /** Teacher task model assignment. */
  toolProvider: Volatile<string | undefined>
  /** Teacher task model assignment. */
  toolModel: Volatile<string | undefined>
  /** Teacher task model assignment. */
  imageProvider: Volatile<string | undefined>
  /** Teacher task model assignment. */
  imageModel: Volatile<string | undefined>
  /** Teacher task model assignment. */
  speechProvider: Volatile<string | undefined>
  /** Teacher task model assignment. */
  speechModel: Volatile<string | undefined>
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: { provider: string; model: string; reasoningEffort?: string }): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * Each operation reads the owning Config references.
 */
export class AgentDefaultModelConfig extends Service {
  private saves: Promise<void> = Promise.resolve()

  static Config = z.object({
    provider: z.string().required().volatile(),
    model: z.string().required().volatile(),
    reasoningEffort: z.string().volatile(),
    toolProvider: z.string().volatile(),
    toolModel: z.string().volatile(),
    imageProvider: z.string().volatile(),
    imageModel: z.string().volatile(),
    speechProvider: z.string().volatile(),
    speechModel: z.string().volatile(),
  })

  constructor(private readonly ownerContext: Context, private config: Config) {
    super(ownerContext, 'agentDefaultModel')

    ownerContext.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ownerContext.fiber)) })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    const reasoningEffort = this.config.reasoningEffort.get()
    return selection({
      provider: this.config.provider.get(), model: this.config.model.get(),
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    })
  }

  private teacherSelection(): AgentDefaultModelSettings {
    const toolProvider = this.config.toolProvider.get()
    const toolModel = this.config.toolModel.get()
    const imageProvider = this.config.imageProvider.get()
    const imageModel = this.config.imageModel.get()
    const speechProvider = this.config.speechProvider.get()
    const speechModel = this.config.speechModel.get()
    return {
      provider: this.config.provider.get(), model: this.config.model.get(),
      ...toolProvider === undefined ? {} : { toolProvider },
      ...toolModel === undefined ? {} : { toolModel },
      ...imageProvider === undefined ? {} : { imageProvider },
      ...imageModel === undefined ? {} : { imageModel },
      ...speechProvider === undefined ? {} : { speechProvider },
      ...speechModel === undefined ? {} : { speechModel },
    }
  }

  /**
   * Read the model selected for product-owned background agent tasks.
   * An unset tool model follows the current default model without inheriting
   * its conversation reasoning effort.
   * @returns a detached provider and model selection.
   */
  currentToolSelection(): ToolModelSelection {
    const current = this.teacherSelection()
    return current.toolProvider === undefined || current.toolModel === undefined
      ? { provider: current.provider, model: current.model }
      : { provider: current.toolProvider, model: current.toolModel }
  }

  /**
   * Read the model selected for product-owned image-generation surfaces.
   * @returns a detached provider and model selection, or undefined when unset.
   */
  currentImageSelection(): ToolModelSelection | undefined {
    const current = this.teacherSelection()
    return current.imageProvider === undefined || current.imageModel === undefined
      ? undefined
      : { provider: current.imageProvider, model: current.imageModel }
  }

  /**
   * Read the model selected for product-owned speech-recognition surfaces.
   * @returns a detached provider and model selection, or undefined when unset.
   */
  currentSpeechSelection(): ToolModelSelection | undefined {
    const current = this.teacherSelection()
    return current.speechProvider === undefined || current.speechModel === undefined
      ? undefined
      : { provider: current.speechProvider, model: current.speechModel }
  }

  /**
   * Save the complete default model selection. A deployment without a configuration
   * editor keeps its composition entry. Saves commit in submission order; a failed
   * save rejects its caller without blocking later saves.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional profile write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    const entry = this.ownerContext.fiber.entry
    if (entry === undefined) return
    const editor = this.ctx.get('configEditor')
    if (editor === undefined) return
    const config = {
      provider: next.provider, model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    }
    const saved = this.saves.then(() => editor.edit(entry, (current) => {
      const preserved = { ...current }
      Reflect.deleteProperty(preserved, 'reasoningEffort')
      return { ...preserved, ...config }
    }))
    this.saves = saved.catch(() => {})
    await saved
  }
}

export default AgentDefaultModelConfig
