---
description: "Configure independent model connections, automatically verify saved connections, and assign models to product use cases."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-models

English | [中文](README.zh.md)

## Summary

Models settings lists saved connections together, including official Standard API, Coding Plan, Token Plan, installed catalog routes, and custom providers. Each connection retains its own credentials and request configuration. Saving automatically verifies the connection with one language model; connection summaries show model counts, capabilities, verification results, and assigned use cases. **Use cases** assigns configured models to default conversation, background tools, image generation, and speech recognition.

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

Open Models from Settings. In **Service access**, choose **Add connection**, select a supplier and access plan, and save its configuration. Every plan is a separate connection. Official and custom connections share one list with bounded inline editors. A saved connection exposes **Assign use cases**, which opens the four direct model assignments; saving connectivity does not change an existing assignment. Provider-owned media configuration remains in Service access.

**Tool model** offers only added, usable models whose resolved input capabilities include images. Text-only models and models with unknown capabilities are excluded, regardless of their names. If no vision model is available, the disabled selector directs the user to add one under Service access; a saved selection that no longer qualifies shows the selection prompt. Default conversation keeps the complete usable model catalog.

### Automatic verification

After a successful save, each independent connection uses one configured conversation or vision model for a short `session.checkModel` request. Additional models, names, and model budgets reuse the connection result. Changing the endpoint, protocol, or credential invalidates it; removing the tested model selects another, and late responses cannot verify newer settings. Failure preserves the saved configuration and offers **Retry verification**. Results last for this page-store lifetime; opening settings alone sends no verification requests. **Connection verified** confirms the tested request, not access to every model. Model details show names and types and identify the test model once. Image-generation and speech models require no checks; media-only connections show **Configured**.

### API keys

Each access-route editor places **API protocol** and a single **API key** input in the same credential section; protocol is route-level, not a per-model override. A typed key stores write-only through `credentials.set` under the profile's reference, deriving `<ROUTE>_API_KEY` when the profile has none, and the pi-ai profile records that derivation as `apiKeyEnv`, so `settings.yaml` never carries a key value. Subscription-plan keys remain isolated from standard API keys even when the supplier uses the same hostname. Leaving a new pi-ai provider's key blank saves a reference-free profile and preserves provider-native authentication. A row labels confirmed configured and confirmed missing credentials with accessible status dots, and a successful Apply never echoes secret material.

### Editing a provider

Product presets expose the request route and model catalog directly. Selecting a supported LLM protocol applies its official base URL and previews the complete request URL; conversation, image-input, and coding LLMs share that route. Selecting Image generation or Speech recognition previews the operation's separate official URL and product-owned model catalog without treating that endpoint as an LLM protocol override. Each LLM model separately declares text-only or text-and-image input. Changing that capability moves the row to the matching conversation or vision catalog while keeping an incomplete draft reachable. The preset editor, **Add provider** form, and **Add a custom provider** form all use this transition; routes without a vision catalog keep image input unavailable. Generic providers keep these fields under **Model catalog and advanced settings**, and a hand-declared route can also edit its display name. Provider ID stays fixed because settings, logged sessions, and the credential reference identify the route by that value. Existing fields outside the curated set survive edits.

**Context window** offers 32K, 64K, 128K, 256K, 512K, and 1M; **Max output tokens** offers 8K, 16K, 32K, and 64K. K means 1,000 tokens and M means 1,000,000. **Use model default** removes the override. Existing counts outside these choices remain available as **Current value**, preserving exact provider metadata when other fields change. Context controls the local history-compaction budget; output sets the default request ceiling. Neither increases the provider's actual model limits, and an adapter may reduce output to fit the remaining context.

### Adding and deleting providers

**Add connection** lists only unconfigured presets for Zhipu, Kimi, DeepSeek, Qwen, MiniMax, OpenRouter, and OpenCode Go. Saved catalog connections remain editable; **Custom connection** provides the shared entry for other services. Custom creation requires a unique Provider ID, endpoint, protocol, and at least one model. **Fetch available models** queries `llm/discoverModels` and adopts candidates only after **Add selected**. Deletion is available only for user-owned profiles and identifies the exact connection and managed credential.

OpenRouter supplies official complete URLs for conversation and vision (`/api/v1/chat/completions`), image generation (`/api/v1/images`), and transcription (`/api/v1/audio/transcriptions`). Its image preset supports text-to-image generation; the installed image consumer does not support OpenRouter image editing. OpenCode Go defaults to the installed catalog's per-model protocol and address, displays its Chat Completions, Messages, and Responses endpoints, and offers conversation and vision only. Switching back to automatic protocol clears route overrides and pending conversation/vision URL drafts.

Preset choices and saved connections use bundled official artwork, including Ollama for a recognized custom connection. Unknown custom services receive a neutral initial. The asset source URLs and OpenRouter license accompany the [bundled artwork](src/client/provider-logos.ts); the browser makes no logo requests to provider sites.

### First-run dialogs

After the versioned notice step completes, the DeepSeek step projects first-run readiness from the same joined snapshot. ANY provider the user can already reach ends it without rendering; only a user with none is asked for the official DeepSeek key. Configure later completes only this coordinator pass, and an absent adapter, inactive route, failed join, read-only deployment, or unusable capability completes the step without rendering — Models remains the diagnostic surface.

### Extension slots

The section declares three seats for plugins distributed outside this repository, typed in [`src/client/slot-contract.ts`](src/client/slot-contract.ts) and exported from `./client`. `settings.models.specialized-model` (list) renders after the connection list in **Service access** for product-owned configuration that does not belong to a generic LLM provider row. `settings.models.provider-card` (keyed) renders inside every service-access card that shows a directory row and dispatches with `entryKey = settingsNs` plus the row's `ConfigurableProviderView`, configured state, and confirmed API-key state. `settings.models.footer` (list) renders after both service-access areas. A registrant activates through `ctx.slots.inject` with a type-only import of this package's `/client` entry; without registrants all three seats render nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page never holds a full settings section: it holds only the REDACTED descriptor, so every edit lands as `settings.mutate` path ops against the stored section — paired provider/model sets for a use-case assignment, a set per changed provider field, an unset per cleared one, and a single unset for a deleted provider row.

### Validation

A typed API key is judged on its own field: after trimming, it must be non-empty and every character must be printable ASCII (`[\x21-\x7E]`), which is exactly what an HTTP header value can carry — the twin of `normalizeApiKey` in `@deepseek-ai/dsh-llm`, mirrored here because the source-plane split forbids importing it. A value matching a pasted `NAME=value` environment line or wrapped in matching quotes is refused as the same format failure. Empty ids, duplicate ids, empty explicit names, and imported non-positive or fractional capacities fail before any write. DeepSeek's `models` is one replace-by-value array: the editor shows inherited effective rows until the first model edit materializes the complete array in the user layer, while reset unsets that override.

### Concurrency and credentials

Each settings write carries the card's current `revision`, so a concurrent write from another tab or an external `settings.yaml` edit is refused as `settings-conflict`. After settings commit, the card adopts the returned redacted user subtree and revision before storing the credential, so a failed credential stage retries only that stage. Deletion removes a configured, writable credential only when the profile names the page's derived `<ROUTE>_API_KEY` target, then unsets the profile; both operations are idempotent. Once loaded, the page subscribes to forwarded `settings/document-updated`, `credentials/reference-updated`, and `llm/adapters-updated` owner events, plus local `connection/reset`, so external edits converge without polling.

### Onboarding coordinator

The notice step owns its exact copy in `src/client/locales.ts` and its acknowledgement version in `src/onboarding-copy.ts`; on loopback it compares and writes `ui-onboarding.welcomeNoticeVersion` through the existing settings API, and only an explicit Continue records the current version. A non-loopback browser cannot use that Host-only namespace, so acknowledgement is process-local and the notice returns after reload. The DeepSeek step renders the existing `ProviderEditor` in credential-only mode inside the shared onboarding modal; `credentials.set` stays the only secret write, and no provider settings are changed.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings base, the seams this page joins, and the design rationale.

- [ui-settings](../ui-settings/README.md) — the domain base whose scope and schema services this page builds on.
- [settings](../../settings/README.md) — the durable user-settings seam and its file provider.
- [credentials](../../credentials/README.md) — the credential-reference seam this page writes keys through.
- [llm](../../llm/README.md) — the adapter registry whose providers this page configures.
- [Web config plane](../../../.agents/notes/archived/architecture/2026-07-30-web-config-plane.md) — the hand-written editor's design rationale.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Session Controller, which owns the automatic connection-verification request.

#### KV Cache effect

Verification uses independent diagnostic requests; existing conversation prefixes remain unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the editor's field coverage and the page's reach; they are current package constraints, not a settings roadmap.

- **Only route credentials and the curated request/model fields are editable on the card** — the hand-written editor trades schema-generic field coverage for the product hierarchy. Retry policy, timeouts, DeepSeek model descriptions, and other advanced fields remain in `settings.yaml`; existing model fields the editor does not show are preserved.
- **Credential cleanup is intentionally narrow** — deleting a row removes the configured, writable credential only when its reference is the exact `<ROUTE>_API_KEY` target this page derives. Custom references, environment credentials, and unidentifiable targets are retained because the row cannot prove ownership of them.
- **Only pi-ai routes can be hand-declared** — the custom-provider card writes into `llm-pi-ai`, the one namespace whose profiles describe a whole provider. A `llm-deepseek` route is a composition fact, not something this page can create.
- **Interrogation covers OpenAI-compatible endpoints** — the adapter reads only that model-list response format, so a gateway speaking another protocol reports that it cannot be asked and its models are entered by hand.
- **A media assignment does not make LLM adapters execute media operations** — image and speech consumers must read the corresponding assignment and implement the provider-specific request and response format; adapter-owned transport parameters remain in **Service access**.
- **Undeclared live routes render nowhere** — a route registered without a configurable-provider declaration has no settings address; it stays visible in pickers but not on this page's rows.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published; settings validation owns saved model values and the settings shell owns navigation.

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
