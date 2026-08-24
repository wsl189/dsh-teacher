# Agent Note: Physical-only question-library tree

Status: implemented

English | [中文](2026-08-24-physical-only-question-library-tree.zh.md)

## Problem

Question crops are direct files in the selected library directory, but the Web hierarchy rendered each durable paper batch as another child row named after its PDF. The row looked and behaved like a directory even though no corresponding path existed on disk. Folding only a filesystem-derived batch whose name matched its directory did not cover durable uploads or several PDFs saved into one directory.

## Decision

The Question Cutting library hierarchy contains only physical directory identities. Durable and filesystem-derived folders remain ordinary rows, and direct images below the configured library root use one explicit Question-library root row. A paper batch never creates a hierarchy node.

A Web upload whose save-directory control remains blank may create a PDF-named root folder, but that row represents the physical folder and its durable identity rather than the paper batch. The [optional question-save directory](../feature/2026-08-24-optional-question-save-directory.md) decision owns when that directory is created.

Each directory row owns every durable or filesystem-derived batch whose images are stored directly in that directory. Selecting the row opens one flat image drawer containing all of those images; the disclosure control continues to represent physical child directories only. Per-batch metadata still owns continuation saves, image mutability, assignment eligibility, and Host deletion, but it is not a directory presentation concept. This presentation rule supersedes the standalone-batch rows described by the original [Question Segmentation Workbench](../feature/2026-08-19-question-segmentation-workbench.md) decision.

## Alternatives considered

**Fold only one matching batch.** This removes duplicate rows for a scanned image-only directory but preserves the false PDF child for durable uploads, differently named external files, and every directory containing more than one batch.

**Create a PDF-named child below every selected destination.** This would keep the hierarchy truthful but would prevent several uploads from sharing one chosen leaf directory. PDF-named physical folders are therefore limited to Web uploads whose save-directory control remains blank.

**Hide batch rows and open only the newest batch.** This keeps the tree physical but makes older images in the same directory unreachable. Directory selection therefore aggregates every direct batch instead.

## Consequences

Directory names and counts match the filesystem tree, including the configured root. Uploading one or several PDFs into an explicitly selected directory changes that directory's image count without adding PDF-named children; an automatic PDF-named row appears only because the matching physical folder exists. Batch-wide deletion is no longer a directory-row action; individual image deletion remains in the Web UI, while the Host and model-facing operation retain exact batch deletion. Deleting a physical directory recursively removes its subtree, owned batches, and dependent student copies; it never reparents images into the configured root or another parent directory.

## Testing

The client regression mounts two durable PDF batches in one folder, asserts that neither batch name appears in the hierarchy, and opens both images through the folder row. The assembled Web scenario saves a durable batch into a nested physical directory, proves that no PDF-name or batch-id directory exists, waits for the same directory row to report the image, and opens it without a batch child.
