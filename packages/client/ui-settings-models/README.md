---
description: "Models settings and product-onboarding plugin for the dsh web client: direct use-case assignments, supplier-grouped access routes, API-key management, capability catalogs, and the DeepSeek first-run dialogs."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-models

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-models` is the Models settings page of the dsh web client. **Use cases** presents one direct selector each for the default conversation, background tools, image generation, and speech recognition; every choice comes from a configured route that advertises the required operation, and the panel contains no provider-specific controls. **Service access** groups the official presets for Zhipu, Kimi, DeepSeek, Alibaba Model Studio/Qwen, and MiniMax by supplier while keeping Standard API, Coding Plan, and Token Plan routes independently authenticated and configured; plugin-owned image and speech access cards also render only in this panel. Users can add installed catalog providers or hand-declare custom pi-ai routes. The page joins the provider directory, settings document, and credential descriptions into one shared snapshot, and it walks first-run users through a versioned internal-testing notice and the conditional official-DeepSeek credential step.

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

Open Models from the Settings navigation. Use **Service access** to select a supplier and one of its access methods, then configure that route. The supplier grouping is presentational: Standard API, Coding Plan, and Token Plan keep separate settings paths, credentials, protocols, endpoints, and model catalogs. An expanded provider editor keeps a bounded height and scrolls its own contents, so a large model catalog does not move the Settings frame or supplier controls. Use **Use cases** after at least one route is usable to assign its models to conversation, background-tool, image-generation, and speech-recognition work. Image and speech selectors list only configured product presets with an official capability route; adapter-specific configuration that the common assignment cannot express stays in **Service access**. A whole-section provider whose key is not configured anywhere still renders as its open setup card in the first-run posture until the user closes it.

### API keys

Each access-route editor places **API protocol** and a single **API key** input in the same credential section; protocol is route-level, not a per-model override. A typed key stores write-only through `credentials.set` under the profile's reference, deriving `<ROUTE>_API_KEY` when the profile has none, and the pi-ai profile records that derivation as `apiKeyEnv`, so `settings.yaml` never carries a key value. Subscription-plan keys remain isolated from standard API keys even when the supplier uses the same hostname. Leaving a new pi-ai provider's key blank saves a reference-free profile and preserves provider-native authentication. A row labels confirmed configured and confirmed missing credentials with accessible status dots, and a successful Apply never echoes secret material.

### Editing a provider

Product presets expose the request route and model catalog directly. Selecting a supported LLM protocol applies its official base URL and previews the complete request URL; conversation, image-input, and coding LLMs share that route. Selecting Image generation or Speech recognition previews the operation's separate official URL and product-owned model catalog without treating that endpoint as an LLM protocol override. Each LLM model separately declares text-only or text-and-image input. Changing that capability moves the row to the matching conversation or vision catalog while keeping an incomplete draft reachable. The preset editor, **Add provider** form, and **Add a custom provider** form all use this transition; routes without a vision catalog keep image input unavailable. Generic providers keep these fields under **Model catalog and advanced settings**, and a hand-declared route can also edit its display name. Provider ID stays fixed because settings, logged sessions, and the credential reference identify the route by that value. Existing fields outside the curated set survive edits.

### Adding and deleting providers

The domestic supplier workspace owns the product presets, including complete seeds for supported routes absent from the installed pi-ai catalog. **Add provider** still adopts any remaining installed catalog route, and **Add a custom provider** declares a route pi-ai does not ship; the create card asks for a unique Provider ID, endpoint, protocol, and at least one model because nothing can default them. **Fetch available models** asks `llm/discoverModels` about the endpoint shown by the form and opens a picker without writing until **Add selected**. A route is deletable only when the user layer carries it, and its confirmation dialog identifies the route and whether this page also owns its credential.

### First-run dialogs

After the versioned notice step completes, the DeepSeek step projects first-run readiness from the same joined snapshot. ANY provider the user can already reach ends it without rendering; only a user with none is asked for the official DeepSeek key. Configure later completes only this coordinator pass, and an absent adapter, inactive route, failed join, read-only deployment, or unusable capability completes the step without rendering — Models remains the diagnostic surface.

### Extension slots

The section declares three seats for plugins distributed outside this repository, typed in [`src/client/slot-contract.ts`](src/client/slot-contract.ts) and exported from `./client`. `settings.models.specialized-model` (list) renders after the generic provider workspace in **Service access** for product-owned configuration that does not belong to a generic LLM provider row. `settings.models.provider-card` (keyed) renders inside every service-access card that shows a directory row and dispatches with `entryKey = settingsNs` plus the row's `ConfigurableProviderView`, configured state, and confirmed API-key state. `settings.models.footer` (list) renders after both service-access areas. A registrant activates through `ctx.slots.inject` with a type-only import of this package's `/client` entry; without registrants all three seats render nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page never holds a full settings section: it holds only the REDACTED descriptor, so every edit lands as `settings.mutate` path ops against the stored section — paired provider/model sets for a use-case assignment, a set per changed provider field, an unset per cleared one, and a single unset for a deleted provider row.

### Validation

A typed API key is judged on its own field: after trimming, it must be non-empty and every character must be printable ASCII (`[\x21-\x7E]`), which is exactly what an HTTP header value can carry — the twin of `normalizeApiKey` in `@deepseek-ai/dsh-llm`, mirrored here because the source-plane split forbids importing it. A value matching a pasted `NAME=value` environment line or wrapped in matching quotes is refused as the same format failure. Empty ids, duplicate ids, empty explicit names, and unreadable, non-positive, or fractional capacities fail before any write. DeepSeek's `models` is one replace-by-value array: the editor shows inherited effective rows until the first model edit materializes the complete array in the user layer, while reset unsets that override.

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
- [Web config plane](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.md) — the hand-written editor's design rationale.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

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

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
