# speech/ - browser speech transcription

English | [中文](README.zh.md)

This capability family accepts browser microphone recordings and returns normalized text without binding a UI Consumer to one transcription service.

| Package | Role | `ctx` key |
|---|---|---|
| [`speech/`](speech/README.md) | Provider registry, selection, stable failures, and browser Remote | `ctx.speech` |
| [`speech-qq/`](speech-qq/README.md) | OpenAI-compatible provider that shares dsh-im's live QQ ASR settings | registers on `ctx.speech` |

The shipped Web composition selects `qq-config`. The conversation composer and Teacher Workbench record with `MediaRecorder`, normalize supported browser containers to 16 kHz mono PCM WAV through Web Audio, send one completed recording through the generated Remote, and insert the returned text into their ordinary editable draft fields. This matches the QQ bot's WAV transport and avoids requiring a local OpenAI-compatible endpoint to decode Chromium WebM.
