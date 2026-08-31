# Agent Note: Univer Viewer accepts an absent runtime license

Status: implemented

English | [中文](2026-09-01-univer-viewer-evaluation.zh.md)

## Problem

The bundled Univer Viewer rejects an empty runtime license before creating its editor. A default installation therefore reports `Univer Office requires a valid UNIVER_LICENSE environment variable` instead of displaying the Sheet. [Univer's licensing guide](https://docs.univer.ai/guides/pro/license) permits evaluation without a license, subject to upstream watermarks and feature limits; the additional Viewer check prevents that supported mode.

## Decision

The Viewer accepts every string returned in the Gateway's runtime `license` field, including an empty string, and trims it before passing it to Univer. The Viewer still rejects malformed configuration and unsuccessful HTTP responses. Univer retains all license validation, watermarks, and feature restrictions. No embedded development license or replacement entitlement is supplied.

The [source patch](../../../../third-party/dsh-univer-office/viewer-license.patch) records the Viewer change and package README updates. DSH rebuild 2 contains the rebuilt Viewer and unchanged Host, Gateway, render, worker, and native dependency declarations. The [bundled-extension decision](../feature/2026-08-25-bundled-extensions-and-qq-speech.md) continues to own artifact distribution, telemetry, and secret exclusion; this note replaces only its requirement for a license before Viewer startup.

## Alternatives considered

**Require a license before opening any document.** This blocks upstream evaluation and makes the default installation fail after the agent has created a document.

**Restore the embedded development license.** The Viewer can use upstream evaluation without shipping a credential. An embedded license adds expiration and distribution obligations unrelated to opening a document.

**Remove Univer's license enforcement.** DSH does not grant product entitlements. Its wrapper must preserve upstream validation and limits.

## Consequences

Users can open Sheets without configuring `UNIVER_LICENSE`; licensed features still require an appropriate valid license. Runtime environment delivery and commercial distribution obligations remain unchanged. The [recorded Web scenario](../../../../snapshots/web/univer-viewer/snapshot.yml) and its [browser test](../../../../apps/web/tests/univer-viewer.e2e.ts) exercise the real packaged Gateway and Viewer, require the Sheet grid, compare the persisted tool round and accessible interface, reject a non-string runtime value, and verify forwarding of an explicit environment value. The scenario uses authored model replay and a synthetic Sheet fixture; it does not establish a live model round or validate a commercial license.
