---
description: "Process-wide model assignments for users and maintainers choosing, configuring, or debugging default conversation, background-tool, image-generation, and speech-recognition models."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-default-model

English | [中文](README.zh.md)

## Summary

`dsh-agent-default-model` supplies the deployment's default conversation model and process-wide assignments for background tools, image generation, and speech recognition. Agent entry points apply the default provider, model, and optional reasoning effort when a fresh session has no selection of its own; the tool assignment falls back to that default, while image and speech assignments remain unset until chosen. Direct entry points such as `dsh --profile headless` and Host-backed entry points read `ctx.agentDefaultModel` instead of owning parallel defaults. A mounted settings provider layers the user's choices over the composition entry, and a saved change is visible on the next read. Per-session model selection and execution of capability-specific media requests remain their consumers' responsibility.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package wherever agents are created without an explicit model route or product features need one shared use-case assignment. Entry points consult it instead of re-implementing the default, and capability consumers can read the optional image or speech pair without coupling their transport to the settings UI.

### Configure the default

The composition entry is the base of the default: it requires a provider and model and stays usable without any settings provider.

```yaml
- name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek
    model: deepseek-chat
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | required | Registered provider route for fresh agents |
| `model` | required | Provider-owned model id for fresh agents |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-agent-default-model) is the exhaustive source for every accepted field. `reasoningEffort` is deliberately not a config field: it belongs to the settings layer, so a complete saved selection can clear an effort when the next selected model has none, while a composition value would be inherited again.

### Read and change the default

`currentSelection()` returns a detached `{ provider, model, reasoningEffort? }` for a newly created agent; `currentToolSelection()` returns the explicit tool pair or follows the default without its reasoning effort. `currentImageSelection()` and `currentSpeechSelection()` return their optional provider/model pairs. `saveSelection()` stores the complete conversation selection for later agents and preserves all three use-case assignments.

```text
const selection = ctx.agentDefaultModel.currentSelection()
const image = ctx.agentDefaultModel.currentImageSelection()
const speech = ctx.agentDefaultModel.currentSpeechSelection()
await ctx.agentDefaultModel.saveSelection({ provider, model, reasoningEffort: 'high' })
```

Without a settings provider, `saveSelection()` is a no-op and the composition entry remains current. The service validates that each optional use-case assignment has both provider and model, but it does not validate catalog membership or execute any request. A capability consumer owns availability diagnostics and the provider-specific request format.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the service realizes the behavior above; the observable contract is covered in [Use this package](#use-this-package).

### Design concept

The service is a composition entry with a settings-backed source. The plugin config supplies the base `{ provider, model }`; when a settings provider is mounted, the `agent-default-model` settings section becomes the live source and every consumer reads through the relevant selection method, so a settings write needs no registration-level rebuild. Optional tool, image, and speech fields are validated as provider/model pairs. `reasoningEffort` lives only in the conversation settings — the config cannot carry it, because an effort cleared by a new selection must stay cleared rather than being re-inherited from composition.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `AgentDefaultModelConfig` service, settings section install, use-case reads, and default-selection save |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion |

### Behavior notes

Selection methods are thin reads over that source and return fresh detached objects so callers can hold them without aliasing service state. `saveSelection()` writes the complete conversation selection through `ctx.settings` when present and carries forward the optional use-case pairs.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The package-level contract is enough for most consumers; read these when you need the surrounding domain.

- [Core subsystem](../../../docs/subsystems/core.md) — the `Agent` handle and `AgentOptions` route selection.
- [agent-loop package](../agent-loop/README.md) — how agents resolve provider and model at request time.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-agent-default-model) — every accepted config field and its source declaration.
- [Core group map](../README.md) — how the core packages compose.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `ModelSelection` the service supplies to an entry point; request assembly and the provider adapters own the model-visible request.

#### KV Cache effect

Changing the default affects only agents that subsequently resolve from it. An existing session whose request log already names a selection keeps that selection, so this service does not invalidate its established prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the service's scope. They are current package constraints, not a task backlog.

- **One process-wide default** — the service owns a single default; per-session model selection remains the entry point's responsibility.
- **Assignments do not implement media transports** — image and speech consumers must read the selected pair and execute that provider's capability-specific request format.
- **No retention without a settings provider** — `saveSelection()` cannot keep a selection for a later agent when no settings provider is mounted.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
