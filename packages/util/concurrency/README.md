---
description: "Zero-dependency bounded asynchronous mapping with source-order results and quiescent failure for model-backed and ordinary concurrent work."
kind: "package-library"
---

# @deepseek-ai/dsh-concurrency

English | [中文](README.zh.md)

## Summary

A zero-dependency asynchronous mapping primitive for work that must overlap without unbounded admission. It is a library, not a service or plugin: consumers retain all business ownership, cancellation, and result interpretation. Results preserve source order, and a failure is not reported until every already-admitted mapper has settled.

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

Use this library when independent inputs may overlap but the caller needs a fixed admission limit and must regain control only after all admitted work becomes quiescent.

### API

```ts
import { mapConcurrently } from '@deepseek-ai/dsh-concurrency'
```

`mapConcurrently(inputs, concurrency, mapper)` starts at most `concurrency` mapper calls at once and resolves one result per input in source order. The limit must be a positive safe integer.

If a mapper rejects, the scheduler stops admitting unstarted inputs and waits for every call already in flight to settle. It then rethrows the observed rejection with the smallest input index. This quiescence guarantee lets a caller handle failure without late in-flight work continuing after the returned promise settles.

The scheduler does not treat an output value as failure. A consumer with a result union converts its rejected variant into a thrown capability-owned error before returning from the mapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One shared cursor admits work while the active count remains below the validated limit. Results occupy their source indexes. The first observed rejection stops new admission, while all active mappers settle before the smallest-index rejection is rethrown; the caller therefore sees no late work after the returned promise rejects.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`src/index.ts`](src/index.ts) — exact exported function and type contract.
- [Teacher workbench Host](../../host/teacher-workbench/README.md) — bounded question-segmentation Consumer.
- [Web client](../../client/web/README.md) — browser composition that seeds the package for client bundles.

<a id="model-experience"></a>
## Model Experience

Indirectly, through consumers that use bounded overlap to reduce the wall-clock latency of model-backed work without changing request contents.

#### KV Cache effect

No direct invalidation; each consumer owns its model request and cache prefix.

## Known Limitations and Deferred Work

- **No cancellation** — admitted mapper calls run until their own promises settle; a consumer that needs cancellation must pass and observe its own signal.
- **No rollback** — side effects completed before another input fails remain the consumer's responsibility.
- **No priority or dynamic capacity** — admission follows source order under one fixed limit for the complete call.

<a id="dev-note"></a>
### Dev Note

Keep this library free of capability-specific cancellation, result unions, retries, and progress reporting; Consumers own those policies.
