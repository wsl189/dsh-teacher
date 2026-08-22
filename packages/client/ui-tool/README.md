# @deepseek-ai/dsh-client-ui-tool

English | [中文](README.zh.md)

Client Tool presentation plugin. `ui-conversation` partitions ordered `tool-call` Conversation Nodes into maximal consecutive runs and dispatches each run through `conversation.chat.toolGroup`; this package renders their roots and Code Dispatch children, then dispatches every atomic call through the keyed `tool.call.toolview` slot. Unregistered Tool names use the generic card.

Business UI packages register only their wire Tool names and atomic views. They do not pair Session events, rebuild the transcript, or own root/subcall topology. The Runtime remains authoritative for call/result pairing, lifecycle, and recursive `subCalls` projection; the conversation view remains authoritative for ChatFlow placement.

## Rendering contract

`ToolCallGroup` receives the ordered Chat Node keys for one consecutive run, selection state, the session `cwd`, and Host callbacks for opening files and inspecting calls. A single root without children remains an ordinary Tool row. Two or more calls, counting recursive Code Dispatch children, render as one collapsed action summary; activating that row expands the original root trees. The summary groups edit, read, search, command, code, and generic actions in first-occurrence order, adds `×N` for repeats, and retains running, failed, and stopped state. Unknown Tool names use verb-token classification only for this summary and still use their registered or Generic atomic renderer after expansion.

Each root `ToolCallBlock` already contains recursive `subCalls`. The renderer walks those standard blocks at every depth through the same atomic dispatch path without subscribing to a separate parent-to-children map. Conversation owns consecutive-run membership and the outer flow anchor; Tool owns summary wording, disclosure state, and recursive presentation.

Each root and child wrapper preserves the `data-chat-anchor-key="call:<id>"` and `data-chat-call-id` DOM contract used for paging and selection.

The package also fills `conversation.details.tool` with `ToolDetails`. The row and details renderers share the same pure card models for `terminal`, `read`, `diff`, `search`, and `web` render intents. Unknown intent tags and malformed wire card data fall back to flattened Tool result text.

Generic rows classify known Tool names into search, read, shell, write, edit, code, or generic variants. Running, successful, failed, and interrupted lifecycle states come only from the frozen call/result slice. File paths resolve against the session `cwd` only when the user invokes the Host open-file callback; presentation code does not read Session services.

## Atomic Tool views

An owning business package registers its wire Tool name into `tool.call.toolview`:

```ts ignore-check
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({
    name: 'tool.call.toolview',
    key: '<wire tool name>',
  }, BusinessToolRow))
```

The owner payload is `ToolCallOwnerProps`: `callId`, `toolName`, the frozen `block`, optional `cwd` and `home`, and plain `openFile`/`inspect` callbacks. Path summaries relativize to the session cwd first, then replace a leftover POSIX host home with `~`; `filePath` and Host open keep the authored filesystem path. The registration receives the normal session slot runtime share. It does not receive React nodes, Runtime services, or root/subcall knowledge.

This package currently owns the generic fallback and the built-in shell/pwsh, read, write/edit, grep/glob, web, todo, question, and Code Dispatch presentations. `ui-skill` demonstrates a business-owned registration for `skill`.

Card-specific limits and fallback rules remain in the owning [terminal](../../../.agents/notes/implemented/feature/2026-07-28-web-terminal-card.md), [diff](../../../.agents/notes/implemented/feature/2026-07-30-web-diff-card.md), [read](../../../.agents/notes/implemented/feature/2026-07-30-web-read-card-frontend.md), [search](../../../.agents/notes/implemented/feature/2026-07-30-web-search-card.md), and [web](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card-frontend.md) notes.

## Model Experience

None, as this package renders already logged Tool calls and results without altering model requests, Tool execution, or session events.

#### KV Cache effect

None. The package is client-only presentation.

## Known Limitations and Deferred Work

- The Host excludes `run_code` from Code Mode program bindings, so production events produce one dispatch level; the recursive Runtime/UI contract supports nesting.
- First-party Tool views are colocated here and can move to their owning business packages independently through the keyed slot.
- Tool copy reuses the `ui-conversation` locale namespace.
