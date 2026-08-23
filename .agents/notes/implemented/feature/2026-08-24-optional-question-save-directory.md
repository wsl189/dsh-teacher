# Agent Note: Optional question-save directory

Status: implemented

English | [中文](2026-08-24-optional-question-save-directory.zh.md)

## Problem

The PDF page-range sheet selected the question-library root by default and exposed every directory depth. Leaving the control untouched therefore mixed unrelated papers as direct root images, while choosing an intermediate directory allowed new images beside its child hierarchy. Neither behavior distinguished an automatic per-PDF destination from an explicit organizational choice.

## Decision

The save-directory control starts unselected for every newly chosen PDF. Its explicit choices contain only durable leaf directories and display their complete hierarchy paths; the library root and directories with children are not selectable.

Omitting `folderId` for a new paper batch makes the Host derive a safe root-level folder name from the source PDF filename without its `.pdf` suffix. The Host reuses a durable root folder with that physical name or creates the durable identity and physical directory in the same rollback-capable operation as the first image part. An explicit `folderId` must identify a current leaf, and images are stored directly in that leaf. Continuation parts retain the first part's directory when they omit the field.

The automatic directory remains consistent with the [physical-only question-library tree](../bug-fix/2026-08-24-physical-only-question-library-tree.md): it appears because a physical folder exists, while the paper-batch name and id remain metadata rather than hierarchy nodes.

## Alternatives considered

**Keep the root selected by default.** This preserves direct-root storage but makes the user's inaction an organizational choice and mixes unrelated papers at the library root.

**List every directory depth.** Intermediate directories can contain both direct images and children, but selecting them weakens the leaf-oriented organization requested for new cuts.

**Always add a PDF-named child below the selected directory.** This makes explicit selection indirect and prevents several PDFs from sharing one chosen leaf. Explicit selection therefore means direct storage in that leaf.

## Consequences

An untouched upload creates a visible, real PDF-named root directory instead of root-level images. Reprocessing the same PDF name shares that directory and relies on opaque image names to avoid file collisions. Teachers who want several papers together can select one existing leaf, while adding a child makes its former parent unavailable in future save-directory lists.

## Testing

Client coverage fixes the blank default and leaf-only path list. Host integration coverage checks physical PDF-directory creation, durable identity reuse, continuation placement, selected-parent rejection, and direct leaf storage. The assembled Web snapshot opens the real page-range sheet and records the blank automatic option plus the nested leaf path without its parent.
