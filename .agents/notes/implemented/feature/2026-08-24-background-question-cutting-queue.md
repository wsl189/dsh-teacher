# Agent Note: Background question-cutting queue

Status: implemented

English | [中文](2026-08-24-background-question-cutting-queue.zh.md)

## Problem

PDF extraction, semantic segmentation, crop rendering, and persistence were owned by the mounted Question Cutting component. The upload action stayed blocked until that complete pipeline settled, so a teacher could not submit another PDF. Leaving the module removed the only progress view and left a later mount unable to observe the accepted work.

Question cutting also depends on a browser-held `File`, PDF.js, canvas rendering, the current parent Session, the selected directory, and the settings visible at acceptance time. A navigation-safe design must preserve those values without allowing a later Session or changed UI selection to reroute an existing task.

## Decision

The client plugin owns one `QuestionCuttingController` for its complete lifetime. The controller is a React-compatible observable with immutable rows in upload order. Enqueueing captures the browser `File`, selected pages, destination, render settings, and a segmentation runner already bound to the current parent Session. The mounted component only submits requests and projects the observable; mounting and unmounting do not own worker execution.

One sequential worker drains accepted PDFs. Extraction, segmentation, rendering, and saving publish monotonic integer progress across named stages, together with saved-image count and terminal diagnostics. A queued row keeps a zero elapsed timer; the center workspace derives active and terminal elapsed time from worker-start and terminal timestamps. Confirming the page-range sheet clears the local selection immediately, so another PDF can be read and enqueued while the active row continues and later rows remain visible as queued.

Plugin disposal stops admission, drops work that has not started, removes observers, and waits for the active task to settle before the controller is released. The queue and browser-held source files are intentionally not durable across a full page reload or application shutdown; committed image parts remain Host-owned durable data.

## Alternatives considered

**Keep the queue in component state or a component ref.** This permits repeated uploads only while the same component remains mounted. Module and Session navigation would still discard ownership and progress projection.

**Make every cut a durable Host job.** This would require a new upload and recovery protocol for the complete source PDF or moving the PDF.js and canvas crop pipeline out of the browser. The requested lifetime is navigation within the running Web plugin, so that larger capability is reserved for a future requirement to survive reloads or process exit.

**Run every accepted PDF concurrently.** Concurrent PDF.js rasterization, OCR requests, semantic children, and document mutations increase memory use and contention. Sequential execution still permits continuous submission and gives each queued row an explicit position without weakening unrelated workbench operations.

## Consequences

Switching workbench modules or conversations no longer cancels, hides permanently, or reroutes accepted cuts. Returning to Question Cutting observes the same rows, percentages, and timers. A large upload queue retains its source `File` objects in browser memory and executes one PDF at a time. Terminal rows remain visible for the current plugin lifetime, while a full reload starts with an empty queue.

## Testing

Controller coverage holds the first extraction open, accepts a second PDF, verifies sequential execution, removes the subscriber, and confirms both tasks still settle. It also verifies that one failed PDF does not block the next task. Component coverage fixes the central percentage, stage, and elapsed-time projection and verifies that confirming a destination enqueues without disabling the next upload. The assembled Web scenario holds the real MinerU response, submits two PDFs, records both progress rows, switches modules and conversations, and confirms the rows remain attached to the running plugin.
