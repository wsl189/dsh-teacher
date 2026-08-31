# Agent Note: Windows-MCP source parity and tool-correlated sampling

Status: implemented

English | [中文](2026-09-01-windows-mcp-source-parity.zh.md)

## Problem

A shared Windows-MCP version number does not prove identical code. The supplied 0.8.5 source includes regional screenshots and desktop fixes absent from its PyPI wheel. Its Scrape tool also requests a client model completion; a client without sampling returns the raw page instead of the requested extraction. Advertising the same twenty names therefore does not establish functional parity.

A shared MCP process cannot infer which DSH session owns an incoming sampling request. Granting it an arbitrary model route or the most recently active session would mix callers' authority, history, cancellation, and charges.

## Decision

The build freezes the supplied package's complete Python tree and twenty tool signatures in `third-party/windows-mcp`. The existing hash-pinned wheel closure supplies dependencies and distribution metadata; the reviewed source replaces the wheel's implementation. Verification checks archive members, source and signature hashes, every patch digest, and signatures before and after patching. This retains region parameters, UI Automation fixes, slider support, and hidden subprocess behavior without a second desktop implementation. The Windows client timeout permits the upstream WaitFor maximum.

Two reviewed changes remain outside upstream source: the existing TheFuzz substitution and a Scrape sampling-correlation patch. The latter echoes the private per-invocation token from `tools/call` metadata into `sampling/createMessage` metadata. The SDK's `relatedRequestId` transport option alone does not identify a parent request on the stdio wire. The patch preserves query focus, DOM mode, explicit sampling opt-out, and raw-content fallback.

Generic MCP sampling is disabled unless a deployment supplies an exact tool allowlist and input/output limits. Windows-MCP enables it only for Scrape, which already requires [session-scoped Full access](2026-09-01-windows-mcp-full-access.md). An executing tool gets one completion on its caller's logged provider/model route. The request contains only supplied text, not conversation history or tools; server model preferences cannot choose another route. Unsolicited, repeated, expired, and foreign tokens fail before model dispatch.

The caller's session records prepared inputs before streaming and terminal output afterward as `mcp/sampling-request` and `mcp/sampling-response`. Replay preserves request order even when responses finish out of order. Tool cancellation, timeout, completion, and connection closure stop nested sampling; reconnect waits for model settlement. Transport cancellation is detached after a tool reply because the SDK retains abort listeners after successful requests. Private tokens never enter the durable log.

[Bundled runtime ownership](2026-08-31-bundled-windows-mcp.md), [default activation](2026-09-01-windows-mcp-default-on.md), [MCP bridging](2026-07-07-mcp-client-plugin.md), and [reconnection](2026-08-06-mcp-client-auto-reconnect.md) retain their independent rationale. Source identity and auxiliary model access do not replace those decisions. The installed feature remains a private stdio child; parity does not expose upstream HTTP/SSE/OAuth listeners, grant administrator privileges, or let text-only models consume images.

## Alternatives considered

**Pin only the published version or copy a few changed tools.** The version does not identify the supplied implementation, and selective copying can omit shared UI Automation or subprocess fixes. A complete source snapshot makes both coverage and later updates auditable.

**Enable unrestricted sampling for every MCP server.** Incoming stdio requests have no trusted DSH session identity. Explicit allowlists and single-use correlation keep auxiliary calls within an already-authorized tool invocation.

**Use a separate model endpoint or inject the agent's full conversation.** Either would add credentials, routing, disclosure, and replay semantics unrelated to webpage extraction. The existing LLM service receives a bounded, isolated text request on the caller's route.

## Consequences

- Source updates require reviewing the archive, tool signatures, dependency closure, patches, and Windows packaging smokes together. TheFuzz remains a deliberate local implementation difference.
- Scrape can spend one additional bounded model completion per call. Model refusal, unavailable sampling, or extraction failure retains the upstream raw-page fallback; oversized requests are refused before provider dispatch.
- Source tests validate the complete pinned tree and rejection paths. The real FastMCP smoke covers correlation, query focus, DOM, opt-out, and fallback; Windows packaging additionally checks the native runtime and all tool parameters.
- Keyless TypeScript SDK replay covers regions, persisted images, and logged extraction through the shipped SDK profile. Python SDK expected outputs pin sampling events and provider bytes. Unit tests cover caller isolation, limits, cancellation, stale tokens, and joined reconnection. Live provider quality and native desktop actions require credentials and Windows respectively; Linux replay is not evidence of either.
