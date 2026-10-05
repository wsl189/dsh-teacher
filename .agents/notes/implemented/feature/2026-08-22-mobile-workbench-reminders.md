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

The optional Cordis service `ctx.mobileNotifications` has two operations: `listTargets()` returns platform, bot id, label, and connection state, and `send()` accepts platform, bot id, and complete text. The bundled dsh-im compatibility patch registers this service alongside upstream `dshIm`, whose explicit delivery targets do not supply the workbench's bot-only selection. Channel startup registers the same workspace-aware controller used by settings; channel disposal removes that registration. Reads project current aliases and connection state, including configured offline bots, without caching the roster. Each of the nine mobile channels forwards reminder text through its existing private connection-test route, retaining reconnect/removal serialization and keeping credentials and recipients inside IM. QQ uses the most recently remembered private recipient or its bound owner. An offline bot or unavailable recipient rejects delivery so teacher-workbench can retry; ordinary connection tests retain their original text.

The Automation tasks page reads `TeacherWorkbenchService.listScheduledReminders()` through its generated Remote and renders the credential-free projection in `schedule.manager.sources`. The source shares the page's search and status filters, subscribes to durable `teacherWorkbench/changed` notifications, and reloads after connection reset. Selecting a row opens Workbench for management. Workbench remains the only execution and persistence owner; no mirrored Schedule or cron row exists.

The [unified navigation and task-page decision](../simplification/2026-10-05-unified-workbench-tasks.md) supersedes the separate cron presentation and bundled command scheduler. The reminder document, deadline semantics, and notification runtime remain current.

## Alternatives considered

**Create one cron row for every reminder.** Mirroring item title, deadline, completion, bot selection, and edits into a second durable store creates cross-plugin transactions and stale-job recovery. It also forces shell commands to become an internal notification protocol. A derived timer projection keeps one owner for reminder state.

**Store webhook URLs, tokens, or conversation ids with each item.** That would expose secrets or private routing data through the workbench document, browser Remote, backups, and model-facing reads. Opaque bot selection plus a Host-only notification service keeps those values inside dsh-im.

**Send only while the workbench page is open.** Browser timers do not survive navigation, sleep, restart, or another device closing the page. Host timers derive from durable state and require no mounted browser.

**Give each platform a workbench-specific adapter.** Platform-specific fields and lifecycle rules would spread through the workbench schema and UI. One small service preserves dsh-im as the channel owner and lets additional providers implement the same operations.

## Consequences

- A configured reminder survives Host restarts and follows its owning item's deadline edits, task completion, deletion, and explicit reminder removal without a second cleanup transaction.
- Multiple bots per platform are selectable, including offline bots. Delivery requires the selected bot's private connection-test route to be available; QQ may use its bound owner before receiving a private message. Group targeting and arbitrary recipient entry are not exposed.
- A Host outage does not replay occurrences whose deadline has passed. Provider outages before the deadline may deliver an occurrence late and then resume the deadline-aligned sequence.
- Workbench state stores the bot display label for offline editing. Delivery uses the opaque id, so renaming a bot does not retarget a reminder.
- The shipped composition has one Automation tasks entry. Legacy cron command records and history remain in user storage but are not executed by the removed plugin.
- Automation catalog subscriptions end when their last browser consumer unmounts; reconnect and durable changes supersede older reads.

## Testing

The shipped QQ browser scenario loads two configured bots through the real IM plugin, records the Daily Management tool's credential-free roster, saves a reminder for the selected bot, and checks persistence after reload. Teardown verifies that channel disposal empties the retained notification gateway. The regression returns an empty roster without the compatibility patch. Controller tests cover custom reminder text, unchanged connection-test text, unknown bots, and offline rejection across all nine channels; a real QQ runtime with a synthetic platform transport pins private-owner fallback, remembered-user routing, and provider rejection. No live platform messages are sent by these tests.

Host tests pin deadline alignment, provider delivery, exact durable acknowledgement, suppression after acknowledgement, task, memo, ledger, and calendar reminder projection, model-visible target discovery, exact reminder persistence, and rejection of invented bot ids. Controller tests pin local-deadline conversion to canonical UTC for tasks, memos, and ledger entries, plus removal when a deadline changes without replacement reminder fields. Component tests pin unit conversion, editable empty drafts, repeated-frequency bounds, selection among multiple bots, memo and ledger configuration, overdue-deadline guidance, continued ordinary editing, and a valid shortened lead for near deadlines. dsh-im tests pin credential-free target projection, exact channel routing, input rejection, and custom-message delivery through shared-token and Feishu controller families. Catalog and component tests pin shared filtering, all four reminder sources, stale-read rejection, retry, and subscription teardown. The assembled browser scenario pins panel switching, durable reminder readback, live refresh, and return to Workbench.
