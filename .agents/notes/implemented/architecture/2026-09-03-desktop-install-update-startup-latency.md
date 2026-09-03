# Agent Note: Desktop install, update, and startup latency ownership

Status: implemented

English | [中文](2026-09-03-desktop-install-update-startup-latency.zh.md)

## Problem

The Windows desktop payload contains resource trees with thousands of small files, and NSIS installation cost includes per-file creation and antivirus inspection in addition to byte decompression. The desktop launch path also serialized the startup-card load before backend creation and loaded the update provider before the main window. Update installation waited for the ordinary eight-second backend shutdown bound before Electron could exit, so a stalled plugin disposer delayed the visible transition into the installer.

## Decision

The desktop `afterPack` hook stores the complete 12,939-file PPT Master distribution as the sorted `resources/ppt-master.tgz` archive and removes its loose packaged copy. NSIS treats `.tgz` as pre-compressed. The payload verifier reads the archive and checks its exact logical file count, byte count, attribution files, scripts, references, layouts, binary samples, and forbidden artifacts.

The desktop launcher passes the archive path to `@deepseek-ai/dsh-skill-ppt-master`. Archive-backed discovery performs no extraction. The first skill load hashes the archive, shares concurrent work, extracts into a temporary sibling under `$DSH_HOME/cache/bundled-skills/ppt-master`, validates required attribution files, and atomically publishes a content-addressed directory. Later loads reuse that directory. Loose Node distributions retain direct `assets/ppt-master/` access.

Electron begins backend creation while the script-free startup card loads. It imports `electron-updater` and checks for releases only after the application window is visible; the backend retains its existing post-profile-readiness scheduling for Windows-MCP. Startup failure and shutdown still own hidden-window cleanup, and a backend rejection is observed even when shutdown supersedes startup.

An explicit update installation hides the windows immediately and gives the backend one second to dispose its plugin tree. Electron terminates a backend that exceeds that update-specific bound and then invokes the verified installer. Ordinary application exits retain the eight-second graceful-shutdown bound.

## Alternatives considered

**Archive the complete Electron application with ASAR.** The Host supplies real paths to plugin packages, subprocess entries, workers, native addons, scripts, and external tools. A broad ASAR conversion would require a complete executable-path audit and selective unpack policy; the resource-specific archive removes the known small-file hotspot without changing those paths.

**Use store-only NSIS compression.** Storing the whole application would reduce decompression CPU but enlarge the initial download and would not remove per-file filesystem and antivirus work. A pre-compressed resource archive preserves differential update metadata and targets the file-count cost directly.

**Terminate the backend immediately for every exit.** Ordinary exits can afford a longer interval for session persistence and plugin cleanup. Only the user-confirmed update path uses the short bound because the downloaded installer is already committed and replaces the running application.

**Extract the skill during installation or startup.** Either point moves the same high-file-count work onto a latency-critical path even when the user never invokes presentation authoring. First-use materialization keeps discovery and application readiness independent of that optional resource tree.

## Consequences

Installation and replacement write one PPT Master archive instead of 12,939 loose files. The archive remains part of the signed and SHA-512-verified update payload, and the payload gate still proves the complete attributed distribution. A local archive check produced 53,351,037 compressed bytes from 79,496,215 logical bytes; the runtime materialization test reconstructed all 12,939 files.

The first archived `ppt-master` load pays extraction and antivirus cost in the DSH cache. A local materialization check completed in about 1.65 seconds and process-local reuse was immediate; Windows timing remains owned by the packaged smoke and release observation. Content changes create a new digest directory, and application uninstall does not remove older cache entries.

The update path may terminate a plugin tree that cannot reach quiescence within one second. Durable stores must preserve their own write guarantees, and the ordinary close path remains available when the user wants the longer cleanup interval.

Focused tests cover deterministic archive staging, lazy and atomic skill materialization, startup overlap, bounded backend termination, updater ordering, runtime environment paths, and payload rejection. The Windows desktop workflow remains the owner of real NSIS installation, installed-update, and packaged-startup timing.
