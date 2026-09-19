# Third-party source artifacts

English | [中文](README.zh.md)

This directory pins third-party plugins in the dsh-teacher Web and Windows distribution. The [release manifest](plugin-release-manifest.json) records upstream versions and integrity values checked on 2026-09-16. The Web profile mounts these packages directly; no separate profile installation is required.

## Inventory

| Package | Version | Distribution role |
|---|---:|---|
| `@anysearch/anysearch-dsh` | 0.1.4 | Web search, extraction, capability discovery, and batches. |
| `@dickpy/dsh-imagegen` | 1.5.12 | Image studio, canvas, gallery, templates, and generation tools. |
| `@xmanrui/dsh-im` | 4.21.1 | Eleven IM platforms, file delivery, reminders, and shared QQ speech input. |
| `dsh-plugin-cron` | 0.1.3 | Durable schedules, model tools, and browser management. |
| `dsh-skill-mcp-panel` | 2.0.4 | Skill and profile MCP management. |
| `dsh-univer-office` | 0.3.0, DSH repack 7 | Sheets, Docs, Slides, Bases, Boards, review, and import/export. |
| `@huanlin/dsh-plugin-better-sidebar-plugin-office` | 0.2.0 | DOCX, XLSX, and PPTX previews in the official sidebar. |

The Office viewer retains its upstream package name but has no dependency on `dsh-better-sidebar`. Its compatibility patch registers viewers with the official document-preview service. Sidebar files, documents, and terminals come from DSH. Windows desktop control uses the official [native Cua Driver provider](../packages/experimental/computer-use-cua-driver-native/README.md); Windows-MCP and its private Python runtime are absent.

The [PPT Master provider](../packages/skill/skill-ppt-master/README.md) separately bundles the complete upstream v6.4.0 skill directory. Its execution routes retain their external Python and tool prerequisites.

<a id="configuration-and-migration"></a>
## Configuration and migration

Configure supplier routes under **Settings → Models → Service access** and assign conversation, tool, image, and speech models under **Use cases**. Image generation, browser voice input, workbench voice input, and QQ consume those assignments and the shared credential store. Compatibility patches preserve this configuration ownership when upstream plugins provide their own model forms.

Configure bots under **Settings → IM bots**, skills under **Settings → Skills**, and profile servers under **Settings → MCP** or `dsh-panel mcp`. AnySearch permits anonymous access within its service limits; the [Web search reference](../packages/bundle/web-app/README.md#built-in-web-search) owns its endpoint, credential, and result-cap settings.

Daily Management reminders list configured bots from the bundled IM plugin, including offline bots with their connection state. The compatibility patch supplies the workbench notification service alongside upstream proactive delivery; it preserves bot aliases and keeps private recipients and credentials inside IM. QQ reminders use the most recently remembered private conversation, or the bound owner when no private conversation is remembered. Delivery requires a connected bot and an available private recipient.

Executable artifacts contain no user credentials or documents. Bot state, cron jobs, skills, MCP settings, Univer files and worktrees remain under their existing user directories. Image history and caches remain under `~/.dsh/dsh-imagegen`. Migrate the required `DSH_HOME`, image history, and workspace data separately from the application.

The Univer profile disables telemetry and forwards runtime `UNIVER_LICENSE` to content workers; the repack removes the embedded development-license fallback. Its licensed features remain subject to upstream terms. Browser-rendered operations may require Chrome or Chromium, selectable with `UNIVER_RENDER_BROWSER`. The Office preview package retains AGPL-3.0, while Univer includes separately licensed bundled modules recorded in [third-party notices](../THIRD_PARTY_NOTICES.md).

Univer content operations each run in a separate Node process and share a compile cache at `<DSH_HOME>/cache/dsh-univer-office/node`. Set `NODE_COMPILE_CACHE` to select another directory or `NODE_DISABLE_COMPILE_CACHE=1` to disable caching. Node invalidates compiled entries when their code or runtime version changes; the cache does not replace saved Office documents or worktrees.

<a id="word-equations-and-fonts"></a>
## Word equations and fonts

Chat-generated Word documents default Latin letters and digits to Times New Roman. The Doc skill marks inline and display TeX with `\(...\)` and `\[...\]`; DOCX export converts those expressions to editable native Office Math. New equation letters and digits use Times New Roman with italic variables and upright numbers and function names. Operators and extensible symbols retain Cambria Math, and explicit mathematical alphabets retain their styles. Unsupported marked equations fail export without replacing an existing destination. Explicit text fonts and Chinese font assignments remain intact.

The converter escapes XML text and attribute values, preserving comparisons and ampersands. Formula summaries use the same TeX markers and separate paragraphs; unmarked text and literal `\n` are not inferred as equations or line breaks. Conversion errors identify the source equation for correction without substituting lookalike symbols. The live Univer editor displays TeX source, so equation layout must be checked in the exported Word file. Rasterized equations cannot be recovered by this conversion. The [native Word decision](../.agents/notes/implemented/feature/2026-09-17-chat-word-native-equations.md) owns the conversion scope and verification; workbench exports and model settings are separate.

The Univer skills use the [Office workspace tool](../packages/deliverables/office-workspace/README.md) to keep authoring scripts, screenshots, `.univer` sources, and draft exports in an owned temporary directory. Required readback and visual checks precede final publication and cleanup.

## Bot workspaces

New bots default to the Host user’s desktop. Electron supplies the system desktop through `DSH_DESKTOP_DIR`; other launches use that absolute override or `<home>/Desktop`. Explicit configuration and saved bot workspaces take precedence. The in-app directory picker saves a replacement only for the selected bot. The [workspace decision](../.agents/notes/implemented/feature/2026-09-01-im-bot-desktop-workspaces.md) owns this preservation rule.

<a id="artifact-notes"></a>
## Artifact notes

The pinned skills/MCP panel uses a compatibility patch for alpha.2 Typert codec factories; its version, saved skills, groups, and server configuration remain unchanged. Univer contributes its preview as a named turn-tail list entry so it coexists with the official changed-file cards.

Published npm artifacts retain their licenses and source metadata. `pnpm-workspace.yaml` names each compatibility patch; `pnpm-lock.yaml` fixes the resolved closure. AnySearch remains the reviewed 0.1.4 source build. Univer additionally keeps the pristine npm archive beside `dsh-univer-office-0.3.0-dsh.7.tgz` and [runtime.patch](dsh-univer-office/runtime.patch), so the repack is reproducible. Its WebSocket proxy preserves text and binary frames and forwards the Viewer session ticket to the Gateway.

The Univer repack includes the [upstream 0.3.0 lockfile](https://github.com/dream-num/dsh-univer-office/blob/v0.3.0/pnpm-lock.yaml) versions of `@univerjs-pro/engine-formula-rust-binding` (`1.0.0-insiders.20260910-22fe9c7`) and `@univerjs-pro/exchange-node-binding` (`0.1.2`). Its skills group related writes and retain independent readback and visual checks. The skills and API tool descriptions recommend exact member queries and distinguish the `find` result limit from complete `show` responses. The [Office generation decision](../.agents/notes/implemented/bug-fix/2026-09-16-office-generation-overhead.md) records the worker measurements and validation scope.

## Verification

The shipped-composition tests require official sidebar modules, the retained plugin modules and tools, and the absence of better-sidebar and Windows-MCP. Model tests exercise the exact configured image and speech routes. Browser scenarios cover workbench behavior, model settings, Office presentation, and bot workspaces; desktop payload checks require the official computer-use SDK and each retained plugin’s runtime files. Native Windows actions require a Windows desktop.
