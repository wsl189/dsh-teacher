# Agent Note: Remove maintenance actions from default Web chrome

Status: implemented

English | [中文](2026-09-01-remove-maintenance-actions-from-default-web-chrome.zh.md)

## Problem

The Session Header permanently displayed a Session-log download control, and the Settings header displayed a native configuration-file action whenever the local Host reported a file-backed provider. Both actions serve maintenance workflows, but they occupied high-frequency product chrome beside ordinary session and settings controls. The settings action also started a privileged capability read solely to decide whether to display itself.

## Decision

The default Web composition renders neither maintenance action. `session-log-export` keeps the `/export` human command, authenticated ZIP route, browser download controller, and Session-scoped result dialog; its Client contribution mounts the dialog without a Header button. Advanced users can type `/export`, while the command lifecycle remains outside model history.

`ui-settings-general` continues to declare and render the generic `settings.action` list slot but registers no configuration-document entry. Its dedicated action component, availability store, locale copy, styles, Client dependencies, and availability read are absent. The Host-owned `settings/openSettingsDocument` operation and settings-provider document metadata remain available to other trusted clients, and normal product configuration stays in the feature-owned Settings forms.

## Alternatives considered

**Delete Session export with its button.** Rejected because the byte-faithful ZIP is still useful for support and debugging; `/export` keeps that capability without permanent Header chrome.

**Move the two actions into overflow menus.** Rejected because that retains maintenance choices in routine product navigation and adds another menu hierarchy instead of removing the requested entries.

**Hide the existing components with CSS.** Rejected because hidden live controls would keep unused code, locale copy, privileged reads, focus behavior, and test obligations.

**Delete the generic settings action slot and Host document operation.** Rejected because the requested simplification concerns the default product entry. The slot remains a valid composition point, and the Host operation keeps filesystem target resolution on the trusted side for a future explicit client.

## Consequences

The Session Header contains lineage and active product controls without a persistent log-download capsule. The Settings header contains contributed actions only when another plugin deliberately registers one. The default browser no longer probes document availability or offers a native editor handoff. Session export remains available through `/export`, and its preparation, success, and failure states still use one modal per Session.

Component tests pin the empty default settings-action slot and the command-only export contribution. Browser scenarios pin both controls as absent, exercise `/export` against the real streamed ZIP route, and record the resulting Header and Settings accessibility trees.
