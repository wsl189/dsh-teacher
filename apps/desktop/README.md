# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Windows desktop distribution for this repository. Electron opens the existing Web surface in a hardened renderer while `@deepseek-ai/dsh/desktop-backend` runs the complete `web` profile as an IPC-controlled child process on `127.0.0.1` with an operating-system-assigned port. Closing the app or installing an update disposes the plugin tree before the child exits.

## Install and update

Download `DSH-Teacher-<version>-x64-Setup.exe` from this repository's [GitHub Releases](https://github.com/wsl189/dsh-teacher/releases). The NSIS installer supports a per-user installation directory, Start menu entry, and desktop shortcut. At startup an installed build checks the same Release feed. A newer version makes the “Update” action appear to the right of Settings; the action downloads the installer, verifies electron-builder's `latest.yml` SHA-512 metadata, then offers “Restart to update”.

The application stores sessions, settings, credentials, and teacher-workbench data under the ordinary DSH home (`%USERPROFILE%\.dsh` unless `DSH_HOME` is set). Reinstalling the app does not replace that directory. Copy it separately when migrating user data to another computer.

## Build locally

Run these commands from a native Windows PowerShell session:

```powershell
pnpm install
pnpm run build:official
pnpm --filter @deepseek-ai/dsh-desktop run package:win
```

The installer, blockmap, and updater metadata are written to `apps/desktop/release/`. The checked-in builder configuration targets Windows x64 and deliberately leaves `asar` disabled because the Host loads plugin packages, subprocess entries, workers, and native addons from real files.

## GitHub automation

`.github/workflows/windows-desktop.yml` runs on every pushed branch and manual dispatch. It builds the repository on `windows-2025`, creates the NSIS installer, writes `SHA256SUMS.txt`, and retains the installer as a workflow artifact. A tag push publishes those files as the update feed only when the tag exactly matches `v<root package version>`.

For a new updater-visible release, advance the shared repository version, push that version commit, then create the matching desktop tag:

```sh
pnpm run release:dsh patch
git push origin HEAD
git tag v0.1.2
git push origin v0.1.2
```

Replace `0.1.2` with the version written by the bump command. The bump command creates its own version commit. Its `dsh-v<version>` tag belongs to the independent npm release sequence; the desktop workflow uses the additional `v<version>` tag. A prerelease version such as `0.1.2-rc.1` creates a GitHub prerelease and is offered only to installed prerelease builds.

Repository secrets `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` enable Authenticode signing through electron-builder. The workflow can build without them, but unsigned installers can trigger Microsoft Defender SmartScreen and should not be presented as trusted production binaries.

## Security and scope

The renderer has `contextIsolation`, sandboxing, and Node integration disabled. Its preload exposes only update snapshot/subscription/download/install methods. External navigation is denied and handed to the operating-system browser. GitHub metadata and downloads remain in the main process, and the installer is selected by SemVer through electron-updater.

The installer contains Electron, the JavaScript/Node runtime, this repository's built Web UI, and the complete shipped DSH plugin closure—including IM, cron, Office preview, and the QQ-configured speech adapter. These plugins need no separate installation. The EXE does not embed vLLM, MinerU, the speech-recognition server, model weights, GPU drivers, Docker, or machine-specific plugin configuration. Keep those services separate (Docker is appropriate for them), point the installed app at their loopback endpoints, and migrate `DSH_HOME` separately.

## Known Limitations and Deferred Work

- **Windows x64 only** — no arm64 installer or macOS/Linux desktop artifact is produced.
- **External AI services remain deployment dependencies** — MinerU defaults to `http://127.0.0.1:8005/file_parse`; vLLM and ASR endpoints must be installed and operated separately.
- **Code signing is repository-secret dependent** — unsigned fork builds work but Windows may show reputation warnings.
