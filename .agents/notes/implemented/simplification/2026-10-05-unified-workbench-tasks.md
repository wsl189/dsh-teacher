# Agent Note: Unified workbench navigation and tasks

Status: implemented

English | [中文](2026-10-05-unified-workbench-tasks.zh.md)

## Problem

Workbench renders above the selected main panel as an overlay. Selecting Plugins or Automation tasks changes Layout without removing that overlay, so the selected page remains covered. The separate cron task page also lists workbench reminders already owned by the workbench notification runtime, duplicating the official Automation tasks entry.

## Decision

Workbench registers a keyed `main` panel and selects it through Layout. Its shared view store retains disclosure and module selection, while Layout alone owns the active panel. Plugins, Automation tasks, and Session navigation therefore use the same mounting lifecycle.

Automation tasks owns a root list slot, `schedule.manager.sources`, and passes its search and status filter to each feature-owned section. Workbench contributes its existing active-reminder projection through a generated Remote. Durable writes and delivery acknowledgements emit `teacherWorkbench/changed`; the browser source refreshes on that event or reconnect, discards superseded reads, and releases subscriptions on unmount and plugin disposal. Selecting a reminder returns to the original Workbench dashboard for editing.

The distribution removes `dsh-plugin-cron`, its tools, sidebar, reviewed archives, and compatibility patch. Existing workbench items, notification delivery, and official Schedule tasks retain their storage and execution owners. Legacy cron command records and history remain in user storage; shell commands are not converted to model prompts or notifications. The upgrade guide explains this capability removal.

This partially supersedes the presentation in [Mobile workbench reminders](../feature/2026-08-22-mobile-workbench-reminders.md), the panel placement in [Durable Teacher Workbench](../feature/2026-08-17-durable-teacher-workbench.md), and cron inclusion in [Bundled extensions](../feature/2026-08-25-bundled-extensions-and-qq-speech.md). Their persistence, notification, and remaining distribution decisions stay active.

## Alternatives considered

**Hide the overlay after each navigation event.** Every new global page would need another synchronization path. Standard main-panel ownership gives one selection and mounting contract.

**Copy workbench reminders into Schedule records.** Their direct bot notification and item completion semantics differ from Schedule's Session prompts. Duplicate records would require synchronized writes and could send twice or incur model calls.

**Keep the third-party cron page or silently convert command jobs.** The first retains redundant navigation. The second changes execution, permissions, results, and costs. Removing the bundled command scheduler preserves its legacy data without claiming behavioral equivalence.

## Consequences

- One Automation tasks page displays Session tasks and active workbench reminders. Search and status filters apply to both sources; inactive workbench reminders remain managed with their original items.
- Workbench reminder delivery continues without a mounted browser. Only the catalog subscription depends on the page lifetime.
- Existing user storage is neither rewritten nor deleted. Independently mounted legacy cron plugins require explicit removal from their custom profile.
- A future command scheduler needs an explicit command-execution owner and migration contract; the reminder catalog is not that owner.

## Testing

The assembled browser regression fails against the overlay implementation after selecting Plugins. It covers Workbench, Plugins, Automation tasks, return to Workbench, and Session reselection. Catalog tests cover invalidation races, connection reset, retry, shared subscriptions, and disposal. Component tests cover all four reminder owners and the shared filters. Existing reminder-runtime tests retain delivery, durable acknowledgement, deadline alignment, and restart coverage.

Installed-payload verification caught a missing `entities-6.0.1.tgz` source archive despite a complete unpacked build; a full file comparison also found a missing addon documentation video. NSIS excluded the configured precompressed extensions from its application archive, while its separate copy walker skipped `node_modules`. The desktop configuration therefore disables that separate copy path and keeps dependency assets in the normal application archive. Both the unpacked payload and the installed files must pass verification before the preview installer is delivered.
