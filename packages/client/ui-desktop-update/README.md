---
description: "Desktop update action: the browser surface for checking, downloading, and installing verified Windows releases through the isolated Electron bridge."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-update

English | [中文](README.zh.md)

## Summary

This package fills the sidebar's `sidebar.update` seat when the context-isolated Electron preload exposes `window.dshDesktopUpdate`. It presents the desktop updater's current state without giving browser code Electron objects, filesystem access, credentials, or arbitrary IPC. Ordinary Web launches leave the seat empty.

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

Mount the plugin in the packaged desktop Web composition alongside `ui-sidebar`. Checking and up-to-date states render nothing. A newer GitHub Release renders **Update** beside Settings; download progress replaces the label, completion renders **Restart to update**, and failure remains visible as **Retry update**. The collapsed sidebar presents the same operation as an icon-only rail action.

The browser only requests download or installation through the preload allowlist. The Electron main process owns release access, integrity verification, backend shutdown, and installer restart.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The preload exposes a synchronous snapshot, numeric subscriptions, and two commands. The plugin validates each copied snapshot, wraps the source as a `HostObservable`, and lets the slot renderer bind it through `useUpdate`; component instances own no subscription state. The occupant is registered only while a valid bridge exists, so browser builds and incomplete preload APIs fail closed by leaving the seat empty.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Desktop application](../../../apps/desktop/README.md) — owns the isolated preload, updater controller, backend lifecycle, and packaged installer behavior.
- [ui-sidebar](../ui-sidebar/README.md) — declares the update seat and its expanded and collapsed placements.
- [Windows desktop updates](../../../.agents/notes/implemented/feature/2026-08-25-windows-desktop-updates.md) — records release selection, verification, CI, and installation obligations.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders local application-update state and never changes a model request.

#### KV Cache effect

None; update metadata and actions stay outside sessions and provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Packaged Electron only** — source and ordinary Web launches intentionally show no update action, and the installed app needs network access to its configured public GitHub Releases feed.
- **Startup checks only** — a Release published after the process starts appears on the next launch; the application does not poll periodically in the background.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep protocol validation symmetric across the preload and browser source. New updater commands require an explicit preload allowlist entry and main-process implementation; do not expose a generic IPC sender.

</details>
