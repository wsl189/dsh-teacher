# `@deepseek-ai/dsh-client-ui-desktop-update`

English | [中文](README.zh.md)

Desktop-only browser plugin for the sidebar's `sidebar.update` seat. The plugin registers its occupant only when the context-isolated Electron preload exposes `window.dshDesktopUpdate`; an ordinary browser keeps the seat empty. The preload's synchronous snapshot plus numeric subscription API is wrapped as a `HostObservable`, so the slot renderer binds the source into `useUpdate` and the component owns no subscription machinery.

Checking and up-to-date states render nothing. An available GitHub Release renders “Update” to the right of Settings, download progress replaces the label, a completed download renders “Restart to update”, and a failed download remains visible as “Retry update”. The collapsed sidebar uses the same action as an icon-only 36px rail control. Download and install requests return through the preload bridge; the Electron main process owns provider access, file verification, backend shutdown, and installer restart.

The renderer validates every copied state before publication. It receives no Electron object, filesystem capability, token, or arbitrary IPC channel; `contextIsolation`, the preload allowlist, and the main-process state machine remain the desktop security boundary.

## Model Experience

None, as this package renders local application-update state and never changes a model request.

#### KV Cache effect

None; update metadata and actions stay outside sessions and provider requests.

## Known Limitations and Deferred Work

- **The control requires the packaged Electron preload** — source and ordinary Web launches intentionally show no update action, and an installed app needs network access to the configured public GitHub Releases feed.
- **Checks run at desktop startup** — a Release published after the process starts appears on the next launch; there is no periodic background poll.
