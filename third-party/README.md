# Third-party source artifacts

English | [中文](README.zh.md)

This directory pins reviewed third-party plugin artifacts used by the dsh-teacher distribution. They are project build inputs, not per-machine installation files: `@deepseek-ai/dsh-web-app` declares them as dependencies and mounts them in its shipped profile, so source launches and the Windows EXE need no separate `dsh plugin add` step.

## Inventory

| Directory | Artifact | Version | Upstream | Distribution role |
|---|---|---:|---|---|
| `dsh-im/` | `xmanrui-dsh-im-1.0.3.tgz` | 1.0.3 | [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | Nine IM platforms, QQ file delivery, mobile reminders, and QQ ASR settings. |
| `dsh-plugin-cron/` | `dsh-plugin-cron-0.1.3.tgz` | 0.1.3 | [abiaoa1314/dsh-plugin-cron](https://github.com/abiaoa1314/dsh-plugin-cron) | Durable cron jobs, model tools, and browser management. |

The Web bundle also pins `@huanlin/dsh-plugin-better-sidebar-plugin-office` 0.1.2 from npm. That AGPL-3.0 package registers DOCX, XLSX, and PPTX viewers with the built-in better-sidebar file registry.

## Configuration and migration

Executable code ships with the repository and EXE; machine-specific state does not. Bot credentials, QQ settings, cron jobs, and related data remain under `DSH_HOME` (`~/.dsh` or `%USERPROFILE%\.dsh`). Configure bots through **Settings → Plugins → Connected Platforms**. The `dsh-im/cordis.patch.yml.example` file remains only as a reference for deployments that need an explicit `qq.outboundMediaRoots` override.

To migrate a machine, install the new EXE or clone and build the repository, then copy the required `DSH_HOME` data separately. Do not reinstall these three plugins into the generated user profile; duplicate rows can register duplicate tools and sidebar entries.

## Verification

The real shipped-composition browser lane asserts that all three client modules are in the module graph. It also pins the Host-level `cron_*` and `qq_send_local_file` tools, while the voice-input lane sends browser recordings through the shared QQ configuration.

## Artifact notes

The dsh-im archive contains its source and MIT license. The cron archive contains compiled `lib/` output, its bundle patch, README, and MIT license. Update either pinned archive only after reviewing its executable closure, provenance, licenses, and shipped-composition behavior together.
