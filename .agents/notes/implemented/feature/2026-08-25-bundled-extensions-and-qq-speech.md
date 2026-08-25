# Agent Note: Bundled extensions and QQ speech input

Status: implemented

English | [中文](2026-08-25-bundled-extensions-and-qq-speech.zh.md)

## Problem

The Windows installer is not a complete product migration if IM, general cron management, and Office workspace preview still depend on profile-local plugin installation. A new machine could install the EXE successfully yet expose a different interface and tool roster because those executable dependencies were absent from the application closure. The plugins' credentials, bot sessions, schedules, and user data have a different lifecycle: embedding those machine-specific values would leak private state and make an installer overwrite runtime data.

Composer and Teacher Workbench voice controls also used browser-native speech recognition independently from the QQ integration's configurable ASR service. The duplicated path gave the same installation two speech providers, two language owners, browser-dependent network behavior, and no Host-side validation or resource limits.

## Decision

`@deepseek-ai/dsh-web-app` directly depends on and mounts the reviewed `@xmanrui/dsh-im` 1.0.3 and `dsh-plugin-cron` 0.1.3 tarballs retained under `third-party/`, plus published `@huanlin/dsh-plugin-better-sidebar-plugin-office` 0.1.2. The Office row follows the built-in better-sidebar row so it registers DOCX, XLSX, and PPTX viewers against the existing file-viewer registry. These packages are part of the ordinary Web production closure and therefore also part of the [Windows desktop installer](2026-08-25-windows-desktop-updates.md); users do not install them into a profile. IM configuration and credentials, cron records, bot routing state, and all other mutable data remain below `DSH_HOME`, so a machine migration copies that directory separately when its private state should move.

The upstream plugins retain their own runtime ownership. IM continues to own platform connections, QQ settings, mobile-notification routing, and `qq_send_local_file`; cron continues to own its general command schedules, history, management surface, and four model tools. Bundling changes availability, not those responsibilities. The [mobile workbench reminder decision](2026-08-22-mobile-workbench-reminders.md) still keeps reminder timers and acknowledgement in the workbench document rather than mirroring them into cron. The [built-in better-sidebar decision](2026-08-23-built-in-better-sidebar.md) still owns the workbench mount and duplicate guard; this decision explicitly accepts the Office extension's AGPL-3.0 distribution obligations and keeps it in generated third-party notices.

`@deepseek-ai/dsh-speech` defines a provider-selecting Host capability and the typed `speech.transcribe` Remote. `@deepseek-ai/dsh-speech-qq` registers provider `qq-config`. For every recording it re-reads `integrations/dsh-qq/config.json` and resolves `DSH_QQ_ASR_API_KEY` through the credentials service, so changes made in the QQ settings surface affect the next request without a Host restart. The adapter submits one OpenAI-compatible multipart transcription request with the configured model and language and returns only normalized non-empty text plus provider identity. The QQ integration remains the sole owner of ASR endpoint, model, language, enablement, and credential input; the [durable Teacher Workbench decision](2026-08-17-durable-teacher-workbench.md) no longer owns a speech-language setting.

Composer and Teacher Workbench controls share one MediaRecorder hook. Each operation requests microphone access, collects one complete WebM, Ogg, MP4, MP3, or WAV blob, releases every media track, converts the blob to canonical base64, and calls the Host Remote. Recording or transcription blocks conflicting submit actions, while accepted text remains editable through the same draft, task, memo, or ledger path as typed text. Audio bytes and provider responses are never persisted or logged.

The QQ adapter accepts HTTPS endpoints and loopback HTTP only. It rejects embedded credentials, query strings, fragments, and redirects; bounds decoded audio and response bytes; validates canonical base64, media types, model, language, HTTP status, and response JSON; enforces a request deadline; and returns stable diagnostics without provider response bodies, credentials, or audio. These checks keep browser microphones and QQ secrets outside third-party client code even though the selected ASR service receives each complete recording.

## Alternatives considered

**Keep the three plugins as profile installations.** This preserves a smaller application dependency closure but makes a fresh EXE installation incomplete, lets profile state silently change the shipped UI and tool roster, and requires a second installation procedure on every computer.

**Embed plugin configuration and user data in the installer.** Executable code is reproducible build input; tokens, bot sessions, cron records, and local work are mutable private state. Shipping or replacing them would leak credentials and make upgrades destructive. `DSH_HOME` remains the explicit migration unit for that state.

**Retain Web Speech API recognition for application controls.** This delegates provider, retention, language behavior, and browser availability to each browser while QQ already exposes an operator-selected ASR endpoint. One Host capability makes both UI surfaces use the same settings and validation.

**Call the QQ ASR endpoint directly from each browser component.** This would expose credentials to renderer code, duplicate multipart validation and limits, require cross-origin access, and make provider replacement a UI change. The shared Host Remote centralizes transport and keeps Consumers provider-neutral.

**Bundle the ASR server, MinerU, vLLM, models, and GPU runtime into the EXE.** Those services depend on deployment-specific hardware, drivers, model storage, and update policy. The installer contains their clients and configuration adapters, not the services themselves; service containers and the Windows application remain separate deployment units.

## Consequences

- A standard source build or Windows installer exposes IM, general cron, and Office preview without `dsh plugin add`; the shipped-composition test pins their Host tools and client modules so a packaging omission fails before release.
- Moving the complete working environment still requires copying the intended `DSH_HOME` state and provisioning reachable QQ ASR, MinerU, and model services. Installing only the EXE moves application code, not private data or GPU services.
- Composer and daily-management voice input now behave consistently across browsers that support MediaRecorder, but each request buffers one whole recording in browser and Host memory and sends it to the configured service. The 20 MiB audio limit and operation deadline bound that cost; streaming and partial transcripts are not supported.
- Office preview introduces an AGPL-3.0 runtime dependency. Repository and downstream distributions must retain its notices and comply with its license; this consequence is accepted to make the requested preview part of the default installation.
- The integration consumes published third-party plugin interfaces and pinned artifact versions. Upgrading those artifacts requires another compatibility, license, tool-roster, and shipped-client audit.

## Testing

Capability tests cover provider selection and disposal, live QQ configuration and credential reads, endpoint restrictions, cancellation, multipart fields, supported media, size and response limits, HTTP and JSON failures, and safe diagnostics. Client tests cover MediaRecorder support and teardown, SSR, composer gestures and submit blocking, workbench commands, editable transcripts, and failure notices. A keyless assembled Web scenario records deterministic audio in both the composer and Daily Management, sends it through the real generated Remote to a local QQ-compatible ASR server, and pins the resulting UI snapshots without a model call. The shipped-composition scenario requires the IM and cron Host tools plus the Office, IM, and cron client modules. The Windows workflow builds the same production dependency closure into its NSIS artifact.
