# Agent Note: Desktop workspaces for new IM bots

Status: implemented

English | [中文](2026-09-01-im-bot-desktop-workspaces.zh.md)

## Problem

A process launch directory can be a repository, an installation folder, or another incidental location. Assigning it to a newly connected bot makes file operations depend on how the application starts. A Windows desktop can also reside outside the home directory, including on OneDrive or another drive.

## Decision

The [IM distribution patch](../../../../patches/xmanrui-dsh-im@1.0.3.patch) supplies desktop defaults through a small Host entry that passes explicit workspace settings to the unchanged upstream plugin. All nine bot platforms share the rule; Office retains its own configuration. [Electron](../../../../apps/desktop/src/main.ts) obtains the system desktop through `app.getPath('desktop')` and supplies it as `DSH_DESKTOP_DIR`. Other Host launches use that absolute override or `<home>/Desktop`.

An explicit per-platform workspace overrides the desktop default. The upstream workspace store only initializes missing assignments, so saved bot paths and subsequent user selections remain authoritative. The adapter does not rewrite configuration files, create desktop directories, or change the application's working directory.

## Alternatives considered

**Use `<home>/Desktop` in every deployment.** That path misses Windows desktops redirected by the user or OneDrive. Electron already owns access to the system desktop path.

**Change the process working directory.** That would also redirect unrelated application behavior. Passing explicit IM configuration confines the default to bot workspaces.

**Replace saved workspace mappings.** Existing assignments express user choices and may own active conversations. A default applies only when an assignment is absent.

## Consequences

New bot workspaces are independent of the launch directory, while saved assignments survive upgrades. Non-Electron hosts with a relocated desktop must supply `DSH_DESKTOP_DIR` or explicit platform settings. The maintained entry uses the upstream configuration API and leaves its compiled Host artifact intact.

## Testing

The [IM entry tests](../../../../packages/bundle/web-app/tests/im-workspaces.spec.ts) cover all nine platforms, explicit overrides, Office settings, the home-directory fallback, and invalid desktop paths. [Desktop environment tests](../../../../apps/desktop/tests/runtime-environment.spec.ts) cover system-path forwarding. The [assembled QQ browser scenario](../../../../apps/web/tests/qq-workspace-picker.e2e.ts) initializes an unassigned offline bot, preserves another bot's saved workspace, snapshots both paths, and verifies user-selected paths against persisted data and a page reload without contacting an IM service.
