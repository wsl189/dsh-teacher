# Agent Note: Teacher workbench daily ledger

Status: implemented

English | [中文](2026-08-20-teacher-workbench-ledger.zh.md)

## Problem

Daily Management had task, note, and calendar storage but no place for recurring household expenses such as insurance premiums and utility bills. Reusing quick notes would lose category ownership, exact currency values, and the occurrence time needed to review those expenses.

## Decision

The version-7 `teacher_workbench` document owns separate `ledgerCategories` and `ledgerEntries` collections. Each entry references one category, stores a teacher-authored description, a required local `YYYY-MM-DDTHH:mm` value, and a non-negative CNY amount in integer cents. The Host schema rejects duplicate category names after NFKC and case normalization, duplicate identities, orphan entries, invalid times, and non-integer or negative amounts.

Daily Management renders Quick Notes, Ledger, and Calendar as three equal cards. Selecting the compact Ledger card opens a full-board category view. Users can add and delete categories, create entries inside each category through manual or browser-native voice input, set amount and occurrence time, and edit or delete existing entries. Deleting a category removes that category and every owned entry in one compare-and-set document mutation.

Fresh documents include deletable Insurance Premiums, Utilities, and Other Ledger categories. Existing version-6 media is rejected by the storage-domain version check under the repository's pre-release format policy.

## Alternatives considered

**Store ledger rows as quick notes.** This would reuse one data type but would require parsing category, amount, and time from prose, preventing exact totals and referential validation.

**Store decimal currency values.** JavaScript floating-point values can introduce rounding differences across repeated edits and totals. Integer cents keep the durable value and summary calculation exact.

**Keep categories only in browser state.** Category deletion and cross-window edits would not participate in the workbench revision, and durable entries could outlive their visible owner.

## Consequences

Ledger edits use the same whole-document compare-and-set path as other workbench data, so cross-window conflicts remain explicit and category deletion is atomic with entry removal. CNY is the only presented currency, amounts cannot be negative, and every entry requires a local occurrence time. The schema change increments the domain format from 6 to 7 and intentionally rejects older pre-release storage rather than migrating it.

Focused Host, controller, and component tests pin schema validation, immutable publication, category cascade deletion, integer-cent conversion, compact expansion, voice entry, time selection, and entry editing. The keyless Web snapshot creates a category and timed entry through the shipped application, checks the durable Host state, and verifies the compact summary after reload.
