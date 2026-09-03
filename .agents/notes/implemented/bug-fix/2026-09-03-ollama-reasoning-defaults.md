# Agent Note: Ollama reasoning defaults make Off a real request state

Status: implemented

English | [中文](2026-09-03-ollama-reasoning-defaults.zh.md)

## Problem

The teacher's strict question-cutting workflow asks the selected model to use the `off` reasoning effort when the user disables thinking. That selection only has an effect when the LLM adapter reports Off as a real model capability and maps it to a value the endpoint accepts. A hand-declared Ollama route normally had neither fact: its model entry omitted `reasoningEfforts`, pi-ai could not infer the Ollama dialect from an arbitrary local or tunneled URL, and the adapter consequently removed the selected effort before dispatch. The resulting request was identical to one that named no effort, so a Qwen thinking model followed its provider default and produced a long reasoning stream even though the cutting surface showed thinking as disabled.

The manual repair was correct but machine-local: add `compat.thinkingFormat: openai`, mark `supportsReasoningEffort: true`, and declare `off: none` on each applicable model in `settings.yaml`. Every new installation and every existing profile missing those hidden fields could repeat the failure. Treating all Ollama models alike would be equally wrong. [Ollama's OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) accepts `reasoning_effort`, while its [thinking capability](https://docs.ollama.com/capabilities/thinking) distinguishes models with a true disable state from GPT-OSS, whose reasoning level can be reduced but not disabled.

## Decision

The exact provider route key `ollama`, when using `openai-completions`, is an explicit opt-in to adapter-owned Ollama defaults. Its materialized models default to `thinkingFormat: openai` and `supportsReasoningEffort: true`, so the documented OpenAI-compatible field is not left to URL detection.

When a model entry omits `reasoningEfforts`, the adapter classifies the final path segment of its case-insensitive Ollama id, before an optional tag:

- Qwen 3 models, excluding embedding and reranker variants, offer `{ off: none, high: high }`.
- DeepSeek R1 and DeepSeek v3.1 models offer `{ off: none, high: high }`.
- GPT-OSS models offer `{ low: low, medium: medium, high: high }` and deliberately do not offer Off.
- Unknown families receive no inferred reasoning capability.

These are defaults, not forced policy. Explicit model values win over route values, route values win over the Ollama defaults, and `reasoningEfforts: false` suppresses the family inference. If the effective OpenAI compatibility explicitly says `supportsReasoningEffort: false`, no implicit effort map is advertised. Route aliases remain generic hand-declared providers and must state their own capabilities; matching an endpoint URL is intentionally insufficient.

This is a narrow exception to [[2026-08-08-pi-ai-per-model-reasoning-declarations]], whose explicit-only behavior remains correct for unknown gateways. It also restores the invariant from [[2026-08-03-pi-ai-declared-provider-catalog]]: an Off control is exposed only when dispatch can produce a request observably different from the provider default.

## Alternatives considered

**Seed the hidden fields into a new installation's settings.** That fixes only profiles created after the installer change, duplicates provider knowledge in user data, and leaves existing installations broken until their files are migrated.

**Query Ollama's `/api/show` while resolving the catalog.** Capability probing can describe more aliases and future families, but catalog resolution is synchronous and currently deterministic. Making it depend on external mutable state requires an asynchronous cache, invalidation, timeout, authentication, and offline behavior. It remains a possible future discovery enhancement rather than a prerequisite for correct known defaults.

**Advertise Off for every Ollama thinking model.** GPT-OSS cannot fully disable reasoning, so this would recreate the original bug under a more convincing label.

**Special-case only the teacher's cutting request.** Forcing a wire field at one caller bypasses the adapter's capability contract, leaves other callers inconsistent, and can send unsupported values to the wrong model family.

## Consequences

An existing profile keyed `ollama` gains working Off behavior after upgrading without adding the previously required `compat` and `reasoningEfforts` fields. A fresh machine still declares its endpoint and model ids, but does not repeat that hidden reasoning configuration. Selecting Off for a recognized toggleable model now dispatches `reasoning_effort: none`; selecting GPT-OSS presents only the levels Ollama can honor.

The convention is intentionally conservative. A provider alias, an unknown family, or a model whose id hides its family still needs an explicit declaration. Future changes in Ollama's capability vocabulary require a code and test update rather than silently changing a stored profile. `tests/catalog.spec.ts` pins family recognition, scope, override precedence, and the GPT-OSS exclusion; `tests/adapter.spec.ts` pins the final OpenAI-compatible request payload without per-model reasoning configuration.
