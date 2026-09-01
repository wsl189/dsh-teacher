---
description: "Provider-neutral speech-transcription runtime and Typert Remote for turning completed browser recordings into transient editable text."
kind: "package-reference"
---

# @deepseek-ai/dsh-speech

English | [中文](README.zh.md)

## Summary

Provider-neutral speech-transcription runtime and Typert Remote. `ctx.speech.registerProvider()` owns provider lifetimes, while `provider` configuration selects one id explicitly. With no explicit id, exactly one provider must report itself available. Browser calls return a frozen discriminated result; provider exceptions are reduced to stable codes without exposing credentials, audio, or upstream response bodies.

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

Mount this Service Definition with one or more transcription providers. `speech.transcribe` carries a browser media type and canonical base64 bytes; same-process Consumers may use `transcribeAbortable` to forward cancellation. Providers validate transport fields and return one non-empty transcript plus their stable id.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Provider selection occurs for each recording, and expected request or provider failures are returned as stable discriminated data. The runtime retains neither audio nor text; browser Consumers own the draft lifecycle. Exact request and result declarations live in [`src/types.ts`](src/types.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Speech subsystem reference](../../../docs/subsystems/speech.md) — shared request, result, failure, provider, and generated Cordis service vocabulary.
- [Models-settings provider](../speech-model-settings/README.md) — shipped supplier speech adapters.
- [Conversation UI](../../client/ui-conversation/README.md) — microphone entry and editable draft Consumer.

<a id="model-experience"></a>
## Model Experience

None, as browser transcription results remain user-owned draft text and this package registers no model surface.

#### KV Cache effect

None until a user submits the edited draft through an ordinary message path.

## Known Limitations and Deferred Work

- **Completed recordings only** — the Remote does not stream partial transcripts or audio chunks.
- **One selected provider** — automatic selection rejects zero or multiple available providers instead of applying an implicit priority.
- **No durable audio** — this capability does not persist recordings or transcripts; each Consumer owns its draft lifecycle.

<a id="dev-note"></a>
### Dev Note

Keep recordings and transcripts transient here; durability begins only in the Consumer that accepts an edited draft.
