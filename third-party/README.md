# Third-party source artifacts

English | [中文](README.zh.md)

This directory pins reviewed third-party plugin artifacts used by the dsh-teacher distribution. They are project build inputs, not per-machine installation files: `@deepseek-ai/dsh-web-app` declares them as dependencies and mounts them in its shipped profile, so source launches and the Windows EXE need no separate `dsh plugin add` step.

## Inventory

| Directory | Artifact | Version | Upstream | Distribution role |
|---|---|---:|---|---|
| `dsh-imagegen/` | `dickpy-dsh-imagegen-1.5.1-dsh.1.tgz` | 1.5.1, DSH runtime repack 1 | [dickpy/dsh-imagegen](https://github.com/dickpy/dsh-imagegen) | AI image studio, text-to-image and image-to-image tools, gallery, and prompt templates. |
| `dsh-im/` | `xmanrui-dsh-im-1.0.3.tgz` | 1.0.3 | [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | Nine IM platforms, QQ file delivery, mobile reminders, and QQ ASR settings. |
| `dsh-plugin-cron/` | `dsh-plugin-cron-0.1.3.tgz` | 0.1.3 | [abiaoa1314/dsh-plugin-cron](https://github.com/abiaoa1314/dsh-plugin-cron) | Durable cron jobs, model tools, and browser management. |
| `dsh-skill-mcp-panel/` | `dsh-skill-mcp-panel-2.0.1.tgz` | 2.0.1 | [Fishquito7/dsh-skill-mcp-panel](https://github.com/Fishquito7/dsh-skill-mcp-panel) | Web and CLI management for global/workspace skills and profile MCP servers. |
| `dsh-univer-office/` | `dsh-univer-office-0.2.12-dsh.1.tgz` | 0.2.12, DSH rebuild 1 | [dream-num/dsh-univer-office](https://github.com/dream-num/dsh-univer-office) | Agent-authored Sheets, Docs, Slides, Bases, and Boards with isolated review and Office import/export. |
| `windows-mcp/` | Embedded CPython and hash-pinned wheel inputs | CPython 3.14.7; Windows-MCP 0.8.5 | [python/cpython](https://github.com/python/cpython), [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) | Default-off Windows desktop automation runtime assembled into the x64 desktop installer. |

The Web bundle also pins `@huanlin/dsh-plugin-better-sidebar-plugin-office` 0.1.2 from npm. That AGPL-3.0 package registers DOCX, XLSX, and PPTX viewers with the built-in better-sidebar file registry.

## Configuration and migration

Executable code ships with the repository and EXE; machine-specific state does not. Bot credentials, QQ settings, cron jobs, skill files, MCP configuration, Univer documents, worktrees, and downloaded resource caches remain under `DSH_HOME` or the selected workspace. Configure bots through **Settings → Plugins → Connected Platforms**, configure image-provider channels under **Settings → Plugins → AI Image Generation**, manage skills under **Settings → Skills**, and manage MCP servers under **Settings → MCP** or through `dsh-panel mcp`. The image-generation API key is stored in the local settings document, and generated-image history, the gallery, and template caches use `~/.dsh/dsh-imagegen`; reference images and prompts are sent to the configured provider. In the installed Windows desktop, a bot's **Choose directory** action uses the in-app Host directory browser; it does not require a Windows system folder dialog. The `dsh-im/cordis.patch.yml.example` file remains only as a reference for deployments that need an explicit `qq.outboundMediaRoots` override.

The built-in Univer row sets `telemetry: false`. Univer Office requires a valid commercial Univer Pro license supplied at runtime through `UNIVER_LICENSE`; the artifact contains no development-license fallback. Some Slide layout checks, SVG text measurement, and screenshot operations also require a local Chrome or Chromium executable, selected explicitly with `UNIVER_RENDER_BROWSER` when automatic discovery is insufficient.

Windows desktop control is enabled under **Settings → Plugins → Windows Desktop Control**. The installed x64 desktop supplies its own private runtime, so users do not install Python, Windows-MCP, or another MCP row. Only thirteen reviewed visible-desktop tools are published, and every call requires approval; PowerShell, registry, process, clipboard, filesystem, notification, and scrape tools stay excluded.

To migrate a machine, install the new EXE or clone and build the repository, then copy the required `DSH_HOME`, `~/.dsh/dsh-imagegen`, and workspace data separately. Do not reinstall the built-in integrations into the generated user profile; remove separately installed image-generation or Windows-MCP rows before starting the built-in release because duplicate rows can register duplicate tools and sidebar entries.

## Verification

The real shipped-composition browser lane asserts that all client modules are in the module graph. It also pins the four image-generation tools, Host-level `cron_*`, `qq_send_local_file`, thirteen `univer_*` tools, and the default-off Windows-MCP settings namespace, while the voice-input lane sends browser recordings through the shared QQ configuration. The QQ workspace-picker lane opens a seeded bot's directory action and snapshots the in-app listing returned by the real Host backend. The desktop payload gate separately requires the image-generation Host and Client bundles, built-in template snapshot, and license; the Univer Viewer, Gateway, workers, skills, commercial resource manifest, and Windows x64 native bindings; and the embedded CPython executable, Windows-MCP metadata, and representative Python native modules.

## Artifact notes

The image-generation archive is a runtime-only repack of upstream npm release 1.5.1. It retains the unchanged compiled Host and Client bundles, bundled 441-case template snapshot, package metadata, bundle patch, README, and Apache-2.0 license; it omits the 50 MB release's screenshots, demonstration video, non-runtime TypeScript sources, and source map. The official npm tarball SHA-256 is `f95c6ac0099d2dc958e07efb2a4a35dd036c832db30d6e3d37fb63b916bda820`; the reviewed runtime repack SHA-256 is `dc0877229e38fbd19d716654460a0f0a4346992e37318fb8e48853f34a29ec51`.

The dsh-im archive contains its source and MIT license. The cron archive contains compiled `lib/` output, its bundle patch, README, and MIT license. The skill/MCP archive is the upstream MIT release artifact; the repository compatibility patch updates its client injections and session lookup for this DSH revision. Its SHA-256 is `5e8523cfea0c4ca2cf7a71600f6eaa67655258b1ddce317e5c06f0658620737a`.

The Windows runtime assembly pins the official CPython 3.14.7 AMD64 embedded archive and Windows-MCP 0.8.5 wheel by SHA-256 in `windows-mcp/runtime.json`; the complete binary-only wheel closure is hash-pinned in `windows-mcp/requirements.lock`. Upstream imports GPL-licensed `fuzzywuzzy` at one desktop service line. DSH records and hash-checks `windows-mcp/patches/use-thefuzz.patch`, replaces that import with the compatible MIT `TheFuzz` API during assembly, and excludes `fuzzywuzzy`, `Levenshtein`, and `python-Levenshtein` from the payload. A real stdio initialize/list/`Wait` smoke must pass before packaging.

The Univer archive is rebuilt from the supplied 0.2.12 source. The rebuild removes the source's embedded development-license fallback and passes only the runtime `UNIVER_LICENSE` value into its Viewer, Gateway, render process, and unit-content worker. Its SHA-256 is `337d705ddcacd39269c8ab0c3835bb37ab5ff38f63cb775116d60ffbd5bc616a`. The wrapper declares Apache-2.0, but its executable closure includes three external `@univerjs-pro/*` runtime roots and 90 separately licensed build-time modules that its build script inlines into the artifacts: 79 under `@univerjs-pro/*` and 11 under `@univer-cli/*`. The compiled tarball does not carry those modules' individual manifests or notices; the generated notices therefore list every declared identity and pin their declaration digest. Building or distributing the repository requires appropriate [Univer Pro licensing and distribution rights](https://docs.univer.ai/guides/pro/license), including authorization for those bundled modules. Update any pinned archive only after reviewing its executable closure, provenance, licenses, local compatibility changes, native payloads, and shipped-composition behavior together.
