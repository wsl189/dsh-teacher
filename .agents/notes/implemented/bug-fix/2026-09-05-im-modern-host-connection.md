# Agent Note: Modern Host connections for bundled IM channels

Status: implemented

English | [中文](2026-09-05-im-modern-host-connection.zh.md)

## Problem

The bundled dsh-im 1.0.3 client sent legacy HTTP RPC envelopes to the Web server. The current Host protects those browser routes with connection authentication and exposes a different Typert API, so every platform's shared health check failed before its channel runtime started. Connected-platform pages reduced that failure to "connection not ready." A saved Weixin token can independently expire, but the startup response was not validated and its actionable provider error was replaced with the same generic message.

## Decision

The Web bundle pins dsh-im 4.11.0 and uses its modern same-process Host adapter for all nine bot platforms and Office. Local channels call the current Host services directly; an explicitly configured external `harnessBaseUrl` continues to use HTTP. The distribution patch retains the desktop workspace default and shared QQ speech route. It validates the Weixin start response and preserves `stale-token` with instructions to remove the account and scan again.

Saved bot configuration, credentials, workspaces, and channel state remain outside the package archive and keep their existing formats. The upgrade does not copy browser credentials into the plugin, weaken Web route authentication, or rewrite saved platform data.

## Alternatives considered

**Authenticate the legacy loopback HTTP calls.** Browser credentials belong to browser connections and would not repair the legacy method names, envelopes, history records, or interaction streams.

**Patch only the health check.** Later workspace, session, prompt, approval, and question calls use the same retired protocol, so startup success would hide additional failures.

**Delete and recreate every account.** That discards valid platform credentials and workspaces without fixing the shared Host integration. Only an account whose provider credential is invalid requires reauthorization.

## Consequences

All bundled channels share one current Host integration instead of nine protocol shims. A platform can still be offline because its own token or secret is invalid; the Weixin page now distinguishes an expired scan token from a Host connection failure. Re-scanning is a user action because replacing a saved account credential is not safe to automate.

## Testing

The [bundled IM tests](../../../../packages/bundle/web-app/tests/im-workspaces.spec.ts) require same-process health checks without HTTP, preserve explicit remote HTTP selection, cover all desktop workspace defaults and shared QQ speech, and pin the Weixin `-14` response as `stale-token`. A real Web-profile startup confirmed that a configured QQ account reaches connected state through the new adapter and that the saved Weixin account returns the expired-token diagnosis.
