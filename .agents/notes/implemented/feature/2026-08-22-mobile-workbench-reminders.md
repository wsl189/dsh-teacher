# Agent Note: Mobile workbench reminders

Status: implemented

English | [中文](2026-08-22-mobile-workbench-reminders.zh.md)

> Extends [Durable Teacher Workbench](2026-08-17-durable-teacher-workbench.md). Its global document, compare-and-set writes, and browser persistence decision remain current.

## Problem

Daily tasks and dated calendar items could retain deadlines, while memos and ledger entries had no notification time at all. None of them produced a notification outside the browser. General cron jobs and IM bots existed as independent plugins, so neither one owned enough information to turn a workbench item into a durable reminder: the cron plugin did not own item completion or deadline edits, while the workbench did not have a credential-safe way to select and address one of several bots on one platform.

Reminder state must survive a Host restart, track edits and completion without leaving stale jobs, and avoid copying platform credentials or private conversation identifiers into the workbench document or browser Remote payloads. An item without a complete reminder configuration must retain ordinary deadline-only behavior.

## Decision

Teacher-workbench document version 10 lets a daily task, memo, ledger entry, or calendar item carry one reminder. Memos and ledger entries add an optional local reminder deadline independent of memo edit time and ledger occurrence time. The reminder records a platform, opaque bot id, display label, deadline-derived canonical UTC instant, configuration time, last accepted occurrence, and either a one-time lead in minutes or a fixed repeat interval. It contains no credential or conversation target. Browser task, memo, ledger, and calendar editors obtain a credential-free roster through `teacherWorkbench/listNotificationTargets`; task time controls combine deadline and reminder configuration, memo editors show the same fields, ledger composers provide a reminder button, and calendar agenda rows expose a dedicated reminder action. Both reminder modes accept a free-form numeric draft with a minutes, hours, or days selector and convert valid values to whole minutes before persistence. Empty or invalid drafts remain editable and block the containing save operation instead of being clamped during input. An elapsed deadline disables activation with an inline correction, while ordinary item edits remain saveable; a future deadline closer than the default lead selects a smaller whole-minute lead whose occurrence is still future. The Daily Management model read returns the same roster as `notificationTargets`. Model writes may select only an exact platform and bot id from that roster; memo and ledger writes also provide `remindAt`. An unknown bot, invalid deadline, or elapsed one-time occurrence is rejected instead of being stored as an apparent reminder.

`TeacherReminderRuntime` projects timers from the authoritative document rather than persisting a second job table. It recomputes after startup and every accepted write, uses segmented process timers for long delays, and serializes occurrence acknowledgement through the same operation queue as browser writes. Repeated occurrences are aligned backwards from the deadline. A failed or unavailable provider is retried at the configured interval until the deadline; an occurrence advances only after provider acceptance. Completed or deleted tasks, deleted memos or ledger entries, and removed reminder fields immediately disappear from the projection. Memos, ledger entries, and calendar items remain eligible until their deadline because they have no completion state.

The optional Cordis service `ctx.mobileNotifications` has two operations: `listTargets()` returns platform, bot id, label, and connection state, and `send()` accepts platform, bot id, and complete text. The dsh-im Host composition implements the service across its nine mobile channels. Each channel controller sends through the same most-recent private target already used for connection tests; credentials and that target remain channel-private. A bot that is offline or has no remembered private conversation rejects delivery so teacher-workbench can retry.

The general `dsh-plugin-cron` scheduler remains an independent profile bundle for model- or browser-managed shell commands. Workbench reminders do not create mirrored cron records: the workbench document is their only durable fact source, while cron owns unrelated command schedules and execution history. When both plugins are mounted, cron's browser endpoint reads `TeacherWorkbenchService.listScheduledReminders()` and merges its credential-free rows into the scheduled-task page and sidebar. These rows are read-only, expose their next occurrence and selected bot label, and retain workbench as their only execution and management owner.

The sidebar projects general cron jobs through `sidebar.primary.section` between New Session and the workspace browser. Its disclosure lists jobs whose enabled flag is true or whose process-local running flag is true; idle disabled jobs remain available only on the management page. It refreshes after current-session activity so an agent-created workbench reminder updates the count when its tool result lands, while periodic refresh remains a fallback for external changes. A rail click expands both the sidebar and the disclosure, and each listed row opens the management page.

## Alternatives considered

**Create one cron row for every reminder.** Mirroring item title, deadline, completion, bot selection, and edits into a second durable store creates cross-plugin transactions and stale-job recovery. It also forces shell commands to become an internal notification protocol. A derived timer projection keeps one owner for reminder state.

**Store webhook URLs, tokens, or conversation ids with each item.** That would expose secrets or private routing data through the workbench document, browser Remote, backups, and model-facing reads. Opaque bot selection plus a Host-only notification service keeps those values inside dsh-im.

**Send only while the workbench page is open.** Browser timers do not survive navigation, sleep, restart, or another device closing the page. Host timers derive from durable state and require no mounted browser.

**Give each platform a workbench-specific adapter.** Platform-specific fields and lifecycle rules would spread through the workbench schema and UI. One small service preserves dsh-im as the channel owner and lets additional providers implement the same operations.

## Consequences

- A configured reminder survives Host restarts and follows its owning item's deadline edits, task completion, deletion, and explicit reminder removal without a second cleanup transaction.
- Multiple bots per platform are selectable, but delivery requires that the chosen bot has previously observed a private conversation. Group targeting and arbitrary recipient entry are not exposed.
- A Host outage does not replay occurrences whose deadline has passed. Provider outages before the deadline may deliver an occurrence late and then resume the deadline-aligned sequence.
- Workbench state stores the bot display label for offline editing. Delivery uses the opaque id, so renaming a bot does not retarget a reminder.
- General cron jobs execute trusted shell commands with their own permissions and history. Their browser list may display the read-only workbench projection, but cron does not execute or modify those reminders and receives no IM credentials.
- The cron Host projects ephemeral running state through its tool and HTTP summaries. The sidebar refreshes an open disclosure periodically, so short executions may finish between refreshes without displaying a running indicator.

## Testing

Host tests pin deadline alignment, provider delivery, exact durable acknowledgement, suppression after acknowledgement, task, memo, ledger, and calendar reminder projection, model-visible target discovery, exact reminder persistence, and rejection of invented bot ids. Controller tests pin local-deadline conversion to canonical UTC for tasks, memos, and ledger entries, plus removal when a deadline changes without replacement reminder fields. Component tests pin unit conversion, editable empty drafts, repeated-frequency bounds, selection among multiple bots, memo and ledger configuration, overdue-deadline guidance, continued ordinary editing, and a valid shortened lead for near deadlines. dsh-im tests pin credential-free target projection, exact channel routing, input rejection, and custom-message delivery through shared-token and Feishu controller families. Sidebar tests pin the primary-section seat and rail expansion callback; cron integration tests pin running-state publication, execution cleanup, and read-only workbench rows.
