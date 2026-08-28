# Agent Note: Windows desktop distribution and Release updates

Status: implemented

English | [中文](2026-08-25-windows-desktop-updates.zh.md)

## Problem

The repository's Windows path requires a Node and pnpm checkout, a complete build, and a browser launch. That is suitable for development but does not provide an installable application, a stable shortcut, or a controlled update path for users moving to a new Windows computer.

The product UI also has no state owned by an application distributor. A browser deployment cannot know whether its server process came from an installed package, which Release feed applies to it, whether an installer is downloaded, or when replacing application files is safe. Putting those facts into the ordinary Web Host would grant a remote browser a machine-level installation capability and would make non-desktop deployments carry meaningless controls.

The JavaScript application and its local AI service dependencies have different portability requirements. Electron can distribute the built DSH closure, but vLLM, MinerU, ASR servers, model weights, GPU drivers, and machine-specific plugin configuration require independent service and data lifecycle management.

## Decision

`apps/desktop` is an Electron application packaged as a per-user Windows x64 NSIS installer. The renderer keeps Node integration disabled and enables context isolation and sandboxing. It loads the existing Web surface from a private `127.0.0.1` server. A second `@deepseek-ai/dsh/desktop-backend` entry boots the ordinary `web` profile with browser opening disabled and an operating-system-assigned port, reports the validated loopback URL over child IPC, and accepts one shutdown request. The Electron process waits for complete profile disposal before ordinary quit or update installation.

The sidebar declares a distinct `sidebar.update` single seat beside `sidebar.settings`. `ui-desktop-update` occupies it only when the Electron preload exposes the narrow updater bridge. Checking and up-to-date snapshots render nothing; availability, download progress, completed download, and retryable failure render the matching action. The preload copies only validated discriminated update states and exposes state subscription, download, and install verbs. GitHub access, SemVer selection, checksums, file storage, and installer restart stay in the main process through electron-updater.

The ESM main bundle keeps electron-updater external and reads its lazy `autoUpdater` getter through the CommonJS default export. It does not use a named ESM import because Node cannot statically detect that getter as a CommonJS named export.

The updater provider is the public `wsl189/dsh-teacher` GitHub Releases feed. Automatic download is disabled: a user starts it from the visible update action. Prerelease installs may receive prerelease Releases, while stable installs do not. The generated `latest.yml` SHA-512 record is the downloaded-file integrity source; configured Authenticode credentials add Windows publisher verification and reputation.

`.github/workflows/windows-desktop.yml` builds an NSIS artifact on every branch push and manual dispatch using native Windows and Node 24. A `v<version>` tag must equal the shared root package version before the workflow publishes the installer, blockmap, channel metadata, and a SHA-256 checksum list to a GitHub Release. Ordinary commit builds remain workflow artifacts and never enter the client update feed.

The installer includes Electron, its embedded Node runtime, the built frontend, and the DSH production dependency closure with `asar` disabled so dynamic plugins, workers, subprocess entries, and native addons remain real files. It does not include vLLM, MinerU, ASR, model weights, GPU drivers, third-party profile configuration, or `%USERPROFILE%\.dsh` user data. Those services remain separately deployable, including through Docker, and the installed application uses their configured endpoints.

## Alternatives considered

**Produce one `pkg` executable.** The existing single-executable work packages a deliberately closed JSON-RPC runtime and excludes Windows. Extending it to the complete Web composition would require custom treatment for dynamic Loader package resolution, client assets, native addons, worker and subprocess files, and a self-replacement helper. It would recreate the update and installer lifecycle that Electron and NSIS already maintain.

**Put the complete application and GPU services in one Docker image.** Containers are useful for MinerU, vLLM, and ASR service reproducibility, but a Windows desktop container does not provide a native per-user GUI, shortcuts, browser isolation, or an ordinary self-update experience. GPU driver and host compatibility also remain outside the image. The desktop installer and service containers therefore solve separate deployment units.

**Expose update controls from the Web Host.** This would make the same network surface that serves a browser capable of replacing its host installation. The preload-gated seat keeps installation authority local to a packaged desktop process and leaves ordinary browser deployments unchanged.

## Consequences

- Windows users can install and update the repository build without installing Node or pnpm. Their DSH home remains separate and must be copied independently for a full machine migration.
- Each pushed commit spends a native Windows build, while only matching version tags publish update metadata. Release operators must advance the shared version before tagging.
- Unsigned builds remain functional but can trigger SmartScreen. Production distribution requires the two code-signing repository secrets and a certificate whose publisher identity remains stable across updates.
- The distribution is Windows x64 only. External AI services and GPU software retain their own installation, health, update, and storage procedures.
- The desktop Web server remains loopback-only and uses an ephemeral port, so the installer does not add a LAN-exposed code-execution surface or reserve a fixed local port.

## Testing

The desktop update-controller tests cover unpackaged suppression, prerelease selection, availability, manual download, progress, completed installation, hidden check failures, visible retry failures, and invalid actions. The runtime-adapter test exposes electron-updater only as a CommonJS default export and requires `autoUpdater` to resolve from it. Client tests cover isolation-boundary validation, observable subscription teardown, hidden no-update states, wide and rail actions, progress, restart, retry, browser-only suppression, late slot declaration, and plugin teardown. Sidebar tests pin the new seat declaration and its wide/rail owner share. The Web scenario injects the same preload API before the real shipped composition boots, confirms no button for an up-to-date snapshot, checks that the available action is to the right of Settings, drives download and restart states, and captures the accessible snapshot. The Windows workflow builds the real NSIS target, reports an advisory failure when the unpacked application does not open its `DeepSeek Harness` window, and rejects missing installer or `latest.yml` output before retaining or publishing artifacts. Release acceptance uses a manual launch on the target Windows environment.
