# Agent Note: Univer uses upstream evaluation and runtime licenses

Status: implemented

English | [中文](2026-09-01-univer-viewer-evaluation.zh.md)

## Problem

The distribution must open supported evaluation documents without shipping an embedded development license. The plugin bundles separately licensed Univer modules whose validation and feature limits remain authoritative.

## Decision

The [headless distribution decision](../simplification/2026-09-19-univer-headless-office.md) supersedes the Viewer interface; evaluation and runtime-license rules continue for content tools and background rendering. The [runtime patch](../../../../third-party/dsh-univer-office/runtime.patch) removes development-license fallbacks from the Host and document worker; explicit `UNIVER_LICENSE` values remain runtime inputs. DSH supplies no replacement entitlement and preserves upstream validation, watermarks, and feature limits. The [bundled-extension decision](../feature/2026-08-25-bundled-extensions-and-qq-speech.md) owns artifact distribution, telemetry, and secret ownership.

## Alternatives considered

**Require a license before opening any document.** This prevents evaluation supported by the published Viewer.

**Ship a development license or disable enforcement.** A bundled credential introduces expiration and distribution obligations; disabling validation would grant entitlements DSH does not own.

## Consequences

The [recorded Web scenario](../../../../snapshots/web/univer-viewer/snapshot.yml) exercises the packaged content tools without a license and verifies that the removed Viewer is unavailable. Real Office generation tests retain exported-content and background-render checks. These cases do not validate a commercial license.
