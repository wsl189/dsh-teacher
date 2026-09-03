# Agent Note: Background question-cutting queue

Status: implemented

English | [中文](2026-08-24-background-question-cutting-queue.zh.md)

## Problem

PDF extraction, semantic segmentation, crop rendering, and persistence were owned by the mounted Question Cutting component. The upload action stayed blocked until that complete pipeline settled, so a teacher could not submit another PDF. Leaving the module removed the only progress view and left a later mount unable to observe the accepted work.

Question cutting also depends on a browser-held `File`, PDF.js, canvas rendering, the current parent Session, the selected directory, and the settings visible at acceptance time. A navigation-safe design must preserve those values without allowing a later Session or changed UI selection to reroute an existing task.

## Decision

The client plugin owns one `QuestionCuttingController` for its complete lifetime. The controller is a React-compatible observable with immutable rows in upload order. Enqueueing captures the browser `File`, selected pages, destination, render settings, page-range reasoning choice, and segmentation and crop-review runners already bound to the current parent Session and that reasoning choice. Each runner includes the captured choice in every Host request, where it overrides the mutable plugin default for the complete boundary, visual-review, and repair stage. The mounted component only submits requests and projects the observable; mounting and unmounting do not own worker execution.

One sequential worker drains accepted PDFs. Extraction, segmentation, rendering, and saving publish monotonic integer progress across named stages, together with saved-image count and terminal diagnostics. A queued row keeps a zero elapsed timer; the center workspace derives active and terminal elapsed time from worker-start and terminal timestamps. Confirming the page-range sheet clears the local selection immediately, so another PDF can be read and enqueued while the active row continues and later rows remain visible as queued.

Large sources use a memory-bounded path. A PDF above the OCR provider's per-file limit is opened through a temporary Blob URL instead of copied into one JavaScript `ArrayBuffer`; one reusable PDF.js document rasterizes selected pages into individual OCR requests and releases each page canvas immediately. Semantic boundary detection consumes OCR geometry without retaining full-document Base64 page previews. A second reusable PDF.js document then reviews, renders, partitions, and durably appends one semantic group at a time. Only the current group's inspection pages and crops stay live, and its progress row exposes completed versus total groups.

Plugin disposal stops admission, drops work that has not started, removes observers, and waits for the active task to settle before the controller is released. The queue and browser-held source files are intentionally not durable across a full page reload or application shutdown; committed image parts remain Host-owned durable data.

## Alternatives considered

**Keep the queue in component state or a component ref.** This permits repeated uploads only while the same component remains mounted. Module and Session navigation would still discard ownership and progress projection.

**Make every cut a durable Host job.** This would require a new upload and recovery protocol for the complete source PDF or moving the PDF.js and canvas crop pipeline out of the browser. The requested lifetime is navigation within the running Web plugin, so that larger capability is reserved for a future requirement to survive reloads or process exit.

**Run every accepted PDF concurrently.** Concurrent PDF.js rasterization, OCR requests, semantic children, and document mutations increase memory use and contention. Sequential execution still permits continuous submission and gives each queued row an explicit position without weakening unrelated workbench operations.

## Consequences

Switching workbench modules or conversations does not cancel, hide permanently, or reroute accepted cuts. Returning to Question Cutting observes the same rows, percentages, group counters, and timers. Consecutive PDFs may use different reasoning choices; changing the persisted default affects only later page-range panels and cannot change an accepted task or one of its later review stages. A large upload queue retains its source `File` objects in browser memory and executes one PDF at a time, while image memory for the active PDF is bounded to one semantic group. Each completed non-empty group is committed before the next group begins, so a later failure does not discard earlier saved images. Terminal rows remain visible for the current plugin lifetime, while a full reload starts with an empty queue.

## Testing

Controller coverage holds the first extraction open, accepts a second PDF with the opposite reasoning choice, verifies that both resolver pairs receive their own immutable value, removes the subscriber, and confirms sequential settlement. It also verifies that one failed PDF does not block the next task and that semantic groups are reviewed and saved sequentially through one disposable rasterizer. Raster coverage verifies Blob-URL loading without a source byte copy, per-page OCR streaming for an over-limit source, provider-sized PDF batches for smaller sources, and canvas-backed crop rendering. Component coverage fixes the central percentage, group count, stage, and elapsed-time projection and verifies that confirming a destination includes the selected reasoning value without disabling the next upload. Host coverage verifies that explicit segmentation and review values override the configured default. The assembled Web scenario holds the real MinerU response, submits two PDFs, records both progress rows, switches modules and conversations, and confirms the rows remain attached to the running plugin.
