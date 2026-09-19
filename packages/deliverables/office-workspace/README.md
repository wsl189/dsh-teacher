---
description: "Temporary Office generation directories, exclusive final-file publication, and cleanup."
kind: "package-reference"
---

# @deepseek-ai/dsh-office-workspace

English | [中文](README.zh.md)

## Summary

Word, Excel, and PowerPoint generation share a private directory for scripts, images, project files, and draft exports. After content and visual checks, `office_workspace` publishes only selected final files and removes the intermediates. The Web bundle mounts this plugin for both Univer and PPT Master; workbench exporters remain independent.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside tools, session projections, and sandbox policy. It has no configuration fields.

```yaml
- name: '@deepseek-ai/dsh-office-workspace'
```

`create` allocates a unique `.dsh-office-*` directory inside the current session workspace. `finish` copies selected regular, non-empty files to new destinations outside temporary directories, then removes the source directory. Destination parents must exist. Existing files are never replaced; failed publication retains drafts for retry during the same turn. `discard` removes an abandoned directory. All authoring and rendering processes must exit before either operation.

`pause` retains a project across a normal turn ending while the user confirms a plan; `resume` attaches it to the next turn. Other temporary directories expire at the end of their owning turn, including cancellation or error, and during session or plugin disposal. Final files must be published before ending the turn. Only allocated directories are eligible for cleanup; unrelated paths and user originals are not scanned. Workspace-write access is sufficient; read-only mode rejects tool mutations. This tool publishes inside the session workspace even in Full Access mode.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

Each session serializes workspace operations and cleanup. Directory identity checks prevent recursive removal of a replacement directory; nested symbolic links and Windows junctions are unlinked. Publication stages complete copies beside each destination and links them into place exclusively. A failed publication rolls back only the destinations it created. Final file bytes are independent of draft files.

No runtime invariant companion is published: the plugin owns one directory registry and its serialized operations; no independent service observations require reconciliation.

</details>

<a id="model-experience"></a>
## Model Experience

### office_workspace

#### What the model sees

The [tool schema](../../../docs/tool-catalog.md#office_workspace) describes creation, publication, expiration, and cleanup. Results contain `directory`, final `files`, `cleaned`, and `paused`. Source and final file contents are not included. Loaded Office and PPT Master skills direct all intermediate outputs into the allocated directory and require their normal checks before finalization.

#### Token effect

One static tool schema plus one short path result for creation and one for finalization. File count controls the final path list; file bytes do not enter the model context.

#### KV Cache effect

Tool schemas stay stable for the plugin lifetime. Tool results extend recorded history without rewriting the existing prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Models and scripts must use the allocated directory; the plugin does not scan or delete arbitrary files elsewhere.
- An abrupt process or machine crash can leave an owned directory. Startup does not guess whether another process still uses it.
- Final publication requires a local filesystem supporting hard links. Cleanup failures are reported; a replaced real directory is retained to avoid deleting another owner's files.
- Structural, mathematical, visual, and formula-result checks belong to the authoring workflow. Publication confirms file presence, not document quality.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

See the [cleanup decision](../../../.agents/notes/implemented/feature/2026-09-19-office-generation-cleanup.md) for ownership and expiration tradeoffs.

</details>
