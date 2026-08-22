# Agent Note: Shared-modal product onboarding

Status: implemented

English | [中文](2026-08-13-shared-modal-product-onboarding.zh.md)

## Problem

First-run provider onboarding redirected users into Settings before they could enter the one required API key. That made a short setup flow cross unrelated surfaces and left onboarding UI ownership split across packages. The credential step needs modal presentation without changing the Host settings and credential boundaries.

## Decision

**The existing Models client plugin owns provider onboarding.** `ui-settings-models` registers `deepseek-official` in `settings.onboarding`. The shell mounts only the first incomplete entry, so independently contributed dialogs cannot stack. No additional client package or plugin row is introduced.

**Onboarding steps use one reusable modal component.** `OnboardingModal` wraps the existing ui-primitives `Modal`, supplies the title and content geometry, and owns `#root` inert for exactly the visible lifetime. Escape and mask clicks do not silently complete mandatory onboarding; each step exposes only its explicit actions. A step still loading private facts returns `null`, so it paints and blocks nothing.

**The credential dialog reuses the existing editor and write boundary.** The Models join still decides whether any provider is usable. When the official DeepSeek reference is writable and missing, `ProviderEditor` renders in credential-only mode inside the shared modal. It validates the key and calls the existing `credentials.set`; it does not mutate provider settings. Save and continue waits for the write and refreshed readiness, while Configure later completes only the current coordinator pass.

The product carries no mandatory lifecycle notice before this step. The [Web product identity simplification](../simplification/2026-08-22-simplify-web-product-identity.md) removes that notice and its acknowledgement state without changing provider readiness or secret handling.

## Alternatives considered

**A separate client plugin for the credential step.** Rejected because Models already owns provider readiness, credential invalidation, editor behavior, and onboarding copy.

**Move acknowledgement or credential logic into a new Host API.** Rejected because both backend contracts already express the required state and writes. A new endpoint would widen scope without changing user capability.

**Keep the credential step as navigation into Models.** Rejected because the key is the only required first-run field, and the existing editor can expose that write safely without sending the user through a second dialog.

**Keep the former full-viewport stage.** Rejected because the requested onboarding is a pair of dialogs over the current app, and the common ui-primitives modal already provides the appropriate portal, mask, and accessibility contract.

## Consequences

A fresh profile sees an inline DeepSeek key dialog only when no provider is usable. Secrets remain write-only in `.credentials.yaml`, and already-ready or unsupported deployments render no onboarding chrome while readiness loads. The Models package owns provider-onboarding presentation as well as provider configuration; its README and browser coverage make that responsibility explicit.
