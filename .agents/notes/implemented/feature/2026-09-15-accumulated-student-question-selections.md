# Agent Note: Accumulated Student Question Selections

Status: implemented

English | [中文](2026-09-15-accumulated-student-question-selections.zh.md)

> Extends the temporary-selection behavior in [Question Segmentation Workbench](2026-08-19-question-segmentation-workbench.md). Its media-root, assignment, and independent per-student document rules remain authoritative.

## Problem

Teachers select images from several folders below one student before producing one document. Replacing the entire staged selection on each save discards images selected from earlier folders, while collecting source paths alone cannot preserve an image after its original is edited or deleted.

## Decision

Temporary Save adds or refreshes independent image snapshots by assignment identity within one student. Repeated selection updates one snapshot; different files remain distinct even when their names match. Unselected staged images retain their existing bytes, and a restart preserves the collection. An empty assignment list explicitly clears that student's snapshots without modifying original images or save-history metadata.

The Host serializes saves, builds the complete candidate collection in a pending directory, and retains a backup until the document write commits. The 120-image limit and configured aggregate-byte limit apply to retained and newly selected images together. Failed validation, copying, or persistence preserves the prior selection. Version-2 manifests require unique assignment identities and safe, unique stored filenames; older or malformed records fail with guidance to clear and reselect instead of being silently overwritten.

The browser displays the student's total across folders and offers Clear staged images. Successful save, clear, or generation results invalidate older availability reads so a delayed response cannot restore an obsolete count. Word and PowerPoint each consume the naturally ordered accumulated snapshots and produce one file per eligible student; successful generation clears that student's selection.

## Alternatives considered

**Deduplicate by filename.** Separate homework folders commonly reuse question filenames, so names cannot identify the selected image.

**Append every save without identity.** Selecting a parent after one of its children would duplicate their shared images.

**Re-read all selected originals.** Edits, deletions, or missing source files would change or invalidate snapshots that were already saved successfully.

## Consequences

Teachers can assemble one document through several folder visits. Clearing and generating affect only the selected student's temporary collection. Existing version-1 temporary records require explicit clearing and reselection; source images and durable workbench records remain unchanged.

## Testing

Host regressions cover cross-folder accumulation, repeated selection, distinct same-named files, source deletion, restart recovery, concurrent saves, student isolation, clearing, Office image counts, complete-collection limits, missing snapshot bytes, and invalid manifests. Client coverage verifies the accumulated count, clearing, and rejection of delayed availability results. The assembled browser scenario reloads a staged subtree, adds a sibling folder, generates a four-image Word file and four-slide PowerPoint, and verifies clearing without removing originals. The same scenario retains the one-active-picker and cancellation checks.
