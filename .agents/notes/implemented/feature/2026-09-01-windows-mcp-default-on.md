# Agent Note: Default-on bundled Windows desktop control

Status: implemented

English | [中文](2026-09-01-windows-mcp-default-on.zh.md)

## Problem

Installation-ready desktop control requires the bundled runtime to start without a separate activation step. A deployment default must still respect a user's saved refusal and must not start a Windows process in deployments that supply no runtime.

## Decision

This note supersedes only default-off activation in the [bundled integration note](2026-08-31-bundled-windows-mcp.md). That note retains runtime distribution, licensing, and Loader lifecycle ownership; [session-scoped Full access](2026-09-01-windows-mcp-full-access.md) owns tool visibility and approval; [the hidden settings card](../simplification/2026-09-01-hide-windows-mcp-settings-card.md) owns the generic settings presentation.

The plugin's `enabled` default is true. The shipped Web profile sets its composition default from the presence of a nonblank `DSH_WINDOWS_MCP_COMMAND`, which the packaged desktop launcher supplies only for its trusted payload. Deployments without a command stay disabled. The settings provider merges saved user values above that composition default, so an explicit `enabled: false` survives plugin remounts and subsequent launches. The generic Plugin configuration tab does not expose this value.

When the launcher provides `ctx.appReady`, the plugin registers its settings section during profile activation but schedules the first MCP child reconciliation after successful application readiness. Setting changes before readiness update the source used by that first reconciliation, and profile disposal cancels readiness and event-loop work that has not started. A manual composition without `appReady` retains blocking activation so Loader callers receive the initial child outcome before the plugin settles. Later setting changes reconcile immediately in both modes.

Activation does not change session permission presets. Restricted sessions retain desktop approval and cannot call system tools; Full access grants the pinned catalog under the existing policy. No administrator token or UAC exemption follows from either default activation or Full access.

## Alternatives considered

**Retain default-off activation.** This preserves an explicit first-use step but does not meet the requested installation-ready default.

**Enable every Web deployment unconditionally.** Deployments without the private runtime would report an enabled but unusable feature and emit a startup diagnostic.

**Override saved disabled values.** Re-enabling after a restart or upgrade would discard a deliberate user choice. Only the absent value inherits the new default.

**Increase the desktop backend timeout while keeping the child in activation.** This leaves the main profile dependent on Python import and MCP discovery, so any fixed timeout remains machine- and antivirus-dependent. Launcher readiness already supplies the exact successful-startup point for optional post-boot work.

## Consequences

- An available runtime adds a Python child and the session's permitted tool schemas by default. Disabling removes both; permission changes remain session-scoped.
- Application readiness can precede Windows tool availability; tools enter subsequent model requests only after MCP discovery publishes them. Closing the profile before readiness starts no child.
- Real Loader tests cover deferred launcher readiness, cancellation before readiness, omitted activation, explicit disable, missing runtime, and a saved opt-out across remounts. The shipped Web composition covers runtime-present and runtime-absent defaults, plus a saved disable across Host launches.
- Keyless session snapshots mount the plugin without an explicit `enabled` value and replay Full access, restricted calls, and a live downgrade. Windows UI Automation and the packaged Python executable still require the Windows workflow's smoke tests.
