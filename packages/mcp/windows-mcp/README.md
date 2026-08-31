---
description: "Built-in, opt-in Windows desktop automation backed by the Windows-MCP stdio server packaged with the DSH desktop installer."
kind: "package-reference"
---

# @deepseek-ai/dsh-windows-mcp

English | [中文](README.zh.md)

## Summary

`dsh-windows-mcp` makes the reviewed desktop-control subset of Windows-MCP available as native DSH tools. The Windows desktop installer carries its own pinned CPython and Python dependency runtime, so users do not install Python, `uv`, Windows-MCP, or a separate MCP row. The plugin is disabled by default; enable **Settings → Plugins → Windows Desktop Control** when desktop automation is needed. Every call still requires user approval because the child process can observe and control applications outside the DSH sandbox.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install the Windows desktop EXE, open **Settings → Plugins**, and turn on **Windows Desktop Control**. The desktop launcher supplies the packaged runtime path; the settings card stays unavailable when that trusted payload is absent. Enabling starts a private stdio MCP child and disabling stops it and removes its tools without restarting DSH.

### Reviewed tool set

The model receives exactly these thirteen tools under the `mcp__windows__` namespace: `App`, `Click`, `DisplayInventory`, `Move`, `MultiEdit`, `MultiSelect`, `Screenshot`, `Scroll`, `Shortcut`, `Snapshot`, `Type`, `Wait`, and `WaitFor`. PowerShell, Registry, Process, Clipboard, FileSystem, Notification, and Scrape are not discovered or registered. An unexpected name in the reserved namespace is denied.

### Configuration

The shipped Web profile already contains the plugin row. These fields are primarily for composition authors and source development; installed desktop users normally change only `enabled` through Settings.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Start the bundled server and publish its reviewed tools |
| `runtimeCommand` | empty | Absolute Python executable supplied by the trusted desktop launcher; empty means this deployment cannot mount the runtime |
| `runtimeCwd` | empty | Working directory for the bundled Python runtime |
| `toolCallTimeoutMs` | `60,000` | Deadline for each MCP desktop call |

```yaml
- id: windows-mcp
  name: '@deepseek-ai/dsh-windows-mcp'
  config:
    enabled: false
    runtimeCommand: !!js process.env.DSH_WINDOWS_MCP_COMMAND ?? ''
    runtimeCwd: !!js process.env.DSH_WINDOWS_MCP_RUNTIME_ROOT ?? ''
    toolCallTimeoutMs: 60000
```

Every reviewed call reaches the ordinary DSH tool-policy chain first. A downstream denial stays final; otherwise this plugin asks the user to approve the desktop action. Denying an approval prevents the call from reaching Windows-MCP.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is a composition layer over `dsh-mcp-client`, not a second MCP implementation. It creates and removes a real Loader child as settings change, passes the allowlist both to Windows-MCP's `--tools` option and to the DSH bridge's exact `includeTools` filter, and registers the approval policy only while that child is active. A missing runtime or failed child leaves all desktop tools absent and emits an error without failing DSH startup, so a persisted enabled value remains reachable from Settings and can be turned off.

The desktop build downloads a hash-pinned official embedded CPython archive, installs a hash-pinned binary-only wheel closure, applies the recorded `use-thefuzz.patch`, and completes a real MCP initialize/list/call smoke before packaging. Packaged launches ignore ambient runtime overrides and accept only `resources/windows-mcp/python.exe`; source launches may provide explicit developer paths.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Settings reconciliation, child configuration, allowlist, and approval policy |
| [`src/invariant.ts`](src/invariant.ts) | Runtime invariant companion |
| [`../../../scripts/build-windows-mcp-runtime.ps1`](../../../scripts/build-windows-mcp-runtime.ps1) | Reproducible Windows runtime assembly and smoke |
| [`../../../third-party/windows-mcp/runtime.json`](../../../third-party/windows-mcp/runtime.json) | Upstream versions, URLs, hashes, and local patch identity |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client bridge](../mcp-client/README.md) — discovery, naming, execution, and reconnection behavior inherited by this plugin.
- [Windows-MCP integration Agent Note](../../../.agents/notes/implemented/feature/2026-08-31-bundled-windows-mcp.md) — the distribution, activation, and security decisions.
- [Desktop application](../../../apps/desktop/README.md) — installer layout and packaged startup.
- [Third-party runtime inventory](../../../third-party/README.md) — upstream provenance and local modifications.

-----

<a id="model-experience"></a>
## Model Experience

### Windows desktop tools

#### What the model sees

While enabled and connected, the model sees thirteen `mcp__windows__*` tools with Windows-MCP's descriptions and JSON schemas. Calls can inspect visible UI state, capture screenshots, and send mouse or keyboard input only after user approval. Disabling the feature removes every tool from subsequent requests.

#### Token effect

The thirteen tool names, descriptions, and schemas add tokens to every model request while the plugin is enabled. Tool arguments and returned text or images remain in conversation history until compaction.

#### KV Cache effect

The tool-definition prefix remains stable while the pinned runtime advertises the same reviewed schemas. Enabling, disabling, or changing an advertised schema changes the tool prefix and can invalidate cache reuse from that point.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the supported host, trust, and tool surface for the bundled integration.

- **Windows x64 desktop only** — the packaged runtime is the official CPython AMD64 embedded distribution and is not included in non-Windows builds.
- **Visible-session automation** — desktop actions require an unlocked interactive Windows session; services, disconnected sessions, and secure desktops are outside the supported path.
- **Outside the DSH sandbox** — Windows-MCP is a native Python child and UI Automation client; DSH approval reduces accidental calls but is not OS containment.
- **No arbitrary upstream tools** — expanding the thirteen-tool allowlist requires code, tests, security review, runtime smoke updates, and a new installer.
- **One runtime per enabled profile** — this package owns one `windows` namespace and does not expose user-defined Windows-MCP servers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The upstream version, Python version, wheel closure, patch digest, and smoke surface are one reviewed upgrade unit. Update them together and run the Windows desktop workflow; a Linux source checkout cannot prove UI Automation or the packaged AMD64 runtime.

</details>
