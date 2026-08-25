# @deepseek-ai/dsh-speech-qq

English | [中文](README.zh.md)

This plugin registers provider id `qq-config` on `ctx.speech`. It reads the same `integrations/dsh-qq/config.json` document and `DSH_QQ_ASR_API_KEY` credential reference that `@xmanrui/dsh-im` owns. Both are resolved again for every recording, so the next composer or Workbench recording uses saved QQ settings without a Host restart.

The provider accepts WebM, Ogg, M4A, MP3, and WAV, enforces canonical base64 and decoded-size limits before network I/O, then sends an OpenAI-compatible multipart request to `<baseUrl>/audio/transcriptions`. It includes `file`, `model`, `language`, and `response_format=json`; Authorization is omitted when the QQ key is blank. Successful `text` or `transcript` fields are trimmed before return.

## Configuration

| Field | Shipped value | Meaning |
|---|---:|---|
| `configPath` | `<DSH_HOME>/integrations/dsh-qq/config.json` | Absolute dsh-im QQ settings document. |
| `credentialRef` | `DSH_QQ_ASR_API_KEY` | Credential reference written by the QQ settings UI. |
| `timeoutMs` | `120000` | Complete upstream request deadline. |
| `maxAudioBytes` | `20971520` | Maximum decoded recording size. |
| `maxResponseBytes` | `65536` | Maximum accepted JSON response bytes. |

The QQ settings document must have `version: 1` and a `speech` object containing `enabled`, `baseUrl`, `model`, and `language`. Base URLs must use HTTPS, except that loopback HTTP is accepted for a local service; embedded credentials, query strings, fragments, and redirects are rejected.

## Model Experience

None, as the QQ-configured backend returns text only to browser Consumers and registers no model surface.

#### KV Cache effect

None until a user submits the edited transcript through an ordinary message path.

## Known Limitations and Deferred Work

- **The ASR server is external** — the executable includes this adapter, not Whisper, model weights, GPU drivers, or a service process.
- **No streaming transcript** — one upstream request begins only after the browser stops recording.
- **QQ owns configuration** — without a valid enabled dsh-im QQ document the provider returns `provider-disabled`; there is intentionally no second speech settings page.
