# Agent Note: Readable question-image file names

Status: implemented

English | [中文](2026-09-06-readable-question-image-file-names.zh.md)

## Problem

Question crops carried readable metadata such as `第1题.png`, but durable batch persistence and metadata-backed student assignment wrote the physical files under generated ids. The app therefore showed the expected question numbers while the same directories exposed opaque names to teachers. Filesystem-discovered assignment already preserved readable names, so the result also depended on whether the source and destination had durable metadata.

## Decision

The validated display file name is also the physical file name for every newly persisted crop and student copy. All save and assignment paths share one exclusive name-allocation rule; batch files enter the selected directory as complete hard links from their same-root pending files, while assignments use exclusive copies. When the preferred name is already present or reserved by an existing durable image in the same library directory, the Host appends the first available numeric suffix before the extension. The selected name is stored in metadata and in the assignment relative path, so app presentation and direct filesystem access describe the same file.

Opaque ids remain record identities, not storage names. Batch reads and current-root discovery first resolve the readable name and then accept the former id-based name for records written before this change. This compatibility lookup does not rename or overwrite existing files. This decision supersedes only the physical opaque-name statements in the original [Question Segmentation Workbench](../feature/2026-08-19-question-segmentation-workbench.md); that note continues to own the media hierarchy and lifecycle.

## Alternatives considered

**Rename only student copies.** Teachers also open the question-library directory directly, and leaving batch crops opaque would preserve the same mismatch at the source.

**Rename existing files during startup.** Bulk mutation can conflict with files added outside the app and makes startup responsible for a potentially large migration. A read fallback preserves access without changing existing directories.

**Reuse the readable name and replace an existing file.** Repeated assignment and several batches in one directory are valid workflows. Replacement would silently destroy an earlier crop, so name allocation uses exclusive creation.

## Consequences

New library and student files remain understandable outside the app. Repeated copies receive `-2`, `-3`, and later suffixes, and the app shows the exact selected name. Existing id-named files continue to support read, edit, discovery, and deletion, while they keep their current names until the teacher replaces or re-saves them.

This note remains active because future media persistence and migration work must preserve the equality between visible and physical names, exclusive no-overwrite behavior, and legacy lookup order. The active-note audit found no broader record superseded by this focused storage rule.

## Testing

The Host integration saves one batch with questions 1, 2, and 10 and asserts those exact names in the physical library directory. It assigns the images twice, requires the second question-1 copy to use `第1题-2.png`, and verifies every student file name. It then renames one source file to the former opaque-id form and proves that direct reading and current-root discovery still retain the image.
