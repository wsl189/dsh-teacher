# Agent Note: Physical-only question-library tree

English | [中文](2026-08-24-physical-only-question-library-tree.zh.md)

Status: implemented

## Problem

Question crops are direct files in the selected library directory, but the Web hierarchy rendered each durable paper batch as another child row named after its PDF. The row looked and behaved like a directory even though no corresponding path existed on disk. Folding only a filesystem-derived batch whose name matched its directory did not cover durable uploads or several PDFs saved into one directory.

## Decision

The Question Cutting library hierarchy contains only physical directory identities. Durable and filesystem-derived folders remain ordinary rows, and direct images below the configured library root use one explicit Question-library root row. A paper batch never creates a hierarchy node.

Each directory row owns every durable or filesystem-derived batch whose images are stored directly in that directory. Selecting the row opens one flat image drawer containing all of those images; the disclosure control continues to represent physical child directories only. Per-batch metadata still owns continuation saves, image mutability, assignment eligibility, and Host deletion, but it is not a directory presentation concept. This presentation rule supersedes the standalone-batch rows described by the original [Question Segmentation Workbench](../feature/2026-08-19-question-segmentation-workbench.md) decision.

## Alternatives considered

**Fold only one matching batch.** This removes duplicate rows for a scanned image-only directory but preserves the false PDF child for durable uploads, differently named external files, and every directory containing more than one batch.

**Create a physical PDF-named directory.** This would make the old hierarchy truthful but would reverse direct-to-selected-directory storage and prevent several uploads from sharing one chosen directory.

**Hide batch rows and open only the newest batch.** This keeps the tree physical but makes older images in the same directory unreachable. Directory selection therefore aggregates every direct batch instead.

## Consequences

Directory names and counts match the filesystem tree, including the configured root. Uploading one or several PDFs into a selected directory changes that directory's image count without adding PDF-named children. Batch-wide deletion is no longer a directory-row action; individual image and physical-directory deletion remain in the Web UI, while the Host and model-facing operation retain exact batch deletion.

## Testing

The client regression mounts two durable PDF batches in one folder, asserts that neither batch name appears in the hierarchy, and opens both images through the folder row. The assembled Web scenario saves a durable batch into a nested physical directory, proves that no PDF-name or batch-id directory exists, waits for the same directory row to report the image, and opens it without a batch child.
