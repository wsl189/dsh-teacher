---
description: "Built-in Windows desktop automation, enabled by default with the Windows-MCP runtime packaged in the DSH desktop installer."
kind: "package-reference"
---

# @deepseek-ai/dsh-windows-mcp

English | [中文](README.zh.md)

## Summary

`dsh-windows-mcp` provides Windows desktop and system automation as native DSH tools. The Windows desktop installer carries its own pinned CPython and Python dependency runtime, so users do not install Python, `uv`, Windows-MCP, or a separate MCP row. The plugin starts by default when that runtime is available, unless the user has saved a disabled setting. A standard `dsh` launcher starts the Python child after the application becomes ready, so runtime import and discovery do not delay the main page. Full access unlocks all twenty tools without this plugin's extra approval; other modes expose thirteen desktop tools with per-call approval. These actions operate outside the DSH sandbox.

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

Install and launch the Windows desktop EXE to start Windows desktop control automatically. Use **Settings → Plugins → Windows Desktop Control** to turn it off or back on; saved choices override the startup default. The desktop launcher supplies the packaged runtime path; deployments without that trusted payload remain disabled and the settings card stays unavailable. The settings section activates with the main profile, while the initial private stdio child starts after launcher readiness and publishes its tools when discovery completes. A manual composition with no `appReady` launcher service starts the child during plugin activation. Enabling later starts the child immediately; disabling stops it and removes its tools without restarting DSH.

<a id="tools-and-permission-modes"></a>
### Tools and permission modes

The desktop set contains thirteen tools under the `mcp__windows__` namespace: `App`, `Click`, `DisplayInventory`, `Move`, `MultiEdit`, `MultiSelect`, `Screenshot`, `Scroll`, `Shortcut`, `Snapshot`, `Type`, `Wait`, and `WaitFor`. A session in Full access (`danger-full-access`) also receives `PowerShell`, `Registry`, `Process`, `Clipboard`, `FileSystem`, `Notification`, and `Scrape`: the complete twenty-tool catalog of the pinned runtime. Switching to `read-only` or `workspace-write` hides and denies those seven system tools and restores approval for desktop calls. The switch affects that session, not other sessions, and requires no runtime restart. Unknown names remain denied in every mode.

### Configuration

The shipped Web profile already contains the plugin row and overrides `enabled` to false when no runtime command is supplied. These fields are primarily for composition authors and source development; installed desktop users normally change only `enabled` through Settings.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Start the bundled server and publish its reviewed tools when a runtime command is supplied |
| `runtimeCommand` | empty | Absolute Python executable supplied by the trusted desktop launcher; empty means this deployment cannot mount the runtime |
| `runtimeCwd` | empty | Working directory for the bundled Python runtime |
| `toolCallTimeoutMs` | `180,000` | Deadline for each MCP call, including nested sampling; covers `WaitFor`'s 120-second wait |
| `samplingMaxInputBytes` | `1,048,576` | Maximum UTF-8 bytes of Scrape sampling parameters |
| `samplingMaxOutputTokens` | `2,048` | Maximum output tokens for one Scrape completion |

```yaml
- id: windows-mcp
  name: '@deepseek-ai/dsh-windows-mcp'
  config:
    enabled: !!js (process.env.DSH_WINDOWS_MCP_COMMAND ?? '').trim().length > 0
    runtimeCommand: !!js process.env.DSH_WINDOWS_MCP_COMMAND ?? ''
    runtimeCwd: !!js process.env.DSH_WINDOWS_MCP_RUNTIME_ROOT ?? ''
    toolCallTimeoutMs: 180000
```

Every call reaches the ordinary DSH tool-policy chain. Full access waives only this plugin's extra approval; downstream denials and approval requests remain effective. Approval policy `never` still rejects requests that another policy requires. A missing calling session or recorded sandbox mode does not grant Full access. Denied or unavailable approval prevents desktop execution; system tools require Full access even if an answerer would approve them.

`Snapshot` and `Screenshot` accept `region=[left, top, right, bottom]` in virtual-desktop pixels. `Scrape` uses the initiating session's model to extract webpage content, with `query` selecting the focus; `use_dom` selects the active browser DOM and `use_sampling=false` returns raw content. Sampling failure also falls back to raw content. The separate model call consumes the configured provider's tokens and records its input and output in that session; the server receives no conversation history or extra model tools.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin composes `dsh-mcp-client` through a real Loader child, with the pinned catalog passed to both Windows-MCP's `--tools` option and the bridge's exact `includeTools` filter. When `ctx.appReady` exists, the plugin registers settings during profile activation, folds any pre-ready setting change into the current source, and schedules the initial child reconciliation after successful readiness; disposal cancels work that has not started. Session-scoped tool restrictions follow the latest recorded sandbox mode and MCP discovery; the pre-execute policy and a monotonic guard enforce execution. Policies remain installed until child removal succeeds. A missing runtime or failed child leaves all Windows tools absent and emits an error without failing DSH startup, so the enabled setting remains reachable and can be turned off.

The desktop build installs a hash-pinned CPython and wheel closure, then replaces the complete Windows-MCP Python package with the reviewed source snapshot. Source hashes and all twenty tool signatures are verified before the recorded TheFuzz and sampling-correlation patches are applied. Packaging requires real MCP discovery, an inert `Wait` call, and a Scrape sampling smoke. Packaged launches ignore ambient runtime overrides and accept only `resources/windows-mcp/python.exe`; source launches may provide explicit developer paths.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Settings reconciliation and child configuration |
| [`src/permissions.ts`](src/permissions.ts) | Pinned catalog, session-scoped discovery, and execution policy |
| [`src/invariant.ts`](src/invariant.ts) | Runtime invariant companion |
| [`../../../scripts/build-windows-mcp-runtime.ps1`](../../../scripts/build-windows-mcp-runtime.ps1) | Reproducible Windows runtime assembly and smoke |
| [`../../../third-party/windows-mcp/runtime.json`](../../../third-party/windows-mcp/runtime.json) | Upstream versions, URLs, hashes, and local patch identity |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client bridge](../mcp-client/README.md) — discovery, naming, execution, and reconnection behavior inherited by this plugin.
- [Windows-MCP integration Agent Note](../../../.agents/notes/implemented/feature/2026-08-31-bundled-windows-mcp.md) — the distribution, activation, and security decisions.
- [Full-access policy Agent Note](../../../.agents/notes/implemented/feature/2026-09-01-windows-mcp-full-access.md) — complete-system authority and per-session isolation.
- [Default activation Agent Note](../../../.agents/notes/implemented/feature/2026-09-01-windows-mcp-default-on.md) — runtime availability and preservation of saved choices.
- [Source parity and sampling Agent Note](../../../.agents/notes/implemented/feature/2026-09-01-windows-mcp-source-parity.md) — source identity, correlated model access, and replay.
- [Desktop application](../../../apps/desktop/README.md) — installer layout and packaged startup.
- [Third-party runtime inventory](../../../third-party/README.md) — upstream provenance and local modifications.

-----

<a id="model-experience"></a>
## Model Experience

### Windows desktop tools

#### What the model sees

While enabled and connected, the model sees thirteen desktop tools such as `mcp__windows__Snapshot`, or all twenty tools in Full access, with Windows-MCP's descriptions and JSON schemas. Desktop calls require approval outside Full access; the additional system tools are hidden and rejected there. Disabling the feature removes every Windows tool from subsequent requests.

#### Token effect

The visible thirteen or twenty tool names, descriptions, and schemas add tokens to model requests while the plugin is enabled. Tool arguments and returned text or images remain in conversation history until compaction. Scrape sampling adds one separately logged text request; only its resulting summary or raw fallback enters the main conversation.

#### KV Cache effect

The tool-definition prefix remains stable while the runtime and session permissions expose the same schemas. Enabling, disabling, switching into or out of Full access, or changing an advertised schema changes the tool prefix and can invalidate cache reuse from that point.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the supported host, trust, and tool surface for the bundled integration.

- **Windows x64 desktop only** — the packaged runtime is the official CPython AMD64 embedded distribution and is not included in non-Windows builds.
- **Visible-session automation** — desktop actions require an unlocked interactive Windows session; services, disconnected sessions, and secure desktops are outside the supported path.
- **Outside the DSH sandbox** — Windows-MCP operates with its Windows process privileges. Full access grants no administrator token and cannot bypass UAC or secure desktops. Already-started actions are not undone by a permission downgrade.
- **Pinned catalog only** — admitting tools beyond the pinned twenty requires code, tests, security review, runtime smoke updates, and a new installer.
- **One runtime per enabled profile** — this package owns one `windows` namespace and does not expose user-defined Windows-MCP servers.
- **Local stdio integration** — the built-in feature does not expose upstream HTTP/SSE listeners or remote OAuth configuration. Screenshots reach the model only when the current route explicitly supports image input and durable attachments are available.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The upstream version, Python version, wheel closure, patch digest, and smoke surface are one reviewed upgrade unit. Update them together and run the Windows desktop workflow; a Linux source checkout cannot prove UI Automation or the packaged AMD64 runtime.

</details>
