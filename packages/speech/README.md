---
description: "The speech package group: provider-neutral transcription and supplier-model adapters shared by browser and IM Consumers."
kind: "package-group"
---

# speech/ — browser speech transcription

English | [中文](README.zh.md)

## Summary

This family accepts complete browser or IM recordings and returns normalized text without binding a Consumer to one transcription service. The shipped Web composition selects `model-settings`; conversation and Teacher Workbench Consumers normalize supported recordings to 16 kHz mono PCM WAV, while QQ supplies its WAV attachment to the same runtime. All three use the supplier speech model assigned under **Models → Use cases**. Audio and returned text remain transient until a Consumer submits or saves the resulting text.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | `ctx` key |
|---|---|---|
| [`speech/`](speech/README.md) | Provider registry, selection, stable failures, and browser Remote | `ctx.speech` |
| [`speech-model-settings/`](speech-model-settings/README.md) | Executes maintained supplier speech endpoints from the live Models assignment | registers on `ctx.speech` |

<a id="related-documentation"></a>
## Related documentation

- [Speech subsystem reference](../../docs/subsystems/speech.md) — shared request, result, failure, provider, and generated Cordis service vocabulary.
- [Conversation UI](../client/ui-conversation/README.md) — owns microphone entry and editable chat drafts.
- [Teacher Workbench UI](../client/ui-teacher-workbench/README.md) — owns voice entry for teacher records.

<a id="dev-note"></a>
## Dev Note

None.
