# Agent Note: Hide the built-in Windows-MCP settings card

Status: implemented

English | [中文](2026-09-01-hide-windows-mcp-settings-card.zh.md)

## Problem

The generic Plugin configuration tab presented the built-in Windows desktop integration as a user-managed Host plugin. The installed desktop already owns its runtime and activation default, so this extra card exposed an implementation setting, a runtime-availability status, and permission copy in a place where the product should show no Windows desktop control item.

Removing the entire Host integration would also remove installation-ready desktop control. Ignoring persisted values would re-enable the integration for users who had deliberately disabled it.

## Decision

`dsh-client-ui-settings-plugins` does not register a `settings.plugin.item` occupant for the `windows-mcp` namespace. Its source contains no Windows-specific card, controller, styles, locale keys, or exported card face; its unit coverage treats the served namespace only as an intentionally unclaimed key. The generic tab renders the intersection of served Host namespaces and registered card keys, so a served `windows-mcp` namespace produces no row.

The Host plugin, settings namespace, packaged runtime, composition default, and permission policy remain unchanged. A trusted desktop runtime still enables the integration by default, deployments without that runtime stay disabled, and an existing persisted `enabled` value still overrides the composition default. The generic Plugin configuration tab exposes neither that value nor runtime status.

The package registration test serves `windows-mcp` while asserting that only claimed namespaces are dispatched. The assembled Web scenario and its owner-local accessibility snapshot assert that the Windows desktop row is absent. The shipped-composition tests continue to own runtime-present and runtime-absent defaults plus persisted opt-outs.

## Alternatives considered

**Remove the Host plugin and settings namespace.** This would delete the desktop capability and its persisted state, which is outside the presentation change.

**Keep a disabled or read-only card.** The unwanted Windows desktop control item would still appear in Plugin configuration.

**Ignore existing persisted values.** This would discard a deliberate user choice on the next launch or upgrade.

## Consequences

- Plugin configuration contains six built-in cards and no Windows desktop control row.
- Desktop control still starts according to the trusted runtime, composition default, and any persisted user value; this page no longer offers an enable switch or runtime warning.
- Windows-MCP tool catalogs, approval behavior, process privileges, and session isolation are unchanged.
- The generated client slot catalog lists six shipped occupants for `settings.plugin.item`; `WindowsMcpCard` is absent.
