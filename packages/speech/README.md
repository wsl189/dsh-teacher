---
description: "The speech package group: provider-neutral browser transcription and the QQ-configured OpenAI-compatible provider used by conversation and teacher-workbench drafts."
kind: "package-group"
---

# speech/ — browser speech transcription

English | [中文](README.zh.md)

## Summary

This family accepts browser microphone recordings and returns normalized text without binding a UI Consumer to one transcription service. The shipped Web composition selects `qq-config`; conversation and Teacher Workbench Consumers normalize supported recordings to 16 kHz mono PCM WAV and insert the completed transcript into ordinary editable draft fields. Audio and returned text remain transient until the user submits or saves the draft.

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
| [`speech-qq/`](speech-qq/README.md) | OpenAI-compatible provider sharing dsh-im's live QQ ASR settings | registers on `ctx.speech` |

<a id="related-documentation"></a>
## Related documentation

- [Speech subsystem reference](../../docs/subsystems/speech.md) — shared request, result, failure, provider, and generated Cordis service vocabulary.
- [Conversation UI](../client/ui-conversation/README.md) — owns microphone entry and editable chat drafts.
- [Teacher Workbench UI](../client/ui-teacher-workbench/README.md) — owns voice entry for teacher records.

<a id="dev-note"></a>
## Dev Note

None.
