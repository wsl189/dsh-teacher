# Agent Note: Official release integration with preserved teacher settings

Status: implemented

English | [中文](2026-09-16-official-release-integration.zh.md)

## Problem

The teacher distribution needs upstream fixes and maintained plugin releases while its workbench workflows and supplier-model configuration remain stable. Replacing the complete application with upstream defaults would remove those features and disconnect image and speech consumers from saved assignments.

## Decision

The integration uses the official `dsh-v0.1.6-alpha.2` release for the harness, Remote APIs, session upgrades, native system support, and official sidebar. Teacher workbench packages and Models keep their existing user operations, fields, defaults, persistence locations, and supplier assignments; changes in those packages adapt only the upstream APIs. The teacher Electron launcher and updater retain their existing application identity and data locations.

The Web profile mounts official Files, Documents, and Terminal sidebar plugins. The retained Office preview plugin registers with the official document-preview service. No `dsh-better-sidebar` package, draft-tab adapter, Windows-MCP package, or private Python runtime belongs to the distribution.

Windows mounts the official native Cua Driver computer-use provider. The distribution checks allow this exact experimental dependency only from the Web bundle; other experimental runtime dependencies remain rejected. Its lifecycle, tool catalog, cancellation, screenshot admission, and OS permission requirements remain upstream-owned.

The [third-party manifest](../../../../third-party/plugin-release-manifest.json) pins the reviewed plugin releases. Compatibility patches preserve unified media-model assignments, saved IM workspaces, QQ speech delegation, and native Office previews. Executable updates do not rewrite user settings or workbench data. Univer retains its runtime licensing, worker cache, and native Word equation changes.

The [bundled extension decision](../feature/2026-08-25-bundled-extensions-and-qq-speech.md), [bot workspace decision](../feature/2026-09-01-im-bot-desktop-workspaces.md), and [supplier model decision](2026-09-01-supplier-grouped-model-settings.md) retain their independent ownership rules. The earlier better-sidebar and Windows-MCP decisions are archived because their implementations are absent.

The alpha.2 integration adds the official plugin manager, sidebar browser and subagent conversations, turn file changes, Office-to-PDF previews, and restart-safe inbox behavior. General, Models, and workbench settings keep their saved namespaces. MinerU and document extraction remain in Settings → Plugins → Plugin configuration; the official shell, agent-loop, subagent, and AnySearch forms are on the sidebar Plugins page.

The skills/MCP panel's pinned compatibility patch uses Typert codec factories on both Host and Client. Shipped-composition requests exercise its skill and MCP lists over the real Gateway so an installed but failed plugin cannot pass as available. Main-panel session navigation continues to publish the distribution's navigation event so selecting a conversation closes the workbench overlay.

## Alternatives considered

**Replace every package with the release archive.** This would discard the protected workbench and Models behavior. Preserve those packages and test their adaptations against the actual upstream services.

**Keep both sidebar or desktop-control implementations.** Duplicate registrations and independent permission and file lifecycles would defeat the requested replacement. Retain only the official owners and a small Office-preview adapter.

**Adopt each plugin’s separate model configuration.** This would split saved service access and use-case assignments. The distribution continues to own those settings while upstream plugins own their operations.

## Consequences

Upstream fixes share one implementation, and plugin upgrades remain reproducible. Future updates must preserve the protected operations and review compatibility patches, licenses, tool rosters, browser rendering, and installer closure together. Native desktop behavior requires Windows validation; Linux unit tests prove only the provider and packaging logic they execute.
