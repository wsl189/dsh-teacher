# Agent Note: Durable headteacher workbench modules

Status: implemented

English | [中文](2026-08-22-headteacher-workbench-modules.zh.md)

## Problem

The Headteacher group exposed Family Communication, Class Records, Talk Records, Seating, and Class Summary as navigation entries without complete workspaces. Teachers could not draft reusable family notices, keep the three kinds of follow-up records, or arrange a class roster without leaving dsh, and browser-only implementations would lose that work on reload or conflict silently across windows.

## Decision

The version-8 `teacher_workbench` document owns `noticeTemplates`, `notices`, and `seatingLayouts`, and extends reusable record-template kinds with `class`, `talk`, and `summary`. Family Communication starts with eight editable school-scene templates, generates a teacher-editable WeChat draft from explicit audience, time, facts, and signature fields, and persists saved drafts for reuse. The generated draft includes privacy and fact-check reminders and is never sent automatically.

Class Records, Talk Records, and Class Summary share one record implementation while filtering independent template families. Each family starts with three school-practice templates and supports template creation, editing, copying, deletion, record creation, follow-up dates, status changes, and later editing. Shared storage and UI code do not merge the three visible libraries or their records.

Seating reuses roster classes and students, accepts a roster through the shared document-extraction path, supports 3–8 rows and 4–10 columns, random placement, drag-and-drop swaps, manual vacancy creation, reset, and teacher-view image export. One durable layout belongs to each roster class. The Host schema requires `rows * columns` slots, rejects students from another class and repeated occupants, removes a layout with its class, and clears a student's slot when that student is deleted.

All accepted edits use the generated `teacherWorkbench` Remote and the existing whole-document compare-and-set revision. Template selection, unsaved drafts, drag state, and open editors remain browser-local.

## Alternatives considered

**Keep the imported workbench's Local Storage model.** This would bypass the configured storage backend, cross-window conflict handling, Host schema validation, and class/student cascade rules.

**Represent notices and seats as generic records.** A notice needs reusable message text and a seating layout needs a fixed grid with student references. Encoding either as free-form record fields would make exact validation, drag updates, and image export depend on parsing prose.

**Create separate record implementations for all three families.** The edit, template, status, and follow-up behavior is identical. A shared implementation keeps those mechanics consistent while the durable kind discriminant preserves independent libraries.

## Consequences

The storage-domain format increments from 7 to 8 and intentionally rejects older pre-release media instead of migrating it. Family drafts, records, and seating survive reloads and participate in the same explicit revision conflicts as the rest of the workbench. Seating remains a teacher-controlled arrangement tool and does not infer student traits, scores, or behavior.

Focused Host, controller, and component tests cover initial templates, schema rejection, cascade behavior, mutations, notice generation, record editors, and seating persistence. A keyless Web snapshot uses the shipped Web transport to save a family notice, create one record in each family, randomize a roster-backed seating layout, reload the application, and verify the Host state.
