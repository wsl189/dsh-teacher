# Agent Note: Tool scheduler identity across source and built imports

Status: implemented

English | [中文](2026-09-18-tool-scheduler-module-identity.zh.md)

## Problem

The supported `pnpm dsh` launcher uses tsx's ESM paths mapping while Cordis can load built plugin exports in the same process. A module-local scheduler symbol gives those imports different keys. The agent loop then finds no scheduler on `ctx.tools` and ends the turn with `Cannot read properties of undefined (reading 'prepare')` after recording a tool call. Question segmentation and structured-output children cannot submit their results even when the model responds successfully. An assembled test using only built modules does not expose this failure.

## Decision

`TOOL_RUNTIME_SCHEDULER` uses `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`. The key is shared within the process; each ToolRuntime instance continues to own its scheduler, registrations, policy, and execution state. The symbol remains internal and does not authorize tool execution independently of the existing pipeline.

The [source-launch decision](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md) retains ownership of the launcher. A focused headless process test executes the same real shell call through both the source ESM launcher and the installed launcher, observes the tool result and completed final response, and isolates each run's homes and working directory. The source case reproduces the missing-scheduler failure with a module-local symbol.

## Alternatives considered

**Start only the built launcher.** This avoids mixed module imports but leaves the supported source command broken. It cannot replace a fix for developers using `pnpm dsh`.

**Replace the module-loading pipeline.** Loader and tsx have wider responsibilities than this internal service key. A global symbol makes the existing consumers interoperable without changing dependency resolution or plugin activation.

## Consequences

Native and PTC tool scheduling can address the registry across the source and artifact imports used by one supported launch. This does not make incompatible package versions interoperable. Workbench behavior, model assignments, permissions, and third-party plugin configuration stay unchanged.
