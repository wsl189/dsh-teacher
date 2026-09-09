# Agent Note: automatic model connection verification

Status: implemented

English | [中文](2026-09-09-automatic-model-connection-verification.zh.md)

## Problem

Supplier status and a selected access-plan dropdown do not identify which saved credential and endpoint are being managed. Credential presence cannot prove that a model request succeeds. A separate testing step after every edit leaves connection failures easy to miss, while testing every model repeats paid requests for the same credentials and endpoint.

## Decision

Service access lists each saved provider route as one connection, labeled with its supplier and access plan when a preset supplies them. The add directory owns unconfigured presets and custom creation. This presentation supersedes the supplier rail in the [supplier settings decision](../architecture/2026-09-01-supplier-grouped-model-settings.md); independent profiles, credentials, protocols, media routes, and use-case assignments retain that decision's ownership.

Successful saves automatically verify each independent connection through the Session Controller using one configured conversation or vision model. A result identifies the connection fields, selected model id, and credential revision. Catalog additions, names, and model budgets preserve it; endpoint, protocol, or key changes invalidate it. The selected model stays stable while it remains in the catalog; removing it selects another. Each connection has at most one active request, bounded by deployment policy, and ignores late replies after supersession or disposal. Failure retains the saved configuration and offers a retry without testing other models. Merely opening settings performs no paid checks.

Each check sends a tool-free short request through the registered adapter and records its input, header, chunks, and response in a private diagnostic session. A successful catalog lookup or stored key never substitutes for a successful request. A verified connection does not imply that every model has been tested or that the credential grants access to all models. Image-generation and speech routes are outside automatic verification; media-only connections show configured status, and model rows show names and types without verification statuses. Summaries identify the test model once and derive model counts and use-case assignments from saved state. Navigation to assignments performs no implicit reassignment.

## Alternatives considered

- Manual verification after every save adds a separate required user action and leaves mistakes undiscovered.
- Treating discovery or credential presence as success cannot detect a rejected model request.
- Checking every model independently repeats paid requests for one connection; reusing results without credential invalidation can claim success for a replaced key.
- Automatically generating images or submitting recordings adds a different paid operation without establishing that the user's actual task will work.

## Consequences

Configured, verifying, verified, and failed states have separate meanings. Verification incurs small model requests after saves and retains diagnostic logs. Results are local to the page store and do not become durable health guarantees. Unit tests cover actual adapter outcomes, cancellation, connection-result reuse, and obsolete replies; the browser scenario covers saved connections and automatic failure recovery over the composed Host. The [recorded diagnostic session](../../../../snapshots/web/model-verification/session.jsonl) fixes the tool-free input and persisted output for keyless replay.
