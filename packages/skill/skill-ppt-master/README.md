---
description: "The built-in PPT Master provider for users and maintainers creating editable presentations with the shipped Web and desktop product."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-ppt-master

English | [中文](README.zh.md)

## Summary

The shipped Web and Windows desktop product exposes PPT Master 6.1.0 as the built-in `ppt-master` skill. Source and ordinary Node distributions read the complete `assets/ppt-master/` tree directly. The desktop installer carries the same tree as one archive and materializes a content-addressed directory under the DSH cache only when a caller loads the skill, so application installation and startup do not create or scan 12,939 separate resource files. The materialized scripts, references, layouts, images, sounds, license, and sponsor records remain subject to the upstream MIT license and attribution guard.

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

The default Web composition mounts this package with no configuration. `ppt-master` therefore appears in the session skill catalog and can be loaded by the model or invoked by the user. The desktop installer includes that Web composition and the complete packaged resource directory.

### Configuration

Add the provider after `@deepseek-ai/dsh-skill`; no configuration is required for the normal package layout:

```yaml
- name: '@deepseek-ai/dsh-skill-ppt-master'
```

Omit the row when a smaller deployment does not need presentation authoring. The desktop launcher owns the archive fields; ordinary compositions leave them empty.

| Field | Default | Meaning |
|---|---|---|
| `archivePath` | `''` | Absolute trusted `.tgz` path; an empty value reads `assets/ppt-master/` directly |
| `cacheRoot` | `$DSH_HOME/cache/bundled-skills/ppt-master` | Absolute parent for content-addressed archive materializations |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-skill-ppt-master) is the exhaustive source for accepted fields.

### Runtime requirements

Discovery and loading need only the JavaScript application. Executing PPT Master's Python scripts requires a compatible `python3` command and the dependencies needed by the selected workflow; the complete upstream dependency list is in `assets/ppt-master/requirements.txt`. Some workflows also call external services or executables described by the upstream skill. This package does not install or modify a machine-level Python environment.

### Observable success and failures

A successful composition lists one `bundled` skill named `ppt-master`, loads a body beginning with `# PPT Master Skill`, and returns an absolute directory for relative resources. Archive mode validates absolute paths and archive presence during plugin load, hashes the archive on first skill load, then publishes the extracted directory only after all required attribution files exist. A missing or damaged upstream attribution bundle causes PPT Master's own integrity guard to stop its scripts. The desktop payload gate reads the archive and rejects an installer with the wrong file count, logical bytes, provider entry, attribution files, scripts, references, layouts, or representative binary resources.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This package registers one immutable candidate at `BUNDLED_SKILL_RANK`. Its candidate metadata mirrors the pinned upstream frontmatter, while the loaded body excludes that frontmatter. Loose mode derives `resourceBase` and `path` from `import.meta.url`. Archive mode keeps discovery free of extraction work, shares concurrent materialization, extracts into a temporary sibling, and renames the completed content-addressed directory atomically; later loads reuse that directory.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Immutable provider, catalog metadata, packaged path resolution, and body loading |
| [`src/materialized.ts`](src/materialized.ts) | Archive validation, hashing, atomic materialization, and process-local request sharing |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion |
| [`assets/ppt-master/`](assets/ppt-master/) | Unmodified upstream PPT Master 6.1.0 skill distribution |
| [`tests/skill-ppt-master.spec.ts`](tests/skill-ppt-master.spec.ts) | Registration, attribution, and complete-distribution inventory checks |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [PPT Master official repository](https://github.com/hugohe3/ppt-master) — upstream source, usage documentation, and releases.
- [Bundled MIT license](assets/ppt-master/LICENSE) — terms retained with the distributed skill.
- [Skill subsystem reference](../../../docs/subsystems/skills.md) — provider ranking, catalog assembly, and loading.
- [tool-skill package](../tool-skill/README.md) — how the catalog and selected body reach the model.
- [Windows desktop package](../../../apps/desktop/README.md) — installer scope and payload verification.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`, which publishes the `ppt-master` summary in the session catalog, renders the selected skill body, and reads referenced resources only when the loaded workflow requests them.

#### KV Cache effect

The catalog summary changes the session-prefix skill list. Loading `ppt-master` adds its routed entry instructions at the tool result insertion point; later referenced files affect only the turns that read them.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Python remains external** — the installer carries the Skill resources, not a dedicated Python environment or its optional packages.
- **Pinned upstream release** — the package contains PPT Master 6.1.0; updating it requires importing and verifying a complete newer upstream distribution.
- **First archived load writes the resource tree** — the desktop's first `ppt-master` load extracts 12,939 files and 79,496,215 logical bytes into the DSH cache; later loads reuse the content-addressed directory, and uninstalling the application does not remove it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
