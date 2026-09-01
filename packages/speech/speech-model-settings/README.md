---
description: "Speech provider that executes the supplier route and speech model selected under Models settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-speech-model-settings

English | [中文](README.zh.md)

## Summary

This plugin registers provider id `model-settings` on `ctx.speech`. For every recording it reads the current **Settings → Models → Use cases → Speech recognition** assignment, resolves the exact endpoint and protocol from `model-service-settings`, reads that provider's credential, and calls the selected speech model. Conversation, Teacher Workbench, and QQ voice messages therefore share one model choice and one provider route.

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

Mount this provider with `dsh-speech`, `agent-default-model`, `model-service-settings`, settings, and credentials. The shipped adapters support OpenAI-compatible multipart transcription routes and Qwen-compatible `input_audio` message routes, including the supplied Zhipu `glm-asr-2512` and Qwen `qwen3-asr-flash` defaults. It accepts WebM, Ogg, M4A, MP3, and WAV, then validates canonical base64 and the decoded-size limit before network I/O.

### Configuration

| Field | Shipped value | Meaning |
|---|---:|---|
| `timeoutMs` | `120000` | Complete upstream request deadline. |
| `maxAudioBytes` | `26214400` | Deployment-wide decoded recording limit before a lower model-specific limit. |
| `maxResponseBytes` | `65536` | Maximum accepted JSON response bytes. |

Operation endpoints and model ids belong to `model-service-settings`, not this plugin's tunables. The selected provider profile's `apiKeyEnv`, a matching `llm-pi-ai` profile reference, or the route-derived credential reference supplies the bearer token.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each request reloads the speech assignment, typed provider route, and credential, so saved changes affect the next recording without a Host restart. Dispatch follows the stored protocol adapter instead of a hardcoded provider/model list. OpenAI-compatible transcription routes receive multipart `file`, `model`, and `stream=false` fields; Qwen-compatible routes receive one `input_audio` data URL in a chat request. Successful text is trimmed before return, and upstream bodies never enter user-facing diagnostics.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Speech runtime](../speech/README.md) — provider selection and stable result ownership.
- [Speech subsystem](../../../docs/subsystems/speech.md) — shared transcription types and Cordis service reference.
- [Supplier-grouped model settings](../../../.agents/notes/implemented/architecture/2026-09-01-supplier-grouped-model-settings.md) — route, model-assignment, and credential ownership.

<a id="model-experience"></a>
## Model Experience

None, as transcripts return only to UI or IM Consumers and this package registers no model-visible surface.

#### KV Cache effect

None until a user or IM workflow submits the resulting text through an ordinary message path.

## Known Limitations and Deferred Work

- **Maintained adapters are explicit** — a custom URL works only with an installed speech request and response adapter; changing the URL does not make an unrelated provider protocol compatible.
- **No streaming transcript** — one upstream request begins only after recording completes.
- **External services** — the executable includes request adapters, not speech models, model weights, GPU drivers, or provider services.
- **Image generation remains separate** — image generation has a different capability owner and request format; this package does not execute image models.

<a id="dev-note"></a>
### Dev Note

Add a speech protocol only with its request encoding, response parser, resource limit, and focused tests. Keep provider URLs and model ids in `model-service-settings`.
