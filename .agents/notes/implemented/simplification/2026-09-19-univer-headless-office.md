# Agent Note: Ship Univer content tools without its visual interface

Status: implemented

English | [中文](2026-09-19-univer-headless-office.zh.md)

## Problem

Chat Office tasks open Univer worktree windows and expose configuration unrelated to the requested files. DSH already provides final-file previews in its document sidebar. The Gateway also retains database handles after tool completion, preventing Windows from removing temporary projects while the application remains open.

## Decision

The [headless repack](../../../../third-party/README.md#artifact-notes) removes the Univer Client entry, settings registration, live-preview and review routes, Viewer assets, and their Host state caches. AI content tools, isolated editing worktrees, import/export, and background rendering remain available. DSH's separate Office sidebar renderer remains mounted. Ordinary Office delivery publishes verified files without the two ready/status handoff calls; a requested retained native project can still use review states through tools.

The Gateway exposes JSON health and directory-release operations. The [Office workspace owner](../../../../packages/deliverables/office-workspace/README.md) emits its awaited release event only after validating the managed directory identity. Release closes cached databases within that directory without deleting files; active HTTP operations or collaboration connections reject release. HTTP activity includes the SDK's asynchronous body reading and response processing. The whole directory remains closed to new operations until its cached databases finish closing. A released project can be reopened for further editing. Publication and removal wait for release, failures preserve the source, and independent projects continue cleaning.

This partially supersedes the [Viewer evaluation decision](../bug-fix/2026-09-01-univer-viewer-evaluation.md): its license, watermark, and evaluation-limit rules remain authoritative. The [generation performance decision](../bug-fix/2026-09-16-office-generation-overhead.md) retains batching, compile caching, and verification. Workbench functions, model settings, and other bundled plugins retain their behavior.

## Alternatives considered

**Default the automatic-window preference off.** This leaves the preview code, routes, configuration card, and manual windows available. The requested distribution removes that interface.

**Remove the background renderer.** Screenshots, Slide compilation metrics, and PDF export require it. Removing these operations would weaken AI editing and verification.

**Remove temporary directories before the agent stops.** Stop listeners can enqueue more work in the same turn. Cleanup belongs to explicit finalization and completed-turn lifecycle handling; paused projects remain available.

## Consequences

Users edit through AI tools and open exported files through DSH or their default application. Interactive native Univer review is unavailable. Removing browser code does not eliminate model reasoning, worker startup, or document rendering costs. The release operation protects active projects instead of forcing deletion; crashes and unclosed external authoring processes can still leave recoverable directories. Historical directories are not scanned for deletion.

## Measurements and verification

The existing [built-worker diagnostic](../../../../packages/bundle/web-app/tests/univer-generation.perf.ts) runs sequentially under Linux x64 Node 24.14.0 with a fresh private cache per invocation and three samples per format. Workloads are 20 document paragraphs, 200 × 8 cells with 200 formulas, and three native-text slides. Each sample includes grouped writing, independent readback, export, and ZIP-content validation. Model calls, UI loading, screenshots, and Gateway startup are excluded. No memory or end-to-end chat latency improvement is claimed.

| Workload | Before samples, ms | After samples, ms | Before/after median, ms |
|---|---|---|---|
| DOCX | 2974.48, 2601.43, 2634.26 | 3051.09, 2697.53, 2634.06 | 2634.26 / 2697.53 |
| XLSX | 1727.75, 1717.40, 1709.51 | 1790.01, 1746.65, 1730.58 | 1717.40 / 1746.65 |
| PPTX | 2612.56, 2622.33, 2632.11 | 2653.96, 2650.26, 2657.68 | 2622.33 / 2653.96 |

Gateway startup is 1024.59 ms before and 1020.57 ms after. The 1–2.4% higher content medians provide no evidence of faster workers. The change removes UI work and unnecessary handoff calls rather than claiming an engine speedup. Browser regressions assert absent Univer requests and windows while the independent Office preview scenarios exercise DOCX, XLSX, and PPTX rendering. Real generation scenarios check release rejection for a connected project and an incomplete SDK request, persisted content after reopening, final-file publication, and directory removal. A deferred database close verifies that other files in the same directory cannot open or be created until release finishes. Recorded skill instructions pin the file handoff workflow.
