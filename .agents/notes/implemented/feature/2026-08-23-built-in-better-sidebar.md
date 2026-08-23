# Agent Note: Built-in better-sidebar workbench

Status: implemented

English | [中文](2026-08-23-built-in-better-sidebar.zh.md)

## Problem

The standard Web profile exposes workspace files through the chat and workspace plugins but has no integrated file workbench. Installing better-sidebar as a separate profile bundle makes the right-side explorer, editor, terminal, and preview registry depend on per-user setup, so the shipped Web composition and a newly initialized profile provide different user interfaces.

## Decision

`@deepseek-ai/dsh-web-app` declares `dsh-better-sidebar` as a runtime dependency and mounts it under the `web-better-sidebar` row. The upstream plugin remains an independently versioned MIT package; DSH consumes its published package instead of copying its source into this repository. The plugin's default keeps the workbench closed until the user opens it.

The built-in row uses a different id from the standalone bundle's `better-sidebar` row. Because `dsh-web-app` precedes profile-installed bundles, the standalone bundle's duplicate-mount guard observes the built-in package row and disables its redundant instance. Existing profiles may therefore retain the standalone bundle while migrating to a DSH release that includes the workbench.

The workspace Office viewer package remains an external profile dependency. It registers `.docx`, `.xlsx`, and `.pptx` workspace viewers through better-sidebar, but its AGPL-3.0 declaration does not satisfy the repository's permissive runtime license policy. User documentation gives the explicit profile installation command and states the restart, supported-extension, and legacy-format behavior. Browser-held composer uploads use the separate transient tab from the [uploaded-document preview decision](2026-08-23-uploaded-document-sidebar-preview.md) and do not depend on that profile package.

## Verification

The assembled built-client snapshot requires the workbench host marker and better-sidebar's plugin-owned stylesheet. The dedicated `better-sidebar.e2e.ts` scenario boots the shipped Web composition in Chromium, selects a seeded session, proves that exactly one workbench is mounted and closed by default, and opens its Files surface. Cordis config validation checks that the Web bundle can resolve the bare plugin name, and the generated third-party notices record the MIT runtime dependency.

## Alternatives considered

**Keep better-sidebar entirely profile-installed.** This preserves the smaller default composition but leaves the standard Web interface dependent on undocumented per-user setup and does not provide the requested built-in workbench.

**Copy the upstream source into a workspace package.** A local fork would make upstream fixes and dependency changes a repository maintenance obligation without changing the extension interface or runtime behavior. Consuming the published MIT package keeps ownership and release cadence explicit.

**Distribute the Office viewer in the Web bundle.** This would make Office preview available without a second command, but the viewer package declares AGPL-3.0 and the repository rejects non-permissive runtime dependencies without an explicit distribution decision. The external profile installation retains the feature without weakening that policy.

## Consequences

Every standard Web installation includes better-sidebar's host and client artifacts plus its runtime dependency closure, including `node-pty`; repository installs already authorize the required native build script. The workbench is present but closed by default, and deployments can disable or replace its `web-better-sidebar` row with a later patch. Workspace Office preview remains an explicit user installation and is outside the DSH distribution license set.
