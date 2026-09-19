# Agent Note: Clean intermediate Office generation files

Status: implemented

English | [中文](2026-09-19-office-generation-cleanup.zh.md)

## Problem

Chat Office generation leaves reusable scripts, screenshots, Univer documents, and PPT Master projects in the session workspace. When that workspace is the Desktop, internal authoring artifacts appear beside final documents. Removing files by common names or extensions risks deleting user files or another active task's work.

## Decision

The [Office workspace plugin](../../../../packages/deliverables/office-workspace/README.md) allocates a private directory per generation and records its owning session and turn in memory. Univer, PPT Master, and the bundled Python Office workflows place intermediate files there. Checked final files are explicitly published before directory cleanup. Publication refuses existing destinations and removes only copies created by a failed publication attempt.

A monotonic tool guard requires new Univer projects and output files to stay in an active directory owned by the calling session and turn. Existing ancestors resolve through symlinks before checking containment and the allocation's filesystem identity. This also covers direct calls and old sessions with previously loaded instructions. Existing native projects remain editable, and explicit `.univer` deliverables use the same publication operation as Office files.

Unfinished directories expire when their turn ends, including cancellation and errors. A workflow awaiting user confirmation calls `pause` before a normal turn ending and `resume` before the next turn continues its project. Session and plugin disposal also join queued cleanup. Original user inputs stay outside temporary storage. Explicit pauses preserve multi-stage PPT planning without retaining every forgotten draft indefinitely.

The [generation performance decision](../bug-fix/2026-09-16-office-generation-overhead.md) retains grouped authoring, independent readback, compile caching, and workspace-local sharing across sandbox calls. This decision narrows shared workspace placement to an owned temporary directory and governs cleanup. Upstream PPT Master assets and attribution checks remain intact.

## Alternatives considered

**Only tell the model to delete files.** Instructions alone leave deletion, path ownership, and partial publication to generated shell scripts. A model can omit the skill or retain older instructions. The shared tool executes publication and cleanup for all three formats, and Univer output calls enforce placement before creating files.

**Delete familiar filenames or extensions.** Names such as `author.js`, `screens`, and `.univer` do not establish ownership. The plugin never discovers deletion candidates that way.

**Use a shared system temporary directory.** Some sandboxed commands receive isolated temporary mounts, so Host tools and command tools may not see the same files. A private directory inside the session workspace is accessible under workspace-write.

## Consequences

Finalization adds short tool calls but does not remove content or visual verification. Concurrent sessions receive separate directories, existing destinations remain intact, and final files contain independent copies. Cancellation and application shutdown lose unfinished drafts; confirmation pauses survive only while the owning session stays loaded. Abrupt application crashes and scripts that ignore the allocated path can still leave residue; automatic startup scans are excluded because another live process may own those files.

## Verification

Focused filesystem tests cover all three final extensions, conflicting destinations, concurrent publication, cancellation, source containment, directory replacement, and junction cleanup. Tool tests cover turn expiration, output ownership, policy denial, and disposal. The shipped Web composition generates real DOCX, XLSX, and PPTX files and verifies that final bytes survive removal of source projects, scripts, and screenshots; requested native projects remain editable after publication. Recorded sessions pin skill instructions and output denial messages, with an empty-workspace oracle for rejected loose outputs.
