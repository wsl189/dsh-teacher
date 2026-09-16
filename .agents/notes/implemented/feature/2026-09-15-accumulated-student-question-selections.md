# Agent Note: Accumulated Student Question Selections

Status: implemented

English | [中文](2026-09-15-accumulated-student-question-selections.zh.md)

> Extends the temporary-selection behavior in [Question Segmentation Workbench](2026-08-19-question-segmentation-workbench.md). Its media-root, assignment, and independent per-student document rules remain authoritative.

## Problem

Teachers select images from several folders below one student before producing one document. Replacing the entire staged selection on each save discards images selected from earlier folders, while collecting source paths alone cannot preserve an image after its original is edited or deleted.

## Decision

Temporary Save adds or refreshes independent image snapshots by assignment identity within one student. Repeated selection updates one snapshot; different files remain distinct even when their names match. Unselected staged images retain their existing bytes, and a restart preserves the collection. An empty assignment list explicitly clears that student's snapshots without modifying original images or save-history metadata.

The Host serializes saves, builds the complete candidate collection in a pending directory, and retains a backup until the document write commits. The configured aggregate-byte limit applies to retained and newly selected images together; student staging and browser-directory exports have no image-count cap. Failed validation, copying, or persistence preserves the prior selection. Version-2 manifests require unique assignment identities and safe, unique stored filenames; older or malformed records fail with guidance to clear and reselect instead of being silently overwritten.

The browser displays the student's total across folders and offers Clear staged images. Successful save, clear, or generation results invalidate older availability reads so a delayed response cannot restore an obsolete count. Word and PowerPoint each consume the naturally ordered accumulated snapshots and produce one file per eligible student; successful generation clears that student's selection.

Stored Office inputs are read and WebP-normalized one at a time, preventing selection size from multiplying active file reads and conversions. Packing and base64 transport retain the complete document in memory, so byte checks reduce resource exposure without promising that every accepted input fits available memory.

Temporary-source availability and generation resolve current student identities from roster directories without rescanning library images or homework descendants. Staged bytes remain independent of the originals, and a settings revision change still rejects the operation. Browser save conversion fills a preallocated byte array directly; iterating the binary string with `Uint8Array.from` materializes a much larger intermediate array. The save dialog retains only failed artifacts after partial writes, aborts errored writable streams, and releases busy controls after rejected requests. Separate progress labels identify staging, generation, destination selection, and writing.

Office saving uses the composed Host directory picker and a dedicated authenticated Remote write. The picker targets the computer running DSH, which the in-app title states explicitly; it cannot choose a directory on a different browser computer. The Host accepts absolute existing directories and canonical Office bytes, preserves directory whitespace, and exclusively creates collision-suffixed files. The browser sends one retained artifact per request and removes only successfully written artifacts from retry. The completed path is reported after the file is flushed and closed. Browser-only compositions retain File System Access saving without an automatic download fallback. This separates document generation from browser directory-write permissions without widening browser permissions.

## Alternatives considered

**Fixed image-count cap.** A count treats many small question crops like the same number of large scans, rejecting otherwise affordable selections without measuring their memory cost. Existing byte checks remain authoritative, and the browser submits every selected directory image instead of truncating the list.

**Deduplicate by filename.** Separate homework folders commonly reuse question filenames, so names cannot identify the selected image.

**Append every save without identity.** Selecting a parent after one of its children would duplicate their shared images.

**Re-read all selected originals.** Edits, deletions, or missing source files would change or invalidate snapshots that were already saved successfully.

## Consequences

Teachers can assemble one document through several folder visits. Clearing and generating affect only the selected student's temporary collection. Existing version-1 temporary records require explicit clearing and reselection; source images and durable workbench records remain unchanged.

## Testing

The assembled save scenario selects an actual Host directory containing spaces through the in-app picker. It cancels once, removes the selected directory to force a real write failure, recreates it, and retries without regenerating. Files read from that directory contain all 124 Word images and 124 PowerPoint slides; a pre-existing same-named document remains unchanged.

Host regressions cover cross-folder accumulation, repeated selection, distinct same-named files, source deletion, restart recovery, concurrent saves, student isolation, clearing, Office image counts, complete-collection byte limits, 500-image Word and PowerPoint exports, missing snapshot bytes, and invalid manifests. Client coverage verifies the accumulated count, clearing, and rejection of delayed availability results. The assembled browser scenario reloads a staged subtree, adds a sibling folder, generates a 124-image Word file and 124-slide PowerPoint, and verifies clearing without removing originals. The same scenario retains the one-active-picker and cancellation checks. Browser-folder regressions verify that all 121 selected images reach both Office formats. These small-image fixtures verify completeness, not a hardware-independent capacity bound. Additional regressions cover an unavailable unrelated library, rejected staging and generation requests, partial-write retries, and byte-complete saving of an 8 MiB artifact. Client tests cover pending writes and duplicate clicks; the browser scenario covers destination selection, real write failure, and successful retry.
