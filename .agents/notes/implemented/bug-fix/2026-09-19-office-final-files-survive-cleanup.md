# Agent Note: Preserve Office final files before cleanup

Status: implemented

English | [中文](2026-09-19-office-final-files-survive-cleanup.zh.md)

## Problem

Managed Office exports share a temporary directory with their source projects. A model can omit `office_workspace finish` or present the temporary file directly. Unconditional cleanup then deletes the only exported copy and leaves a delivery card pointing at a missing file. Requiring another model instruction does not make deletion safe.

## Decision

The [Office workspace owner](../../../../packages/deliverables/office-workspace/README.md) publishes files selected by `present` before the tool validates and records their final paths. The `deliverables/prepare` waterfall belongs to [tool-present](../../../../packages/deliverables/tool-present/README.md); it preserves ordinary source-file delivery and lets the temporary owner provide durable workspace paths. Successful automatic publication removes only the selected temporary sources, so separate delivery calls can still publish other files from the same project.

Automatic cleanup recovers remaining non-empty DOCX, XLSX, and PPTX files inside the allocated directory before removing intermediates. It neither follows input links nor scans unrelated workspace files. Destinations use the original basename and numeric suffixes for conflicts, with exclusive publication enforcing the same rule under concurrency. Failed publication retains the source directory. Explicit `finish` remains authoritative for the selected final set; explicit `discard` abandons drafts.

This partially supersedes unconditional expiration in the [generation cleanup decision](../feature/2026-09-19-office-generation-cleanup.md). That note still owns temporary-directory allocation, scoped Univer output guards, confirmation pauses, and sandbox-compatible placement.

## Alternatives considered

**Require the model to remember finalization.** Tool and skill instructions help choose final files but cannot justify deleting the only export when a step is missed or the turn is interrupted.

**Keep every project indefinitely.** This prevents loss but leaves the scripts, screenshots, and native project files that users asked to remove. Recovery keeps recognizable Office exports; explicitly selected PDF or native files use `present` or `finish`.

**Copy files but keep temporary delivery paths.** The file card would still break after cleanup. The successful tool result and `deliverables/presented` event both contain the published paths.

## Consequences

Normal finalization leaves only the selected deliverables. Recovery can retain unfinished Office exports or input copies inside a project; retaining their bytes takes priority over classifying their quality. It does not claim that recovered documents passed content or visual checks. A publication failure or abrupt process loss can leave temporary files for recovery; startup does not delete another process's directories. Existing workspace files are never overwritten.

## Verification

Focused tests cover completed, canceled, and failed turns; separate presentations; paused projects; read-only policy; publication failure; conflicting names; concurrent publishers; and disposal. Negative controls run the preservation tests against unconditional cleanup and observe the missing exports. Real Web composition tests preserve DOCX, XLSX, and PPTX export bytes after turn cleanup and assert durable delivery paths outside temporary storage. Recorded skill instructions pin the model-facing final-file publication guidance.
