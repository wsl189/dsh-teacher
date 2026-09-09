# Agent Note: curated provider presets and official artwork

Status: implemented

English | [中文](2026-09-09-curated-provider-presets.zh.md)

## Problem

The add directory exposed every installed adapter id beside product presets, including duplicate supplier identities and overseas services without maintained defaults. OpenRouter and OpenCode Go lacked complete request addresses, and saved connections lacked recognizable supplier marks.

## Decision

The add directory contains the five domestic suppliers plus OpenRouter and OpenCode Go, with one custom-service entry. Existing saved routes retain their settings and editing actions. This narrows the directory described by the [automatic connection verification decision](2026-09-09-automatic-model-connection-verification.md) without changing adapter availability.

OpenRouter has four model categories. Conversation and vision share Chat Completions; image generation uses its dedicated Images API; transcription uses its multipart-compatible transcription endpoint. Capability presets store their exact request addresses and supported model ids. The installed image consumer supports text-to-image generation at this address, and the editor states that image editing is unavailable.

OpenCode Go inherits protocol and base URL per model from the installed adapter catalog. A route-wide default would send Messages or Responses models to the wrong endpoint. The editor displays all three official URLs in automatic mode and removes pending LLM URL drafts when protocol selection changes. It offers only conversation and vision because the official Go directory publishes no image-generation or transcription routes.

Official logos are bundled as data URLs beside their source attribution, so settings do not depend on remote images. Preset ids determine supplier identity; recognized custom ids or exact display names also resolve artwork, including Ollama. Unknown services receive a neutral initial rather than an unrelated brand mark.

## Sources

- [OpenRouter image understanding](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding), [image generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), and [transcription API and multipart compatibility](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/) were checked on 2026-09-09.
- [OpenCode Go endpoints](https://opencode.ai/docs/go/#endpoints) and the installed pi-ai provider catalog establish the model-specific protocol defaults.
- [OpenRouter official artwork](https://github.com/OpenRouterTeam/sign-in-with-openrouter) supplies its current mark under MIT; other logos come from the providers' official site icons. Exact asset URLs accompany the bundled source.

## Alternatives considered

- Keeping the raw adapter directory recreates duplicate and unmaintained setup choices.
- Giving every Go model one Chat Completions override discards provider-owned transport metadata.
- Hotlinking logos makes a local configuration screen depend on external availability.

## Consequences

Component and browser cases cover the curated directory, preserved saved routes, complete URLs for every offered category, automatic Go configuration, stale draft removal, media-route persistence, and offline image decoding. Capability consumer tests cover the OpenRouter image and multipart transcription requests with substitute HTTP responses; they do not establish live account access.
