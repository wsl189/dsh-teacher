# Agent Note: Preview uploaded documents in better-sidebar

Status: implemented

English | [中文](2026-08-23-uploaded-document-sidebar-preview.zh.md)

## Problem

The composer retains an uploaded document as a browser `File` while MinerU extracts it, but its file row only showed the name, extraction state, and remove control. A user could not inspect the selected document before sending it. Workspace viewers cannot solve this case directly because they accept Host filesystem paths, while an unsent upload has no workspace path and must not create one merely for presentation.

## Decision

`ui-conversation` passes runtime document rows, a browser-file resolver, and removal controls through the existing `conversation.input.attachments` owner share. InputBar retains its non-interactive file-row fallback when no attachment presentation plugin occupies that slot.

`ui-attachment` optionally injects `betterSidebar` and registers the hidden `dsh:uploaded-document` tab type. Selecting a composer file card records its browser source and opens a session-targeted tab, which expands the right panel and focuses an existing tab for the same draft document. The controller keeps the `File` in an in-memory map rather than in persisted tab metadata. Removing the row, admitting the prompt, disposing the plugin, or restoring a tab after reload without its browser source closes that tab.

The preview reads the immutable browser file directly. PDF uses the browser's native viewer, common images use Blob URLs, DOCX uses `docx-preview`, PPTX uses Office Kit with sanitized SVG output, and XLSX renders a React-escaped table limited to 200 rows by 50 columns. Every source gets a Blob-URL download action. The dynamic client build maps `fflate` and JSZip to their browser entry points because the factory artifact uses CJS output and must not retain Node core-module requests. This capability covers composer uploads only; workspace Office files remain owned by the external viewer described by the [built-in workbench decision](2026-08-23-built-in-better-sidebar.md), and produced workspace files retain the native-open behavior in the [produced-file preview removal decision](../simplification/2026-08-22-remove-web-produced-file-preview.md).

Previewing does not stage a workspace copy, call a Host file-read route, alter OCR context, or add Session events. The file remains available only for the lifetime of its unsent draft row.

## Verification

Conversation tests pin the document rows and file resolver passed through the attachment slot. Attachment component tests pin click, removal, and reconciliation behavior; controller tests pin hidden-tab registration, targeted opening, deduplication identity, and stale-tab closure; preview tests pin format routing, Blob-URL rendering, download, and URL revocation. The attachment client bundle builds with the Office renderers inlined and no Node core-module imports, and the Web composition is exercised in Chromium by uploading a real document and opening its right-sidebar tab.

## Alternatives considered

**Stage every upload into the workspace and reuse file viewers.** This adds a filesystem write, naming policy, cleanup lifecycle, and user-visible workspace residue solely for a temporary read action.

**Require the external Office viewer to accept browser Blob URLs.** The installed viewer owns workspace paths and fetches through better-sidebar's Host route. Making the composer depend on that optional AGPL profile extension would leave the standard Web composition without the requested action and would couple draft lifetime to a third-party component contract.

**Restore the generic produced-file preview RPC.** The browser already owns upload bytes, so a Host whole-file read and produced-file selection state add authorization and lifecycle work without serving this consumer. Produced files and unsent uploads retain separate ownership and release rules.

## Consequences

Standard Web users can inspect PDF, DOCX, XLSX, PPTX, and common image uploads from the file card even while OCR is running, without the external Office viewer. The attachment client bundle carries the Office parser and renderer dependencies, and complex Office layout can differ from Microsoft Office; the preview is a reading aid, not an editing or pixel-fidelity surface. Browser-held bytes remain transient and disappear with the draft.
