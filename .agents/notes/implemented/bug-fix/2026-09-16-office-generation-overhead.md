# Agent Note: Reduce repeated work in chat Office generation

Status: implemented

English | [中文](2026-09-16-office-generation-overhead.zh.md)

## Problem

Univer starts a Node content worker for each built-in execute, inspect, or export operation. Small writes in separate tool calls repeat worker startup and JavaScript compilation. Whole-class API lookups also return members that the model does not need for the next operation.

The packaged worker needs native formula and exchange modules that the upstream npm dependency list omits. The built Gateway reproduces a missing formula-binding failure before a document write can complete; this is a dependency failure, not a slow successful export.

## Decision

The [Univer repack](../../../../third-party/README.md#artifact-notes) includes the exact native dependency versions from the upstream 0.3.0 lockfile. Each operation retains its own worker process. Node's compile cache reuses compiled JavaScript without retaining a live document runtime between operations. The worker forwards `NODE_COMPILE_CACHE` and `NODE_DISABLE_COMPILE_CACHE`, defaulting the cache directory to `<DSH_HOME>/cache/dsh-univer-office/node`; Node owns cache invalidation for code and runtime changes.

The worker also receives runtime `UNIVER_LICENSE`. The [license decision](2026-09-01-univer-viewer-evaluation.md) continues to own entitlement, validation, and development-license exclusions.

The Univer skills group related, known Facade edits in one execute call and request exact API members or types together. Sheets write rectangular data with one `setValues` call and wait for calculation before reading results. Docs and Sheets independently read every required field after each completed authoring batch. Slides retain per-page SVG creation, inspection, linting, and screenshots; only API lookup and related Facade edits are grouped. Worktree state checks and final visual verification remain required.

## Alternatives considered

**Keep a worker alive between operations.** A worker pool would require additional document-state, cancellation, and teardown rules. Compile caching reduces repeated compilation while preserving the current process isolation.

**Skip readback or visual verification.** Fewer calls would conceal missing content, incorrect formulas, or layout defects. Batching changes when validation runs, not which fields and pages require validation.

**Load complete API classes by default.** Broad inventories remain useful for discovery, but exact member and type queries are sufficient when the intended operations are known.

## Consequences

The cache does not remove process startup or Univer runtime initialization. An empty cache must be populated before subsequent workers can reuse it. Model reasoning, network requests, browser rendering, and screenshots can still dominate the time visible in chat.

This change covers chat Office generation. Workbench exporters, Settings → Models configuration, and PPT Master routing retain their existing behavior. The [official-release integration decision](../architecture/2026-09-16-official-release-integration.md) continues to own the distribution composition.

## Verification

The built Gateway worker reproduces the missing native dependency failure. With both required native packages available, the same built-in route writes, independently reads back, and exports DOCX, XLSX, and PPTX content; exported ZIP members are checked for the expected text, cells, and formulas.

The [generation diagnostic](../../../../packages/bundle/web-app/tests/univer-generation.perf.ts) compares disabled caching with an initially empty cache that becomes warm across repeated workers. Both variants use the same native dependencies. The Linux Node 24.14.0 workload contains a 20-paragraph document, a 200 × 8 sheet with 200 SUM formulas, and three slides with native text shapes. Each format has three samples of writing, independent readback, export, and ZIP-content checks. Timing excludes Gateway cold startup, model calls, network requests, browser rendering, and screenshots. The slide workload does not measure the SVG authoring workflow or PPT Master.

With package runtime outputs built, compile and run the diagnostic from the repository root. It resolves the installed Cordis and Univer artifacts, creates a private `DSH_HOME`, removes ambient native-module and license overrides, and restores the environment after disposing the plugin. Each invocation starts with a fresh cache; only workers within that invocation share it. `--fragmented` runs one document sample instead of the three-format set.

```sh
pnpm exec tsdown --no-config --platform node --format esm --no-dts --out-dir packages/bundle/web-app/.dsh-build packages/bundle/web-app/tests/univer-generation.perf.ts
node packages/bundle/web-app/.dsh-build/univer-generation.perf.mjs --disable-cache
node packages/bundle/web-app/.dsh-build/univer-generation.perf.mjs
node packages/bundle/web-app/.dsh-build/univer-generation.perf.mjs --disable-cache
node packages/bundle/web-app/.dsh-build/univer-generation.perf.mjs --disable-cache --fragmented
```

The 2026-09-16 measurements have the following median total times. Re-disabling caching returns the workload close to its original cost, providing a control for host warmup. Every generated file passes readback and exported-content checks.

| Workload | Cache disabled | Cache enabled | Cache disabled again |
|---|---:|---:|---:|
| DOCX, 20 paragraphs | 3433.94 ms | 2649.37 ms | 3428.45 ms |
| XLSX, 200 × 8 cells | 2490.92 ms | 1725.30 ms | 2550.62 ms |
| PPTX, 3 native-text slides | 3406.47 ms | 2654.92 ms | 3450.90 ms |

The first document with an empty cache takes 3066.79 ms; subsequent document samples take 2649.37 ms and 2623.79 ms. These local measurements establish worker savings, not an end-to-end chat latency promise.

A separate synthetic comparison writes those 20 paragraphs one at a time with caching disabled. It takes 24916.26 ms and 22 workers, including independent readback and export, versus the batched median of 3433.94 ms and three workers. Both variants pass the same content checks and export a 4944-byte DOCX. This comparison isolates the cost of fragmentation; it does not establish a speedup for every real request.
