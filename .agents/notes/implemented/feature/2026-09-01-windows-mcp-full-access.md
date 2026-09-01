# Agent Note: Session-scoped Windows-MCP full access

Status: implemented

English | [中文](2026-09-01-windows-mcp-full-access.zh.md)

## Problem

Full access combines `danger-full-access` with approval policy `never`. A Windows-MCP policy that asks unconditionally therefore rejects every call: `never` prohibits prompts, not grants requests. Users who explicitly choose full computer control also need the pinned server's system tools, which a desktop-only catalog excludes. Enabling that catalog globally must not grant the same authority to restricted sessions sharing the Host.

## Decision

This note supersedes the desktop-only catalog and unconditional-approval decisions in the [bundled integration note](2026-08-31-bundled-windows-mcp.md). That note retains ownership of the private pinned Python runtime, licensing, payload verification, and Loader lifecycle. [Default-on desktop control](2026-09-01-windows-mcp-default-on.md) owns activation and saved user choices; [the hidden settings card](../simplification/2026-09-01-hide-windows-mcp-settings-card.md) owns the generic settings presentation.

The built-in client discovers the complete twenty-tool catalog of Windows-MCP 0.8.5. Both the Python `--tools` list and the bridge's `includeTools` filter pin that catalog; future or unknown names remain denied. The thirteen desktop tools remain usable with approval in restricted modes. PowerShell, Registry, Process, Clipboard, FileSystem, Notification, and Scrape require Full access.

Only the calling session's latest recorded `sandbox/mode` grants Full access. Shipped permission presets record initial defaults and live switches in that log. Approval policy `never`, a preset label, the process environment, another session, and absent session state cannot grant authority. Full access waives only Windows-MCP's own extra approval; downstream denials and approval requests remain effective, including the ordinary automatic rejection of a required request under `never`.

While the MCP child is active, scoped tool restrictions hide system tools from restricted agents. Agent creation, mode events, and MCP discovery reconcile those restrictions without restarting Python. The shared tool registry applies the same scoped view to schemas, lookup, native execution, and PTC dispatch. Execution policy independently checks the recorded mode after downstream policy settles, and a monotonic guard denies system calls without Full access even when a different listener grants the call. Other tools and other sessions retain their existing policies. Child removal must succeed before the plugin releases its policy registrations.

The Windows-MCP package and desktop documentation describe the full-system grant. Windows-MCP runs with its existing Windows process privileges; Full access does not supply an administrator token or bypass UAC and secure desktops. A mode downgrade constrains subsequent calls but does not undo an action that already started.

## Alternatives considered

**Treat `never` as approval.** This would change a shared security rule and let unrelated policies grant requests merely because no answerer is allowed. The desktop plugin instead removes only its own request when the session grants Full access.

**Unlock one global tool set when any session has Full access.** One user's permission selection would affect concurrent restricted sessions. Per-session restrictions and execution checks keep the grant local while sharing one MCP process.

**Keep the thirteen-tool catalog in Full access.** This permits visible desktop actions but cannot provide the explicitly requested complete Windows-MCP functionality. The pinned twenty-tool catalog keeps the expansion finite and reviewable.

**Rely only on hidden schemas.** A model can reuse a previously advertised name, and scoped registrations can shadow global tools. Execution checks remain necessary after discovery filtering.

## Consequences

- Full-access sessions can use all pinned desktop and system tools without Windows-MCP-specific prompts; restricted sessions keep desktop approval and cannot approve system tools one call at a time.
- Permission switches change the affected session's tool schemas and request-header prefix. Replay records those changes; the Python process remains shared and connected.
- Unit and real Loader tests cover mode switches, missing grants, session isolation, downstream policy, scoped shadows, settings activation, and teardown. Keyless headless snapshots exercise real MCP stdio with an inert external server in full, restricted, and downgraded sessions; a separate call-ledger file proves which calls reach that server.
- The Windows packaging smoke requires all twenty real tool names and calls inert `Wait`. Linux tests do not verify Windows UI Automation or the installed AMD64 Python runtime; the Windows workflow owns that evidence.
