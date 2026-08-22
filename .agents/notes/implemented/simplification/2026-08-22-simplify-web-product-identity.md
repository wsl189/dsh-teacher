# Agent Note: Simplify Web product identity

Status: implemented

English | [中文](2026-08-22-simplify-web-product-identity.zh.md)

## Problem

The Web client presents three release-lifecycle qualifiers as permanent product chrome: the sidebar fallback says `DSH Local Build`, every empty session carries a localized Preview badge, and first launch blocks on a versioned internal-testing statement before provider setup. The badge was introduced so every pre-release deployment disclosed the same lifecycle state, and the acknowledgement field allowed revised notice copy to return, but neither item enables a product capability. The mandatory statement adds startup friction, while the earlier telemetry-oriented beta notice remains inappropriate because session telemetry is disabled unless a deployment explicitly enables it.

## Decision

The expanded sidebar fallback wordmark is `DSH`; the optional build revision badge remains beside it. The empty-session hero keeps its fish mark and localized headline but has no lifecycle badge, locale key, or badge styling.

The assembled product registers no internal-testing notice. `ui-settings-models` retains only the conditional DeepSeek credential onboarding step. The notice component, copy, acknowledgement store, focused tests, remote-browser scenario, and version golden are absent.

The acknowledgement mechanism is removed with the notice. `ui-settings-general` has no Host-side settings registration, `ui-onboarding.welcomeNoticeVersion` is not exposed or accepted as a product preference, and the Web test scaffold does not pre-acknowledge startup. This pre-release repository does not preserve the unused settings section as a compatibility shim.

The reusable `settings.onboarding` coordinator and modal remain because provider onboarding still uses them. Reintroducing a product lifecycle disclosure requires a new product decision, visible behavior coverage, and a completion mechanism justified by the new content; the removed acknowledgement field is not reserved for reuse.

## Alternatives considered

**Keep the badge but make it configurable.** Rejected because release identity is not a deployment tunable, and the requested product identity does not include a preview qualifier.

**Reword the internal-testing statement.** Rejected because the blocking step itself is the friction and no mandatory proposition remains after the lifecycle warning is removed.

**Stop registering the notice but retain its code and settings field.** Rejected because inactive components, persistence schema, test knobs, and compatibility handling would leave an unsupported feature available for accidental reintroduction.

**Retain `ui-onboarding` so older settings documents continue to load.** Rejected because the repository has no pre-release format-compatibility promise; accepting an ownerless namespace would preserve dead state indefinitely.

## Consequences

New sessions expose the DSH name and headline without preview or internal-test framing. Users with no usable provider still receive the API-key setup dialog, while other users enter the app without a lifecycle acknowledgement step. The product gives up automatic preview disclosure and version-triggered re-acknowledgement; any future disclosure must establish a current need rather than reviving the deleted mechanism.

## Testing

Sidebar and conversation component tests pin the fallback wordmark and badge-free hero. The assembled first-run browser scenario begins at the DeepSeek credential dialog and retains the write-only secret, configured-reload, and no-empty-takeover checks. Repository searches and fixture inventory checks pin the absence of the removed notice copy and golden.
