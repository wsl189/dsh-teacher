# @deepseek-ai/dsh-speech

English | [中文](README.zh.md)

Provider-neutral speech-transcription runtime and Typert Remote. `ctx.speech.registerProvider()` owns provider lifetimes, while `provider` configuration selects one id explicitly. With no explicit id, exactly one provider must report itself available. Browser calls return a frozen discriminated result; provider exceptions are reduced to stable codes without exposing credentials, audio, or upstream response bodies.

`speech.transcribe` carries a browser media type and canonical base64 bytes. Same-process Consumers may use `transcribeAbortable` to forward cancellation. Providers validate transport fields and return one non-empty transcript plus their stable id.

## Model Experience

None, as browser transcription results remain user-owned draft text and this package registers no model surface.

#### KV Cache effect

None until a user submits the edited draft through an ordinary message path.

## Known Limitations and Deferred Work

- **Completed recordings only** — the Remote does not stream partial transcripts or audio chunks.
- **One selected provider** — automatic selection rejects zero or multiple available providers instead of applying an implicit priority.
- **No durable audio** — this capability does not persist recordings or transcripts; each Consumer owns its draft lifecycle.
