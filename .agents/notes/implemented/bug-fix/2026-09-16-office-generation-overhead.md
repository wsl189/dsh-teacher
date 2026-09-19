# Agent Note: Reduce repeated work in chat Office generation

Status: implemented

English | [中文](2026-09-16-office-generation-overhead.zh.md)

## Problem

Univer starts a Node content worker for each built-in execute, inspect, or export operation. Small writes in separate tool calls repeat worker startup and JavaScript compilation. Whole-class API lookups also return members that the model does not need for the next operation.

The packaged worker needs native formula and exchange modules that the upstream npm dependency list omits. The built Gateway reproduces a missing formula-binding failure before a document write can complete; this is a dependency failure, not a slow successful export.

The API tool description also recommends whole-class lookups, contradicting the focused-query guidance in the skills. Its `limit` parameter applies only to `find`; repeating `show` with different limits returns the same class inventory. PPT Master's project initializer independently defaults to a directory beside the installed skill, which can lie outside the session's writable workspace. Reusable helpers written to temporary directories can also disappear between tools: the Linux bwrap runner mounts a fresh `/tmp` for each command, separate from files written by Host filesystem tools.

## Decision

The [Univer repack](../../../../third-party/README.md#artifact-notes) includes the exact native dependency versions from the upstream 0.3.0 lockfile. Each operation retains its own worker process. Node's compile cache reuses compiled JavaScript without retaining a live document runtime between operations. The worker forwards `NODE_COMPILE_CACHE` and `NODE_DISABLE_COMPILE_CACHE`, defaulting the cache directory to `<DSH_HOME>/cache/dsh-univer-office/node`; Node owns cache invalidation for code and runtime changes.

The worker also receives runtime `UNIVER_LICENSE`. The [license decision](2026-09-01-univer-viewer-evaluation.md) continues to own entitlement, validation, and development-license exclusions.

The Univer skills group related, known Facade edits in one execute call and request exact API members or types together. Sheets write rectangular data with one `setValues` call and wait for calculation before reading results. Docs and Sheets independently read every required field after each completed authoring batch. Slides retain per-page SVG creation, inspection, linting, and screenshots; only API lookup and related Facade edits are grouped. Worktree state checks and final visual verification remain required.

The API tool schema gives the same focused-query guidance and states that `limit` does not shorten `show` responses. A missing label sends discovery to `find`; the instructions reject repeated guessed type names and distinguish an undocumented capability from a permission failure. Complete class inventories remain available when needed. The Univer and PPT Master instructions place reusable scripts, virtual environments, and shared intermediate files under the session workspace because temporary directories may be isolated per command or tool.

PPT Master's provider appends the current session workspace to the loaded instructions and requires an explicit `project_manager.py init --dir` inside it unless the user requests another permitted location. The upstream skill files, resource directory, workflow selection, attribution guard, and project-local export backups remain intact.

## Alternatives considered

**Keep a worker alive between operations.** A worker pool would require additional document-state, cancellation, and teardown rules. Compile caching reduces repeated compilation while preserving the current process isolation.

**Skip readback or visual verification.** Fewer calls would conceal missing content, incorrect formulas, or layout defects. Batching changes when validation runs, not which fields and pages require validation.

**Load complete API classes by default.** Broad inventories remain useful for discovery, but exact member and type queries are sufficient when the intended operations are known.

## Consequences

The cache does not remove process startup or Univer runtime initialization. An empty cache must be populated before subsequent workers can reuse it. Model reasoning, network requests, browser rendering, and screenshots can still dominate the time visible in chat.

These instructions do not change filesystem permissions. Workspace-local Office generation and export do not inherently require Full Access; external output locations, missing runtime dependencies, model tool selection, and artifact quality require separate diagnosis. A successful export alone does not establish task completion or correct chart data.

This change covers chat Office generation. Workbench exporters, Settings → Models configuration, and PPT Master routing retain their existing behavior. The [official-release integration decision](../architecture/2026-09-16-official-release-integration.md) continues to own the distribution composition.

## Verification

The built Gateway worker reproduces the missing native dependency failure. With both required native packages available, the same built-in route writes, independently reads back, and exports DOCX, XLSX, and PPTX content; exported ZIP members are checked for the expected text, cells, and formulas.

The [generation diagnostic](../../../../packages/bundle/web-app/tests/univer-generation.perf.ts) compares disabled caching with an initially empty cache that becomes warm across repeated workers. Both variants use the same native dependencies. The Linux Node 24.14.0 workload contains a 20-paragraph document, a 200 × 8 sheet with 200 SUM formulas, and three slides with native text shapes. Each format has three samples of writing, independent readback, export, and ZIP-content checks. Timing excludes Gateway cold startup, model calls, network requests, browser rendering, and screenshots. The slide workload does not measure the SVG authoring workflow or PPT Master.

With package runtime outputs built, compile and run the diagnostic from the repository root. It resolves the installed Cordis and Univer artifacts, creates a private `DSH_HOME`, removes ambient native-module and license overrides, and restores the environment after disposing the plugin. Each invocation starts with a fresh cache; only workers within that invocation share it. `--fragmented` runs one document sample instead of the three-format set.

```sh
cd packages/bundle/web-app
pnpm exec tsdown --no-config --platform node --format esm --no-dts --out-dir .dsh-build tests/univer-generation.perf.ts
node .dsh-build/univer-generation.perf.mjs --disable-cache
node .dsh-build/univer-generation.perf.mjs
node .dsh-build/univer-generation.perf.mjs --disable-cache
node .dsh-build/univer-generation.perf.mjs --disable-cache --fragmented
```

The 2026-09-16 measurements have the following median total times. Re-disabling caching returns the workload close to its original cost, providing a control for host warmup. Every generated file passes readback and exported-content checks.

| Workload | Cache disabled | Cache enabled | Cache disabled again |
|---|---:|---:|---:|
| DOCX, 20 paragraphs | 3433.94 ms | 2649.37 ms | 3428.45 ms |
| XLSX, 200 × 8 cells | 2490.92 ms | 1725.30 ms | 2550.62 ms |
| PPTX, 3 native-text slides | 3406.47 ms | 2654.92 ms | 3450.90 ms |

The first document with an empty cache takes 3066.79 ms; subsequent document samples take 2649.37 ms and 2623.79 ms. These local measurements establish worker savings, not an end-to-end chat latency promise.

A separate synthetic comparison writes those 20 paragraphs one at a time with caching disabled. It takes 24916.26 ms and 22 workers, including independent readback and export, versus the batched median of 3433.94 ms and three workers. Both variants pass the same content checks and export a 4944-byte DOCX. This comparison isolates the cost of fragmentation; it does not establish a speedup for every real request.

The 2026-09-17 real-chat baseline uses the existing built Web profile with Univer repack 4, Linux workspace-write, and the configured local Ollama `qwen3.8:27b` model. Three sequential tasks use the same 36-row synthetic campus-energy CSV, separate workspaces, and an approximately 20-minute observation cap. No build or test runs overlap the measurements. These are individual unfinished tasks, not completion-time or before/after speedup measurements.

| Requested artifact | Observed time | Tool execution | API queries | State at stop |
|---|---:|---:|---:|---|
| 12-slide PPTX | 1224.393 s | 152.788 s | 17 | Nine populated pages; three blank pages |
| 8–10-page DOCX | 1216.895 s | 38.339 s | 55 | Python-written DOCX exists; final verification unfinished |
| Four-sheet XLSX | 1198.817 s | 47.179 s | 211 | Only an empty two-sheet test export |

Intervals from model-step start to assistant response account for 87–97% of these runs; they include context processing, model generation, and transport, not isolated inference time. Word repeatedly queries the same table API and retries temporary-directory helpers; Excel repeatedly guesses absent type names. A separate PPT recovery turn exports the partial draft in 1197 ms under workspace-write. Word also writes its DOCX under workspace-write after placing its virtual environment and script inside the workspace. Its independent render contains 12 pages, an empty contents page, separated headings and captions, and a scenario table whose water savings conflict with the stated price. These results support focused discovery, workspace-local helpers, and retained verification; they do not prove that revised instructions make complex tasks complete reliably or that Linux permission behavior matches Windows.

The same Excel prompt and CSV in a fresh workspace with the revised built profile reaches batch authoring, then repeatedly passes Chart builders to `insertChart` instead of built Chart information. Observation stops at 541.923 s with 19 API queries returning 185775 characters, no export, and no permission denials. The different unfinished endpoints do not establish an end-to-end speedup.

A separate corrective prompt identifies that argument error. This assisted turn takes 140.866 s and exports a four-sheet XLSX with 172 formulas under workspace-write. Independent ZIP/XML checks confirm all 36 source rows and annual energy totals, but find only two Charts referencing dashboard metrics rather than the requested source ranges. Monthly population and device formulas average the three buildings instead of adding their distinct populations, so dependent per-person values are wrong despite having no cached Excel error cells. This is a diagnostic draft, not a completed complex-workbook result. Functional generation smokes and instruction snapshots do not replace this task-specific validation.
