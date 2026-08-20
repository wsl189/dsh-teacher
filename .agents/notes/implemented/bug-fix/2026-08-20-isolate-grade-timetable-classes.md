# Agent Note: Isolate Grade Timetable Classes

Status: implemented

English | [中文](2026-08-20-isolate-grade-timetable-classes.zh.md)

## Problem

Timetable OCR and manual class creation wrote every class into one shared collection. A label recognized in Grade therefore became selectable in Today, Week, Morning/Evening Study, rosters, score analysis, and Question Cutting. Structural OCR text such as a period label or combined table heading could also be treated as a class and spread through those unrelated modules.

The intended relationship is narrower. Today, Week, and Morning/Evening Study describe one ordinary timetable and may share classes. Grade imports a separate school-wide projection whose classes must remain inside Grade. Rosters, exams, and Question Cutting use a third catalog backed by enrolled students.

## Decision

Version 6 of the `teacher_workbench` document requires every `TeacherClass` to carry one `usage`: `roster`, `timetable`, or `gradeTimetable`. Today, Week, and Morning/Evening Study select only `timetable` classes; Grade selects only `gradeTimetable` classes; rosters, score analysis, and Question Cutting select only `roster` classes. The state schema rejects students and exams whose class is not in the roster catalog and rejects timetable entries whose class is in that catalog. Identical class names may have independent identities in all three catalogs.

Timetable commands resolve an existing class by usage, name, and grade. Supplying an identity from another usage cannot attach the new entry to that class. Deleting a class continues to cascade by identity, so it removes only that catalog's dependent rows.

The OCR review parser selects a recognized row only when its normalized class name ends in `班`. Raw class-column text that fails this rule is discarded rather than promoted to a durable class, and the bulk-import command repeats the validation so a caller cannot bypass the review UI. The row remains visible and editable before import.

## Alternatives considered

**Filter foreign classes only in visible menus.** Rejected because direct controller calls, teacher-wide timetable projections, and future consumers could still join entries through the shared identity. The persisted ownership and schema must express the rule.

**Tag only OCR-created Grade classes.** Rejected because manually added Grade classes would still leak, while the actual rule applies to every class owned by that view.

**Give Week and Morning/Evening Study separate catalogs.** Rejected because they are two views of the ordinary timetable. They intentionally reuse the same normal class identity; only Grade is independent.

**Accept any non-empty class label after review.** Rejected because OCR structural labels are selected by default before a teacher has a reason to inspect them. Requiring the visible `班` suffix provides a deterministic admission rule while preserving manual correction.

## Consequences

- A class with the same display name can have separate roster, normal-timetable, and grade-timetable identities and schedules.
- Grade recognition and manual Grade class creation cannot populate any other module. Week and Morning/Evening Study remain linked through the normal timetable catalog.
- Version 5 documents are rejected rather than migrated because the project is pre-release and the old class records do not contain enough ownership information for an unambiguous conversion.
- OCR class names that do not end in `班` require correction in the review sheet before import.

## Testing

Host schema tests reject cross-catalog student, exam, and timetable references. Controller tests create the same class name in all three catalogs, prove that Study reuses Week's normal class, prove that Grade receives a separate identity, and reject a structural class label during bulk import. Timetable, roster, score, and Question Cutting component tests assert their catalog filters. Parser tests cover `第一节` and `星期班级早读` as unselected structural text while accepting `五班` and `高三（11）班`.
