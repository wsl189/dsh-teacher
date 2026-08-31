# Agent Note: Bundled Windows-MCP desktop control

Status: implemented

English | [中文](2026-08-31-bundled-windows-mcp.zh.md)

## Problem

Windows-MCP can automate visible Windows applications, but treating the supplied Python repository as an ordinary user-configured MCP server would not provide an install-and-use desktop feature. Users would still need to install and maintain Python, a package environment, Windows-MCP, and a matching MCP row. The desktop installer would also have no proof that its Python dependency closure, native wheels, or upstream tool surface matched the reviewed release.

Mounting all upstream tools would grant substantially more authority than visible UI automation needs. PowerShell, registry, process, clipboard, filesystem, notification, and scraping operations overlap existing DSH capabilities or bypass their policies. Even the remaining mouse, keyboard, screenshot, and UI Automation operations act outside the DSH sandbox and must not become available silently.

The upstream 0.8.5 dependency declaration also imports GPL-licensed `fuzzywuzzy` and includes its optional Levenshtein acceleration closure. Shipping those distributions in a generally MIT-licensed installer would add a distribution obligation that is unnecessary because the same API is already available from the MIT-licensed TheFuzz/RapidFuzz closure.

## Decision

`@deepseek-ai/dsh-windows-mcp` is a Host composition plugin in `packages/mcp/windows-mcp`. The shipped Web profile mounts it disabled. When its `windows-mcp` settings namespace becomes enabled, it creates a real Loader child for `@deepseek-ai/dsh-mcp-client`; disabling or changing runtime fields removes and joins the current child before reconciling another one. A missing runtime or failed child publishes no desktop tools and records an error without failing Host startup. This failure policy keeps a persisted enabled setting reachable so the user can turn it off or retry after repairing the payload.

The composition publishes exactly `App`, `Click`, `DisplayInventory`, `Move`, `MultiEdit`, `MultiSelect`, `Screenshot`, `Scroll`, `Shortcut`, `Snapshot`, `Type`, `Wait`, and `WaitFor` under the fixed `mcp__windows__` namespace. The allowlist is passed independently to Windows-MCP's `--tools` argument and the MCP bridge's new exact, case-sensitive `includeTools` filter. The generic bridge validates duplicate advertised names before filtering, so an invalid upstream list cannot hide a duplicate outside the selected subset. Any unreviewed name that reaches the reserved namespace is denied.

Every selected tool call first delegates to downstream `tools/pre-execute` policy. A denial remains final. A downstream allowance becomes an approval request stating that Windows desktop automation can read or control applications outside the DSH sandbox. The MCP child cannot execute until the user approves through the ordinary interaction path.

The Windows x64 desktop build assembles `apps/desktop/runtime/windows-mcp` from the official CPython 3.14.7 AMD64 embedded archive and the Windows-MCP 0.8.5 wheel. `third-party/windows-mcp/runtime.json` records versions, source identity, URLs, SHA-256 digests, and the local patch digest. `requirements.lock` pins the complete binary-only wheel closure with hashes; pip runs with `--require-hashes`, `--only-binary=:all:`, and `--no-deps`. The build applies `patches/use-thefuzz.patch`, replacing the sole `from fuzzywuzzy import process` import with `from thefuzz import process`, and excludes `fuzzywuzzy`, `Levenshtein`, and `python-Levenshtein`. The notices generator fails if those packages return, TheFuzz disappears, or the pinned patch changes without its metadata.

The runtime build completes a real FastMCP stdio initialize/list/call smoke and requires the exact thirteen-tool set plus a successful inert `Wait` call. Electron-builder copies the resulting directory to `resources/windows-mcp`; the payload gate requires CPython, its standard-library archive and license, Windows-MCP metadata, and representative Python native modules. Packaged desktop launches ignore ambient `DSH_WINDOWS_MCP_*` overrides and provide environment paths only when `resources/windows-mcp/python.exe` exists. Source launches retain explicit developer overrides.

The Plugins settings page owns a Windows desktop card. It can enable the feature only when the Host reports a non-empty bundled runtime command, can always turn off an already-enabled value, and keeps the outside-sandbox approval warning visible. No Python path is user-editable in the installed UI.

## Alternatives considered

**Require a user-installed MCP server.** This keeps the installer smaller but does not meet installation-ready behavior and lets independent Python resolution drift away from the reviewed dependency and tool set.

**Bundle the upstream project unchanged.** This would carry unused GPL dependencies and publish authority that the desktop-control use case does not require. A fixed local patch and two independent allowlist checks reduce both distribution and runtime scope.

**Reimplement desktop automation as native TypeScript tools.** That would duplicate Windows-MCP's UI Automation and screenshot implementation, its schema surface, and its Windows-specific native integration. The existing MCP client already owns transport, discovery, registration, result projection, and reconnect behavior.

**Enable the feature by default.** This would add thirteen schemas to every request and start an outside-sandbox automation process for users who did not request it. Default-off activation keeps authority and token cost explicit.

## Consequences

- Windows x64 desktop users can enable the integration without installing Python or creating an MCP configuration; other builds expose no usable runtime.
- A missing or broken runtime cannot prevent DSH from opening; the enabled setting remains visible while the tool namespace stays absent.
- Enabling adds thirteen tool schemas to model requests and starts one private Python MCP child. Disabling removes both without restarting DSH.
- Approval is a policy gate, not OS containment. An approved call operates the interactive Windows session and can observe or change visible applications.
- An upstream, Python, dependency, patch, or tool-surface upgrade is one review unit and requires another Windows runtime build, smoke, payload validation, notices update, and installer artifact.
- The installer grows by the embedded Python runtime and pinned wheel closure, while GPL fuzzy-matching packages stay absent.

## Testing

The generic MCP tests cover filter validation, exact and case-sensitive selection, discovery updates, and duplicate rejection before filtering. The Windows composition test boots a real `cordis.yml` through Loader, captures the child configuration, proves only the thirteen public names register, verifies unreviewed names remain absent, checks the approval gate prevents execution, live-disables the child through settings, and proves missing or failed runtimes leave the settings namespace available. Client tests cover the boolean field controller, runtime-unavailable state, card rendering, locale-owned copy, and the seven-card registration order. Desktop environment tests prove packaged paths are trusted only beneath `resources/windows-mcp` while source overrides remain available. The Windows workflow assembles and smokes the real pinned runtime before packaging, and the desktop payload test pins its required files.
