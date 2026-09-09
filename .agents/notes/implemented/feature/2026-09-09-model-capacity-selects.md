# Agent Note: model capacity choices and request budgets

Status: implemented

English | [中文](2026-09-09-model-capacity-selects.zh.md)

## Problem

Free-form context and output fields require users to type token counts and can leave unfinished text in model drafts. A successful short connectivity check does not establish that a configured output ceiling reached the provider, because that check uses its own small cap.

## Decision

The native DeepSeek and generic model editors share one capacity selector. Context choices span 32K to 1M; output choices span 8K to 64K. Counts retain the editor's decimal K/M convention. Selecting the model default removes the override. Existing catalog or saved counts outside the choices remain explicit current-value options; opening a row or renaming a model never rounds them.

Context remains adapter metadata consumed by history compaction. Output remains a per-model request default, with explicit caller budgets taking precedence. Choosing a larger context does not increase upstream capacity, and remaining-context restrictions can reduce the transmitted output ceiling. The [adapter-owned defaults decision](../architecture/2026-07-30-adapter-owned-max-token-defaults.md) continues to own those semantics.

This changes the capacity controls in the [provider-declaration decision](../architecture/2026-08-04-declaring-a-provider-from-the-models-page.md); model discovery, field preservation, and settings ownership remain there.

## Alternatives considered

- Rounding existing values into the closest choice changes provider metadata during unrelated edits.
- Removing the default choice turns optional overrides into mandatory configuration.
- Treating a 16-token connectivity probe as output-budget verification hides unsupported configured limits.

## Consequences

Browser coverage saves and reopens the selectors through the shipped composition. Protocol cases save all offered budgets for every preset and inspect real serialized HTTP requests with local upstream replies. Optional live cases use an explicitly named harness home for credentials, write only an isolated test home, and send short replies with the selected output ceilings. Missing credentials skip those cases; an upstream refusal fails them. Short requests verify request acceptance and local context resolution, not the ability to fill an entire context window or generate the maximum output length.
