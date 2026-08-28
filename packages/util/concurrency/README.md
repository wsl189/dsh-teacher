# dsh-concurrency

English | [中文](README.zh.md)

A zero-dependency asynchronous mapping primitive for work that must overlap without unbounded admission. It is a library, not a service or plugin: consumers retain all business ownership, cancellation, and result interpretation.

## API

```ts
import { mapConcurrently } from '@deepseek-ai/dsh-concurrency'
```

`mapConcurrently(inputs, concurrency, mapper)` starts at most `concurrency` mapper calls at once and resolves one result per input in source order. The limit must be a positive safe integer.

If a mapper rejects, the scheduler stops admitting unstarted inputs and waits for every call already in flight to settle. It then rethrows the observed rejection with the smallest input index. This quiescence guarantee lets a caller handle failure without late in-flight work continuing after the returned promise settles.

The scheduler does not treat an output value as failure. A consumer with a result union converts its rejected variant into a thrown capability-owned error before returning from the mapper.

## Model Experience

Indirectly, through consumers that use bounded overlap to reduce the wall-clock latency of model-backed work without changing request contents.

#### KV Cache effect

No direct invalidation; each consumer owns its model request and cache prefix.

## Known Limitations and Deferred Work

- **No cancellation** — admitted mapper calls run until their own promises settle; a consumer that needs cancellation must pass and observe its own signal.
- **No rollback** — side effects completed before another input fails remain the consumer's responsibility.
- **No priority or dynamic capacity** — admission follows source order under one fixed limit for the complete call.
