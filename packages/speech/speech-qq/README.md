---
description: "OpenAI-compatible speech provider configured by the Voice model card and backed by dsh-im ASR settings and credentials."
kind: "package-reference"
---

# @deepseek-ai/dsh-speech-qq

English | [中文](README.zh.md)

## Summary

This plugin registers provider id `qq-config` on `ctx.speech`. The **Settings → Models → Voice model** card writes the `integrations/dsh-qq/config.json` document and `DSH_QQ_ASR_API_KEY` credential reference that `@xmanrui/dsh-im` owns. Both are resolved again for every recording, so the next composer or Workbench recording uses saved values without a Host restart.

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

Mount this provider with `dsh-speech` and the dsh-im Voice model settings card. The provider accepts WebM, Ogg, M4A, MP3, and WAV, validates canonical base64 and decoded size before network I/O, and sends one OpenAI-compatible multipart request to `<baseUrl>/audio/transcriptions`.

### Configuration

| Field | Shipped value | Meaning |
|---|---:|---|
| `configPath` | `<DSH_HOME>/integrations/dsh-qq/config.json` | Absolute dsh-im QQ settings document. |
| `credentialRef` | `DSH_QQ_ASR_API_KEY` | Credential reference written by the Voice model card. |
| `timeoutMs` | `120000` | Complete upstream request deadline. |
| `maxAudioBytes` | `20971520` | Maximum decoded recording size. |
| `maxResponseBytes` | `65536` | Maximum accepted JSON response bytes. |

The QQ settings document must have `version: 1` and a `speech` object containing `enabled`, `baseUrl`, `model`, and `language`. Base URLs must use HTTPS, except that loopback HTTP is accepted for a local service; embedded credentials, query strings, fragments, and redirects are rejected.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each request reloads the QQ document and credential reference, validates the endpoint, and submits `file`, `model`, `language`, and `response_format=json`; Authorization is omitted when the key is blank. Successful `text` or `transcript` fields are trimmed before return, and upstream diagnostics never cross the provider result. A transport failure returns `provider-unavailable`; a redirect, non-success HTTP status, or invalid configuration returns `provider-failure`, so browser Consumers distinguish connection failures from requests rejected because of the service URL, model, or API key.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Speech runtime](../speech/README.md) — provider selection and stable result ownership.
- [Speech subsystem](../../../docs/subsystems/speech.md) — shared transcription types and Cordis service reference.
- [Bundled extensions and QQ speech](../../../.agents/notes/implemented/feature/2026-08-25-bundled-extensions-and-qq-speech.md) — shipped integration and configuration ownership.

<a id="model-experience"></a>
## Model Experience

None, as the QQ-configured backend returns text only to browser Consumers and registers no model surface.

#### KV Cache effect

None until a user submits the edited transcript through an ordinary message path.

## Known Limitations and Deferred Work

- **The ASR server is external** — the executable includes this adapter, not Whisper, model weights, GPU drivers, or a service process.
- **Model selection is explicit** — `speech.model` must name a model the configured service can serve; the adapter does not infer or retry another model.
- **No streaming transcript** — one upstream request begins only after the browser stops recording.
- **dsh-im owns configuration** — without a valid enabled dsh-im QQ document the provider returns `provider-disabled`; the Models page only relocates its single settings card.

<a id="dev-note"></a>
### Dev Note

Keep speech configuration persistence in dsh-im; this adapter only validates and consumes its public ASR settings.
