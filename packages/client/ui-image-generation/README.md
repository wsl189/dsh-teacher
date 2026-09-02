---
description: "Final-answer image previews for the dsh Web client: projects bundled image-generation Tool results into independent Conversation nodes while preserving the provider's Tool card and studio integration."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-image-generation

English | [中文](README.zh.md)

## Summary

This package keeps generated images visible and directly usable beside the final answer in the dsh Web conversation. It groups validated image references from the bundled image-generation tools into one independent Chat node per Turn. A click opens an in-page preview with mouse-wheel zoom, while a hover or keyboard focus reveals a save control that hands the loaded image to the system Save As picker. The node stays outside compact process folding, while the existing Tool card continues to feed the image studio.

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

The shipped Web bundle mounts this package with `@dickpy/dsh-imagegen`. A completed `generate_image`, `edit_image`, or `get_image_generation_task` result then contributes its distinct images to the Turn's final-answer area.

### Preview placement

The preview appears after the Assistant message that follows the latest image result and before the Turn footer. During generation it can appear at the latest result position; the next Assistant message moves the same node to the answer boundary. Expanding the process can also reveal the provider-owned Tool preview because this package does not replace it.

### Preview, save, and recovery

Each card loads the immutable image through `/api/dsh-imagegen/agent-image` and revokes its browser object URL when the card leaves the page. Clicking the card opens a viewport preview; a nonzero vertical wheel gesture zooms from 1× to 8×, and the viewport remains scrollable when the enlarged image exceeds it. The card's top-right save control appears on hover or focus, stays visible on coarse-pointer devices, and writes the already loaded Blob through the secure-context system picker. Browsers without that picker use a standard download, cancellation stays silent, and a write failure becomes a localized retryable error. A failed image request becomes a localized retry button while other images in the Turn continue to load independently.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `ConversationNodeDefinition` accumulates recognized image Tool call ids and validates the snake-case references in each append-origin `tool/result.meta.images` value. A result clears any earlier Assistant anchor; only a later `assistant/message` can anchor the node to an answer. Turn end is the fallback when no later answer exists, and the latest result sequence is the live fallback while the Turn remains open.

The keyed `image-generation-result` renderer uses the existing `conversation` image strings and the provider's Host route. Preview zoom and save progress are component-local state; saving reuses the fetched Blob and does not authorize another read. The package does not import another Client feature at runtime, modify Session events, authorize generic attachment reads, suppress the Tool view, or dispatch image-studio state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the conversation engine, Chat target, Tool presentation, and bundled provider.

- [Conversation subsystem](../../../docs/subsystems/conversation.md) — business-owned Definitions and final view nodes.
- [ui-chat](../ui-chat/README.md) — ordering, compact process folding, and the keyed renderer slot.
- [ui-tool](../ui-tool/README.md) — the provider-owned Tool card retained beside this node.
- [Web app bundle](../../bundle/web-app/README.md) — the shipped composition that mounts both plugins.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package only presents existing image-generation result metadata in the browser and registers no model-facing input.

#### KV Cache effect

None; this package neither changes the Session surface nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the provider compatibility and actions of the final-answer preview.

- **The metadata adapter is provider-specific** — only append-origin results correlated with `generate_image`, `edit_image`, or `get_image_generation_task` and valid `meta.images` references produce a node.
- **Historical paging follows Conversation start ownership** — an update-only loaded window remains pending until an older page supplies that Turn's `turn/start` event.
- **The byte reader belongs to the bundled provider** — removing or changing `/api/dsh-imagegen/agent-image` leaves the durable node present but turns each card into its retry state.
- **The final card is not the image studio** — it owns preview zoom and saving only; copy, editing, gallery, and task controls remain in the provider-owned Tool card and studio, so an expanded process can show both previews.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
