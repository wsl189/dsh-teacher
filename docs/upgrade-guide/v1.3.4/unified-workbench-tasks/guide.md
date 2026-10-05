---
kind: upgrade-guide
description: "Workbench reminders move to Automation tasks and the bundled cron command scheduler is removed."
---

# Workbench reminders share the Automation tasks page

English | [中文](guide.zh.md)

## Change

**Automation tasks → Workbench reminders** replaces the separate **Scheduled tasks** entry for workbench reminders. Tasks, memos, ledger entries, and calendar reminders keep their original documents, bot selection, and notification runtime. The common search and status filter also apply to their active rows. Selecting a reminder opens Workbench for editing.

The distribution no longer mounts or includes `dsh-plugin-cron` and its `cron_add`, `cron_list`, `cron_remove`, or `cron_run` tools. Official Schedule still supports Session-based automation, including its own cron recurrence rules. Legacy command jobs are not converted to Session prompts; they no longer execute through the removed bundled plugin.

## Migration

1. Open **Automation tasks** and check **Workbench reminders**. Existing active reminders appear automatically; do not recreate them as Session tasks. Edit their deadlines and notification options in Workbench.
2. Retain legacy cron storage and backups if you used command jobs. The application does not delete the JSON storage unit's `cron.json` or `cron/jobs` and `cron/runs` records. Recreate required command execution under a scheduler you explicitly configure.
3. If a custom profile independently mounts a row whose `name` is `dsh-plugin-cron`, remove that row and its profile-local dependency to remove the old interface and runtime. Keep its user data until you have recovered any required jobs.
4. Verify that switching from Workbench to Plugins or Automation tasks shows the selected page, and that reminder edits appear when you return to Automation tasks.
