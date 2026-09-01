# Agent Note: supplier-grouped model settings

Status: implemented

English | [中文](2026-09-01-supplier-grouped-model-settings.zh.md)

## Problem

The Models settings page mixed two different jobs in one vertical list: configuring provider connectivity and choosing models for product use cases. Every provider exposed its own card, the add-provider form repeated the same concepts below those cards, and protocol, endpoint, credential, model catalog, and model capabilities did not form a consistent hierarchy. Subscription products made the ambiguity unsafe: a supplier's Standard API, Coding Plan, and Token Plan may use similar model ids or hostnames while requiring different keys, endpoints, protocols, and usage restrictions. Treating the supplier as one configuration would silently pair credentials with the wrong billing route.

## Decision

**Models has separate Use cases and Service access panels.** Use cases consumes only live, configured routes and presents one direct assignment each for default conversation, background tools, image generation, and speech recognition. Service access owns provider configuration. Each expanded inline editor has a bounded height, scrolls internally, and contains overscroll so catalog length does not drive the parent Settings scroller. The separation makes the dependency explicit without copying provider fields into each use case.

**A supplier is presentation; an access method is the configured route.** The product groups Zhipu, Kimi, DeepSeek, Alibaba Model Studio/Qwen, and MiniMax in one supplier rail. Each supplier contains one or more route presets for Standard API, Coding Plan, or Token Plan. Every route retains its existing settings namespace and path, derives its own credential reference, and saves independently. Switching the access-method selector changes the addressed route rather than applying a plan flag to one shared profile. Installed providers outside the five presets and hand-declared pi-ai routes remain available below the workspace.

**Protocol and API key are peers at route level.** A protocol selection applies the official base URL paired with that protocol and access plan, and the editor previews the full request URL after appending the adapter path. Conversation, vision-input, and coding LLM models share that route; the selected LLM model type explains this fact but does not create a per-model protocol override. DeepSeek's native adapter keeps its fixed OpenAI Chat transport even though the public service supports additional protocols, because exposing an unsupported setting would produce a profile the adapter cannot execute. Product-owned preset data is covered by exact endpoint tests so upstream changes are deliberate edits.

**The model catalog records per-model input capability.** Each model row can declare text-only or text-and-image input independently. Product routes absent from the installed pi-ai catalog receive a complete initial profile only when the user saves them; catalog routes continue to inherit adapter-owned model metadata until edited. Protocol changes update the route endpoint, while model type and per-model input capability describe which models may use it.

**Generation and speech stay with their capability owners.** Image generation, video generation, speech recognition, and other non-LLM operations use capability-specific request and response formats. A direct media assignment stores a provider-access id and capability model id in `agent-default-model`; it does not turn that provider's LLM adapter into a media adapter. The selectors list only configured product presets with maintained operation endpoints and model ids. Adapter-owned transport options render only in Service access; Use cases exposes no specialized configuration slot. A capability consumer must explicitly read the assignment and execute its operation format.

## Alternatives considered

- **One credential and profile per supplier with a Coding Plan flag.** Rejected because plan keys are commonly non-interchangeable with standard keys, and a boolean cannot identify several subscription products or their protocol-specific endpoints.
- **A protocol override on each model.** Rejected because protocol, credential, and base URL identify the access route; duplicating them across model rows creates contradictory configurations and repeats secrets.
- **Store image-generation and speech models as ordinary LLM routes.** Rejected because the LLM adapters cannot execute those operation-specific endpoints, leaving attractive but inert configuration.
- **Keep adapter-owned options under More settings in Use cases.** Rejected because a panel that assigns configured routes must not also configure a second provider path for the same operation.
- **Keep one undifferentiated provider list.** Rejected because it obscures the supplier relationship and makes the installed-provider add flow compete visually with first-party routes.

## Consequences

The client owns a maintained preset inventory for the five domestic suppliers. Official LLM and capability endpoints, supported protocols, route isolation, and seeded catalogs are direct test inputs and must be updated when providers change their interfaces. Supplier grouping and access-method selection remain projections over existing provider profiles; `agent-default-model` additionally stores paired image and speech assignments for opt-in capability consumers. The browser lane covers the direct-only Use cases panel, Service access extension placement, bounded editor scrolling, MiniMax route configuration with and without a managed key, protocol and endpoint editing, model discovery, custom-provider creation, and deletion; component tests cover all five supplier inventories, exact complete URLs, plan isolation, all four direct use-case cards, and per-model image input.
