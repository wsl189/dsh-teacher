# Agent Note: remove in-product produced-file previews

Status: implemented

English | [中文](2026-08-22-remove-web-produced-file-preview.zh.md)

## Problem

The produced-file preview duplicated the Host-native file action with a browser-only document stack. Its original motivation was a common reading path for remote and headless clients across PDF, PowerPoint, Word, spreadsheet, Markdown, and image files without executing agent-written active documents near the Harness API. The implementation added a bounded whole-file RPC, per-session preview selection, six document-parser dependencies, and approximately 4.5 MB of uncompressed client code. The target desktop deployment has a native file opener, does not support remote preview as a product requirement, and does not want the additional right-column behavior.

## Decision

Produced-file chips and matching inline-code mentions use the existing `openFile(path)` action. The resident details column remains the Tool-call inspector, and **Show in folder** remains available when the Host supports native paths. The [workspace file links decision](../feature/2026-07-31-web-workspace-file-links.md) owns native opening, browser preference, remote-client scope, and active-document isolation.

The produced-file path has no `session.previewFile` RPC, `previewFileMaxBytes` configuration, `conversation.details.file` slot, preview selection state, or Host file-read transport. No compatibility path or durable data remains. The former preview decision is fully consolidated into this note and removed with its English/Chinese pair and consistency record.

Browser-held composer uploads are a separate current consumer described by the [uploaded-document preview decision](../feature/2026-08-23-uploaded-document-sidebar-preview.md). That renderer reads an unsent `File` already owned by the browser, creates no workspace path or Host RPC, and closes with the draft; it does not restore produced-file preview behavior.

## Alternatives considered

**Disable preview reads with `previewFileMaxBytes: 0`.** This blocks Host reads but leaves the right-column action, browser bundle, RPC, configuration, tests, and unsupported-state UX in the product.

**Keep the RPC without the browser renderer.** No production consumer remains, so retaining it preserves a public method and filesystem authorization path solely for possible future use.

**Keep only lightweight Markdown and image previews.** A reduced renderer still keeps the second file-opening interaction and its selection state. The selected behavior is the native opener, not a smaller preview feature.

**Serve workspace files as executable browser documents.** Same-origin serving exposes the Harness API; sandboxing breaks ordinary active pages; a second origin adds another listener and public URL lifecycle. The desktop opener already isolates `file://` documents from `/api` for the supported local case.

**Convert every document to PDF or images on the Host.** This requires platform-specific office software or a conversion service and temporary-artifact lifecycle, turning a read-only UI into Host document processing.

**Embed files with browser-native iframe or object elements.** Browser MIME support does not cover modern Office formats, while active SVG or future HTML support still needs a separate isolation decision.

## Verification

The assembled produced-files Web test clicks a file chip through the real client carrier and verifies one `host.openPath` request for the workspace file. Client tests pin file chips and closing-message mentions to their owner-supplied opener. Host and static checks verify that the preview RPC, schema, configuration, and generated catalogs are absent.

## Consequences

Remote or headless clients have no browser-readable path for produced files, and the Host-native opener may be unavailable to them. Reintroducing preview requires a current consumer that outweighs the client bundle and Host authorization cost, plus an explicit renderer and active-document security decision. Removing the complete capability also removes its parsers, whole-file buffering path, size configuration, unsupported-format states, and refresh lifecycle.
