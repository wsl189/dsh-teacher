# Agent Note: in-product previews for produced files

Status: implemented

English | [中文](2026-08-22-web-produced-file-preview.zh.md)

## Problem

The produced-files row identifies what an agent created or changed, but inspecting a file required a working native desktop opener. That excludes headless and remote Hosts, interrupts transcript reading, and gives no common experience across document types. Letting the browser navigate directly to an agent-written document would also execute active content near the harness API unless the document received an isolation model that breaks many ordinary pages.

## Decision

**A produced file opens in the resident details column.** The conversation package owns the mutually exclusive per-session selection and declares `conversation.details.file`; the deliverables package registers the renderer and changes both produced-file chips and matching final-response mentions to call `previewFile(path)`. Tool-call selection remains on `conversation.details.tool`, native Tool-row file actions remain unchanged, and every preview retains **Open in system app**. The preview and native-open paths are separate actions because they have different availability and security requirements.

**The Host returns bounded data, never an executable workspace URL.** `session.previewFile` derives the workspace root from the addressed Session, resolves the root and requested path through `ctx.fs`, verifies canonical containment after symlink resolution, and reads a complete regular file through the filesystem service's byte limit. The JSON response carries Base64 and the byte count. `previewFileMaxBytes` defaults to 40 MiB, zero disables the endpoint, and oversized files fail without returning a prefix. Cancellation reaches the filesystem read. The Host does not infer MIME types or choose a renderer.

**The client selects a renderer by a closed extension table.** PDF uses PDF.js with page controls; PPTX uses Office Kit and sanitized SVG; DOCX uses docx-preview; XLSX and XLSM use Office Kit with sheet tabs and at most 200 rows by 50 columns; Markdown uses the existing sanitized Markdown renderer; AVIF, BMP, GIF, JPEG, PNG, SVG, and WebP use Blob URLs. Legacy `.ppt`, `.doc`, and `.xls` files are unsupported because they are binary formats outside these parsers. Unsupported files remain selectable and explain the limitation while preserving the system-application action.

**Preview is a snapshot, not a filesystem subscription.** Selecting a supported file performs one read, switching files aborts the obsolete request, and Refresh performs a new read. Renderer failures stay inside the panel with Retry; they do not close the details column or fall through to executing the file.

The [native workspace file decision](2026-07-31-web-workspace-file-links.md) remains authoritative for Tool-row paths, **Show in folder**, and system-application handoff. This decision partially supersedes only its no-preview scope.

## Alternatives considered

- **Keep native opening as the only path** — preserves full application fidelity but excludes deployments without a visible Host desktop and forces users out of the conversation for formats the browser can read safely.
- **Serve workspace files as browser documents** — gives HTML and related assets native browser behavior, but same-origin serving exposes the harness API and sandboxed serving breaks legitimate script and storage behavior. A second origin adds a listener and an active-document security surface. Data-only renderers cover the requested document formats without executing the workspace file.
- **Convert every document to PDF or images on the Host** — could improve consistency and keep parser weight out of the browser, but requires platform-specific office software or a new conversion service, adds temporary artifact lifecycle, and turns a read-only UI feature into Host document processing.
- **Embed every file in an iframe or object element** — relies on browser MIME support that does not cover modern Office formats, and active SVG or future HTML support would require a separate isolation decision. Specialized renderers make the supported set explicit.

## Consequences

The dynamic deliverables client bundle carries the document parsers and is approximately 4.5 MB before compression. Office fidelity is a reading aid rather than a replacement for PowerPoint, Word, or Excel: complex layout, fonts, formulas, animations, and macros can differ or be omitted. The bounded workbook table and whole-file RPC cap memory growth, but a permitted file is still held as Base64, decoded bytes, and parser state in the browser. Remote connected clients can receive preview bytes even when native opening is unavailable; endpoint exposure therefore follows the existing API carrier trust policy. Unit coverage pins extension routing, Base64 decoding, refresh, unsupported fallback, filesystem containment, symlink escape, size limits, disablement, schemas, and transport. The assembled Web snapshot pins a produced Markdown chip opening the right-panel preview through the real RPC path.
