---
description: "Typed provider request routes and model directories shared by Models settings and capability-specific consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-service-settings

English | [中文](README.zh.md)

## Summary

This plugin registers the `model-service-settings` namespace. Each provider may expose any of four fixed model types — conversation/reasoning, vision understanding, speech recognition, and image generation — with a complete request URL, an installed protocol adapter, and an editable model directory. Models settings writes the namespace; use-case selectors and runtime Consumers read the same resolved routes.

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

Mount the plugin with a settings provider, then supply composition defaults under `providers` or let the Models page create user overrides. A provider profile owns one credential reference and optional `chat`, `vision`, `speech`, and `image` routes. Every route stores its complete operation URL, protocol adapter id, and one or more model ids; an optional display name changes only presentation.

Complete URLs must use HTTPS, except loopback HTTP for local deployments. Embedded credentials, query strings, and fragments are rejected. Protocols are checked against their model type, so an image-generation serializer cannot be assigned to a speech-recognition route.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package owns the serializable schema and relationship validator. `findModelServiceRoute` resolves an exact provider, model id, and type for capability Consumers; it does not infer an operation endpoint from a supplier base URL or from an LLM protocol. The invariant companion is intentionally empty because namespace validation runs before every settings commit.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Settings package map](../README.md) — settings namespaces and storage roles.
- [Speech model-settings provider](../../speech/speech-model-settings/README.md) — runtime execution of selected speech routes.
- [Supplier-grouped model settings](../../../.agents/notes/implemented/architecture/2026-09-01-supplier-grouped-model-settings.md) — UI and persistence ownership.

<a id="model-experience"></a>
## Model Experience

Indirectly, through capability Consumers, which own whether a selected route contributes model-visible content.

#### KV Cache effect

None directly.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Installed adapters only** — a custom complete URL changes the destination, not the request or response format; its protocol must match an installed adapter.
- **No endpoint discovery** — provider defaults come from composition presets, while custom routes require an explicit complete URL.
- **Credential sharing is provider-scoped** — one provider profile has one credential reference for all typed routes.

<a id="dev-note"></a>
### Dev Note

Add a protocol only with a type assignment, request Consumer, response parser, and focused tests. Keep supplier defaults in composition; do not embed them in the namespace validator.
