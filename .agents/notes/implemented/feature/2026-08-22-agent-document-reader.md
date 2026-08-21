# Agent Note: Agent document reading through OCR

Status: implemented

English | [中文](2026-08-22-agent-document-reader.zh.md)

## Problem

Conversation upload extracts documents before a user submits a prompt, but an agent can also encounter a PDF or Office file by path while working. Without a model-facing document reader, the agent can list or locate that file but cannot ask the configured OCR provider to read it. Direct Node filesystem access would bypass the session workspace resolution and filesystem provider used by the existing `read` and `read_image` tools.

The browser upload path remains necessary because local browser files do not have an agent-readable workspace path. Autonomous path-based reading is a separate Consumer of the same `ctx.ocr` capability, not a replacement for upload status, hidden prompt context, or teacher review.

## Decision

`@deepseek-ai/dsh-tool-fs` conditionally registers `read_document` while `ctx.ocr` is mounted. Its only model argument is `file_path`. The accepted extensions are PDF, DOCX, PPTX, XLSX, PNG, JPEG, WebP, BMP, and TIFF. The tool resolves relative paths against the calling session workspace through `ctx.fs`, requires a regular file, obtains the selected OCR provider's decoded-byte limit, and calls `ctx.fs.readBytes` with that limit before producing canonical base64. It then calls the same-process `OcrRuntime.extractAbortable(request, exec.signal)` operation, so cancellation reaches the selected provider.

The canonical tool value contains the backend display path, media type, provider id, reading-order Markdown, and truncation flag. Native rendering wraps the Markdown in a document envelope. A successful extraction emits `fs/observed`; unsupported formats, filesystem failures, provider-selection failures, and extraction failures remain structured tool errors. Concurrent calls are safe because they read independent immutable inputs and only update the synchronous observation recorder after success.

`read_document` belongs to the filesystem tool package because the model starts from a workspace path and must receive the same per-session resolution, regular-file validation, cancellation, observation, and read presentation intent as adjacent file readers. OCR provider selection remains in `ctx.ocr`; the tool never imports or names MinerU behavior. In the Web bundle, `ctx.ocr` explicitly selects provider id `mineru`, so every standard Web agent receives `read_document` backed by MinerU. Compositions without `ctx.ocr` receive no document tool or prompt guidance.

The existing [reusable document extraction decision](2026-08-18-reusable-document-extraction.md) continues to own browser uploads, hidden conversation context, and reviewed workbench imports. Its rejected alternative is using a model tool instead of those human intake flows; the path-based tool complements them and cannot access a browser-only `File`.

## Alternatives considered

**Let each OCR provider register its own tool.** Model-facing names and schemas would change with provider composition and would expose vendor identity where the provider-neutral service already owns selection.

**Read document bytes through Node APIs.** That would work only for local hosts and bypass `ctx.fs` path identity, remote backends, session cwd handling, typed errors, and observation policy.

**Mount `read_document` without an OCR service.** A permanently visible tool that always reports provider unavailability adds schema cost and invites failed calls in Headless or custom compositions that intentionally omit document extraction.

**Replace browser upload with `read_document`.** Browser-selected files have no workspace path, and roster, score, and calendar imports require visible extraction status and review before persistence. The model tool cannot provide those human controls.

**Create a separate `tool-ocr` package.** The current operation is exclusively a filesystem read and shares existing file-reader machinery. A separate package would duplicate that machinery without an independent input family; it remains appropriate if OCR later accepts URLs, attachment ids, or retained document handles.

## Consequences

- A Web agent can autonomously read a supported workspace document without asking the user to upload it again; changing the configured OCR provider does not change the tool schema.
- The selected OCR endpoint receives the complete file after `ctx.fs` enforces the provider-advertised byte limit. Source bytes are not persisted by the tool, while the normal durable tool call and rendered Markdown result enter the Session log.
- The provider's Markdown character limit and truncation flag bound extraction output. Later tool-result retention or conversation compaction may shorten old results, so an agent that needs durable derived facts must summarize or store them through ordinary task operations.
- Extension-based routing rejects legacy DOC/PPT/XLS, audio, video, unknown extensions, and URLs. `read_document` does not download remote resources or inspect browser-only uploads.
- The new prompt section and tool schema change the model request prefix only in scopes where `ctx.ocr` is mounted.

## Testing

OCR runtime tests pin cancellation propagation. Filesystem-tool tests pin conditional registration and disposal, supported-media routing, provider byte caps, canonical base64, MinerU-shaped success output, structured failures, and the pure read card. The generated tool catalog pins the schema. A keyless assembled snapshot mounts a deterministic OCR provider, lets the replayed model call `read_document` on a workspace PDF, and verifies the durable extracted result.
