# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Windows desktop distribution for this repository. Electron opens the existing Web surface in a hardened renderer while `@deepseek-ai/dsh/desktop-backend` runs the complete `web` profile as an IPC-controlled child process on `127.0.0.1` with an operating-system-assigned port. The child gives Electron a one-use launch-token URL, which creates the same authenticated browser session as `dsh web`. Closing the app or installing an update disposes the plugin tree before the child exits. Directory selection stays inside the running application: workspace actions and plugin fields such as a QQ bot's current workspace open the in-app directory browser instead of a second packaged process for a Windows folder dialog.

## Install and update

Download `DSH-Teacher-<version>-x64-Setup.exe` from this repository's [GitHub Releases](https://github.com/wsl189/dsh-teacher/releases). The NSIS installer supports a per-user installation directory, Start menu entry, and desktop shortcut. At startup an installed build checks the same Release feed. The footer shows the installed version when no newer release is available. A newer version replaces that status with the “Update” action to the right of Settings; the action downloads the installer, verifies electron-builder's `latest.yml` SHA-512 metadata, then offers “Restart to update”.

The application stores sessions, settings, credentials, and teacher-workbench data under the ordinary DSH home (`%USERPROFILE%\.dsh` unless `DSH_HOME` is set). The image-generation plugin stores its generated-image history, gallery, and template cache in `%USERPROFILE%\.dsh\dsh-imagegen`. Reinstalling the app does not replace these directories. Copy them separately when migrating user data to another computer.

Composer and Daily Management voice input share the same microphone path. Electron grants audio capture only to this app's main private-loopback page, keeps camera and foreign content denied, and preserves clipboard writes used by copy controls. The completed browser recording is decoded locally into 16 kHz mono PCM WAV before the QQ-configured ASR request, matching the WAV input used by QQ voice messages instead of relying on each local service to decode Chromium WebM. On Windows, **Settings → Privacy & security → Microphone → Let desktop apps access your microphone** must also be enabled; an operating-system denial appears as the existing microphone-permission notice.

The in-app directory browser lists real folders from the Windows Host and can select the current folder; the QQ workspace dialog is titled “Select bot workspace folder” or “选择机器人工作区目录”, depending on the UI language. The absence of a Windows system folder window is expected in the installed desktop build.

The installer also contains a private, pinned Python runtime for the built-in Windows-MCP integration. It is disabled by default and is not added to `PATH`. To use it, open **Settings → Plugins → Windows Desktop Control** and enable the card; no separate Python, `uv`, Windows-MCP, or MCP configuration is required. The reviewed thirteen-tool desktop subset then becomes available, and every call requires approval.

## Build locally

Run these commands from a native Windows PowerShell session:

```powershell
pnpm install
pwsh -NoProfile -File scripts/build-windows-mcp-runtime.ps1
pnpm run build:official
pnpm --filter @deepseek-ai/dsh-desktop run package:win
```

The runtime assembly requires the exact setup Python version recorded in `third-party/windows-mcp/runtime.json`. It downloads and verifies the official embedded archive, installs only hash-pinned binary wheels, applies the recorded local patch, and completes a real MCP stdio smoke before the desktop package is created.

The installer, blockmap, updater metadata, and unpacked application are written to `apps/desktop/release/`. Before distributing the installer, start `apps/desktop/release/win-unpacked/DSH Teacher.exe` on Windows, wait for the `DeepSeek Harness` main window, and confirm that a workspace directory action opens an in-app listing; successful artifact generation alone does not execute the Electron main process. The checked-in builder configuration targets Windows x64 and deliberately leaves `asar` disabled because the Host loads plugin packages, subprocess entries, workers, and native addons from real files. Dependency-wide exclusions remove source maps and TypeScript incremental compiler state. The payload gate also reads packaged manifests and rejects a missing required workspace dependency or peer; it explicitly requires the image-generation Host and Client bundles, template snapshot, and license, the skill/MCP package, the complete attributed PPT Master skill distribution, the Univer Viewer, Gateway, workers, skills, commercial assets, and Windows x64 native bindings, plus the embedded CPython executable, Windows-MCP metadata, and representative native Python modules.

## GitHub automation

`.github/workflows/windows-desktop.yml` runs on every pushed branch and manual dispatch. It builds and smoke-tests the pinned Windows-MCP runtime on `windows-2025`, builds the repository, creates the NSIS installer, starts the unpacked application, exchanges its launch token for a browser cookie, and calls the real `directoryPicker/list` Remote before writing `SHA256SUMS.txt` and retaining the installer as a workflow artifact. A tag push publishes those files as the update feed only when the tag exactly matches `v<root package version>`.

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

The renderer has `contextIsolation`, sandboxing, and Node integration disabled. Its preload exposes only update snapshot/subscription/download/install methods. The initial loopback URL exchanges a process-scoped token for an HttpOnly, authority-bound browser cookie and then redirects to a clean root URL. External navigation is denied and handed to the operating-system browser. GitHub metadata and downloads remain in the main process, and the installer is selected by SemVer through electron-updater.

The installer contains Electron, the JavaScript/Node runtime, this repository's built Web UI, and the complete shipped DSH plugin closure—including the AI image studio, IM, cron, skill/MCP management, Windows desktop control, the AGPL Office viewer, Univer Office, the QQ-configured speech adapter, and PPT Master 6.1.0 with its scripts, references, templates, media, license, and sponsor records. These plugins and Skill resources need no separate installation. A private embedded CPython and wheel closure exists only for Windows-MCP and is launched only when that default-off feature is enabled; packaged launches resolve it from `resources/windows-mcp` and ignore ambient override paths. The EXE does not embed an image-generation provider or model, PPT Master's optional Python packages, vLLM, MinerU, the speech-recognition server, model weights, GPU drivers, Docker, a Chrome/Chromium executable, a Univer license, or machine-specific plugin configuration. Configure an OpenAI-compatible image endpoint, API key, and model catalog under **Settings → Plugins → AI Image Generation**; prompts and reference images leave the machine for that configured service. Keep external runtimes, services, and private values separate, and migrate `DSH_HOME` plus the image-generation data directory separately.

## Known Limitations and Deferred Work

- **Windows x64 only** — no arm64 installer or macOS/Linux desktop artifact is produced.
- **External AI services remain deployment dependencies** — MinerU defaults to `http://127.0.0.1:8005/file_parse`; image-generation, vLLM, and ASR endpoints must be installed and operated separately.
- **Windows desktop control needs an interactive session** — the bundled MCP can inspect and operate the visible desktop outside the DSH sandbox only while Windows is unlocked; every call remains approval-gated.
- **Univer has external license and browser requirements** — set a valid `UNIVER_LICENSE` before launch and obtain the necessary commercial distribution rights; Slide rendering operations also need local Chrome/Chromium, selected with `UNIVER_RENDER_BROWSER` when required.
- **Code signing is repository-secret dependent** — unsigned fork builds work but Windows may show reputation warnings.
