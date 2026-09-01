# Agent Note: Final image-generation result node

Status: implemented

English | [中文](2026-09-01-final-image-generation-result-node.zh.md)

## Problem

The bundled image-generation Client renders generated images inside its Tool view. Compact transcripts fold that view into the Turn process, so the final conversation can retain only the Assistant's short completion text even though the durable Tool result still references the generated artifact. Moving the preview must preserve the provider's image-studio dispatch and must not copy presentation-only references into model-visible messages.

## Decision

`@deepseek-ai/dsh-client-ui-image-generation` owns a separate `image-generation-result` Chat node in the shipped Web composition. One Conversation Context per Turn starts at `turn/start`, accepts only recognized `generate_image`, `edit_image`, and `get_image_generation_task` calls, correlates their append-origin Tool results by call id, validates `meta.images`, and deduplicates attachments in first-seen order. An update-only history window remains pending until pagination supplies that start event.

Each accepted image result clears the previous answer anchor. A later append-origin Assistant message becomes the node's answer anchor; Turn end is the closed-Turn fallback, and the latest result sequence is the live fallback. The answer anchor equals the Assistant sequence, so stable Chat ordering places the independent image node after the answer and before the synthetic Turn tail. Compact process membership excludes nodes at or beyond the answer boundary.

The renderer reads bytes through the bundled provider's loopback-only `/api/dsh-imagegen/agent-image` route and uses the `conversation` image dictionary. The provider's Tool view remains registered because it owns image-studio dispatch and provider actions. This package changes Client presentation only: it adds no Session event, surface content, attachment authorization, prompt, Tool schema, or model request.

The [bundled extensions decision](./2026-08-25-bundled-extensions-and-qq-speech.md) continues to own provider packaging and runtime responsibilities. The [Conversation assembly decision](../architecture/2026-08-09-client-conversation-node-assembly.md) continues to own Definition lifecycle, ordering, and keyed rendering. Neither record is superseded by this presentation adapter.

## Alternatives considered

**Patch the bundled provider Client to replace its Tool view with the independent node.** Rejected because the Tool view also dispatches generated images to the studio. A repack would combine provider maintenance with application transcript policy and would make an expanded process lose its existing actions.

**Teach `ui-chat` or `ui-tool` to promote any Tool result carrying images.** Rejected because `meta.images` is provider presentation vocabulary, not a generic Session event contract. The core feature packages must not infer a business node from one vendor's metadata.

**Append generated references to the final Assistant message or a new Session event.** Rejected because the image already has a durable Tool result owner. Copying it into the model surface changes replay and provider context, while a presentation-only Session event duplicates an existing durable fact.

## Consequences

The compact transcript retains generated images beside the final answer without changing the provider or model transcript. The same Turn contributes one stable node even when task polling repeats an attachment, and a later result moves the anchor only after a later Assistant message arrives.

The DSH Client adapter depends on the bundled provider's three Tool names, snake-case `meta.images` fields, and loopback image route. A provider change fails visibly as an absent node or retry card and requires a coordinated adapter update. Expanded process mode can show both the provider Tool preview and the final-answer preview; that duplication preserves studio dispatch and provider-owned controls.
