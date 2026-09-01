# Agent Note: GUI Full access risk confirmation

Status: implemented

English | [中文](2026-07-31-gui-full-access-confirmation.zh.md)

## Problem

Switching the web client to `danger-full-access` was a single click on a permission picker, with the preset shown as the title-cased machine name `Danger Full Access`. Full access reduces confirmation steps and lets the agent run sensitive operations, modify files, or execute external commands, so an accidental pick armed the most dangerous preset with no deliberate acknowledgement step.

## Decision

**Every GUI permission picker gates `danger-full-access` behind the shared in-page `RiskConfirmation` dialog by default; the enabling action stays disabled until an explicit acknowledgement checkbox is checked, and an optional lower-left “Don't remind me again” choice suppresses later GUI gates only after the user confirms the switch. The preset renders under the product label `Full access`; every dismissal path submits and persists nothing.**

- `RiskConfirmation` (ui-primitives) is a controlled Modal composition: title, description, acknowledgement checkbox, optional suppression checkbox, cancel, and a confirm button disabled until `acknowledged`. It stays an in-page dialog — the Modal portals to this document's body and never opens a native or separate browser window that could land on another display. `Modal` exposes a `contentClassName` seat so the warning body scrolls inside constrained mobile or landscape viewports while the action row stays fixed. The suppression checkbox is presentation state only; the owning surface decides whether the confirmed choice can be persisted.
- The host-owned `permission` settings namespace carries `confirmFullAccess`, defaulting to `true`, beside `defaultPreset`. All three GUI entry points read this one preference. A successful suppression write stores `false`; settings-unavailable surfaces omit the option rather than promising persistence.
- The composer chip (`PermissionSelect`, ui-conversation) intercepts a Full access pick before the `/permission` submit while confirmation is enabled. Confirm submits `/permission danger-full-access` through the same injected `command` path as every other pick; when suppression is checked, the preference write precedes that command. Cancel, Escape, close, mask dismissal, session lock, and task switches reset the local checkboxes without changing the preference or current preset. Copy rides the standard `conversation` locale seat as `access.confirm.*` keys.
- The `/permission` popup (ui-permission over the ui-commands shell) gates through data, not a second dialog implementation: `SelectOption` carries an optional `confirmation` payload, the popup controller owns the pending checkbox state, and `PopupSelectView` swaps the picker card for the same `RiskConfirmation`. The controller invokes an optional business-owned suppression callback only from the acknowledged confirm path, before settling the selected option.
- The General-settings Permission row uses the same controlled `RiskConfirmation` before persisting Full access as the default for later sessions. Confirming with suppression atomically writes `defaultPreset: danger-full-access` and `confirmFullAccess: false`; cancel, Escape, close, and mask dismissal write neither field.
- `Full access` intentionally overrides the kebab-to-title display transform in every picker; command and Settings writes keep the machine name on the wire, and each warning body remains locale-aware in Chinese and English. Direct argued commands remain outside the browser picker gate.

## Alternatives considered

**A native/OS or separate-window confirmation.** Rejected: the dialog must stay inside the current WebUI window; a second window can appear on another display and detaches the decision from the page state it guards.

**One shared locale namespace for every surface's safety copy.** Rejected: the ui-permission bundle and ui-conversation load independently, while the Settings warning names a different future-session lifetime. Each bundle owns its copy, and ui-permission keeps the popup and Settings dictionaries separate rather than importing across bundle boundaries.

**Gating in the host/permission backend.** Out of scope by design: the change is browser-client confirmation flow only; backend permission semantics, defaults, and the safer presets' one-click behavior are unchanged.

## Consequences

Fresh settings require a deliberate, informed acknowledgement on every visible GUI path into Full access. A user can deliberately suppress later prompts across the composer picker, `/permission` popup, and General-settings row without weakening the host permission write path or changing direct command behavior. A failed or unavailable preference write leaves confirmation enabled for the next choice. Acceptance covers the composer flow in `input-bar.client.spec.tsx`, the popup shell in `popup-view.client.spec.tsx` and `popup.client.spec.ts`, the default-setting flow in `permission-presets-row.client.spec.tsx` and `settings-store.client.spec.ts`, the browser decoration in `browser-plugin.client.spec.ts`, and the assembled Web replays in `access-confirmation.e2e.ts` and `settings-chrome.e2e.ts`.
