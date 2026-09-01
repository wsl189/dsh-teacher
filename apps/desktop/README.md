# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Windows desktop distribution for this repository. Electron opens the existing Web surface in a hardened renderer while `@deepseek-ai/dsh/desktop-backend` runs the complete `web` profile as an IPC-controlled child process on `127.0.0.1` with an operating-system-assigned port. The child gives Electron a one-use launch-token URL, which creates the same authenticated browser session as `dsh web`. Closing the app or installing an update disposes the plugin tree before the child exits. Directory selection stays inside the running application: workspace actions and plugin fields such as a QQ bot's current workspace open the in-app directory browser instead of a second packaged process for a Windows folder dialog.

Electron first shows a compact, frameless, transparent, script-free brand card with 28-pixel rounded corners before it forks the backend. The card remains visible while the profile tree initializes. After the child reports a validated launch URL and that page finishes loading in a hidden ordinary window, Electron shows the normal framed, resizable 1440×900 application window and destroys the startup card. Closing the card while the private page loads also destroys the hidden application window. Startup has no fixed wall-clock cutoff: an explicit fatal message, fork error, or premature child exit still fails immediately, while a healthy first launch can continue through antivirus scanning. The bundled Windows-MCP Python child starts after successful application readiness, so its import and tool discovery do not delay the private Web page.

Electron supplies the system desktop directory for [new IM bot workspaces](../../third-party/README.md), including desktops redirected to OneDrive or another drive.

## Install and update

Download `DSH-Teacher-<version>-x64-Setup.exe` from this repository's [GitHub Releases](https://github.com/wsl189/dsh-teacher/releases). The NSIS installer supports a per-user installation directory, Start menu entry, and desktop shortcut. The executable, taskbar window, shortcuts, installer, and uninstaller use the same black-whale icon on a light rounded tile. An installed build checks the same Release feed at startup and every five minutes until it finds a newer version. The footer shows the installed version when no newer release is available. A newer version replaces that status with the “Update” action to the right of Settings; the action downloads the installer, verifies electron-builder's `latest.yml` SHA-512 metadata, then offers “Restart to update”.

The application stores sessions, settings, credentials, and teacher-workbench data under the ordinary DSH home (`%USERPROFILE%\.dsh` unless `DSH_HOME` is set). The image-generation plugin stores its generated-image history, gallery, and template cache in `%USERPROFILE%\.dsh\dsh-imagegen`. Reinstalling the app does not replace these directories. Copy them separately when migrating user data to another computer.

Composer and Daily Management voice input share the same microphone path. Electron grants audio capture only to this app's main private-loopback page, keeps camera and foreign content denied, and preserves clipboard writes used by copy controls. The completed browser recording is decoded locally into 16 kHz mono PCM WAV before the QQ-configured ASR request, matching the WAV input used by QQ voice messages instead of relying on each local service to decode Chromium WebM. On Windows, **Settings → Privacy & security → Microphone → Let desktop apps access your microphone** must also be enabled; an operating-system denial appears as the existing microphone-permission notice.

The in-app directory browser lists real folders from the Windows Host and can select the current folder; the QQ workspace dialog is titled “Select bot workspace folder” or “选择机器人工作区目录”, depending on the UI language. The absence of a Windows system folder window is expected in the installed desktop build.

The installer also contains a private, pinned Python runtime for the built-in Windows-MCP integration. Desktop control starts by default unless the user has saved a disabled setting; the runtime is not added to `PATH`. The generic **Plugin configuration** tab does not expose a Windows desktop control item; no separate Python, `uv`, Windows-MCP, or MCP configuration is required. Full access unlocks the pinned runtime's complete twenty-tool catalog without extra desktop approval; other modes expose thirteen desktop tools with per-call approval. [Windows-MCP permissions](../../packages/mcp/windows-mcp/README.md#tools-and-permission-modes) defines the session isolation and remaining policy checks.

AnySearch is built in for web search and page extraction. Configure its optional key and endpoint under **Settings → Plugins → Plugin configuration → Web search**; without a key it uses anonymous access. [Web search configuration](../../packages/bundle/web-app/README.md#built-in-web-search) describes the remote-service limits and outbound data. Its compiled plugin and MIT license are required by the desktop payload gate.

## Build locally

Run these commands from a native Windows PowerShell session:

```powershell
pnpm install
pwsh -NoProfile -File scripts/build-windows-mcp-runtime.ps1
pnpm run build:official
pnpm --filter @deepseek-ai/dsh-desktop run package:win
```

The runtime assembly requires the exact setup Python version recorded in `third-party/windows-mcp/runtime.json`. It downloads and verifies the official embedded archive, installs only hash-pinned binary wheels, applies the recorded local patch, and completes a real MCP stdio smoke before the desktop package is created. The desktop package command regenerates `apps/desktop/build/icon.svg` and the nine-resolution `icon.ico` from the startup page's official whale path before electron-builder runs.

The installer, blockmap, updater metadata, and unpacked application are written to `apps/desktop/release/`. Before distributing the installer, start `apps/desktop/release/win-unpacked/DSH Teacher.exe` on Windows, wait for the `DeepSeek Harness` main window, create a standard session, and confirm that both its slash-command directory and a workspace directory action load; successful artifact generation alone does not execute the Electron main process or a dynamically resolved preset. The checked-in builder configuration targets Windows x64 and deliberately leaves `asar` disabled because the Host loads plugin packages, subprocess entries, workers, and native addons from real files. Dependency-wide exclusions remove source maps and TypeScript incremental compiler state. The desktop manifest directly anchors Turndown and its GFM plugin because the standard preset resolves `dsh-tool-web` dynamically. An `afterPack` hook resolves those packages from the desktop application and Domino from Turndown's dependency base, then stages each package manifest, license, and runtime `lib` tree in `resources/app`; this exact set is independent of pnpm 11's deduplicated workspace-list references and excludes Domino's development fixtures. The payload gate requires their executable entries in addition to reading packaged manifests and rejecting a missing required workspace dependency or peer. It also explicitly requires the image-generation Host and Client bundles, template snapshot, and license, the skill/MCP package, the complete attributed PPT Master skill distribution, the Univer Viewer, Gateway, workers, skills, commercial assets, and Windows x64 native bindings, plus the embedded CPython executable, Windows-MCP metadata, and representative native Python modules.

## GitHub automation

`.github/workflows/windows-desktop.yml` runs on every pushed branch and manual dispatch. It builds and smoke-tests the pinned Windows-MCP runtime on `windows-2025`, builds the repository, creates the NSIS installer, starts the unpacked application, exchanges its launch token for a browser cookie, calls the real `directoryPicker/list` Remote, creates a standard-preset session, and requires its `/goal` and `/plan` command rows before writing `SHA256SUMS.txt` and retaining the installer as a workflow artifact. A tag push publishes those files as the update feed only when the tag exactly matches `v<root package version>`.

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

The installer contains Electron, the JavaScript/Node runtime, this repository's built Web UI, and the complete shipped DSH plugin closure—including the AI image studio, IM, cron, skill/MCP management, Windows desktop control, the AGPL Office viewer, Univer Office, the QQ-configured speech adapter, and PPT Master 6.1.0 with its scripts, references, templates, media, license, and sponsor records. These plugins and Skill resources need no separate installation. A private embedded CPython and wheel closure exists only for Windows-MCP and starts by default unless Windows desktop control is disabled; packaged launches resolve it from `resources/windows-mcp` and ignore ambient override paths. The EXE does not embed an image-generation provider or model, PPT Master's optional Python packages, vLLM, MinerU, the speech-recognition server, model weights, GPU drivers, Docker, a Chrome/Chromium executable, a Univer license, or machine-specific plugin configuration. Configure an OpenAI-compatible image endpoint, API key, and model catalog under **Settings → Models → Image generation model**; prompts and reference images leave the machine for that configured service. Keep external runtimes, services, and private values separate, and migrate `DSH_HOME` plus the image-generation data directory separately.

## Known Limitations and Deferred Work

- **Windows x64 only** — no arm64 installer or macOS/Linux desktop artifact is produced.
- **External AI services remain deployment dependencies** — MinerU defaults to `http://127.0.0.1:8005/file_parse`; image-generation, vLLM, and ASR endpoints must be installed and operated separately.
- **Windows desktop control needs an interactive session** — visible-desktop actions require unlocked Windows. Full access does not grant Windows administrator rights or bypass UAC, secure desktops, or other DSH policies.
- **Univer evaluation and licensed use** — the Viewer opens without `UNIVER_LICENSE` under upstream evaluation limits; licensed features need a valid runtime license and distribution requires the appropriate rights; Slide rendering operations also need local Chrome/Chromium, selected with `UNIVER_RENDER_BROWSER` when required.
- **Code signing is repository-secret dependent** — unsigned fork builds work but Windows may show reputation warnings.
