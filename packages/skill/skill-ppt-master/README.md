---
description: "The built-in PPT Master provider for users and maintainers creating editable presentations with the shipped Web and desktop product."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-ppt-master

English | [中文](README.zh.md)

## Summary

The shipped Web and Windows desktop product exposes PPT Master 6.1.0 as the built-in `ppt-master` skill. The provider registers the skill without copying files into `DSH_HOME` and gives the loader the absolute packaged resource directory, so PPT Master's scripts, references, layouts, images, sounds, license, and sponsor records remain available from the same path in a source checkout and an installed EXE. The upstream distribution is preserved under `assets/ppt-master/` and remains subject to its MIT license and attribution guard.

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

### Enable it in another composition

Add the provider after `@deepseek-ai/dsh-skill`:

```yaml
- name: '@deepseek-ai/dsh-skill-ppt-master'
```

The provider has no configuration. Omit the row when a smaller deployment does not need presentation authoring.

### Runtime requirements

Discovery and loading need only the JavaScript application. Executing PPT Master's Python scripts requires a compatible `python3` command and the dependencies needed by the selected workflow; the complete upstream dependency list is in `assets/ppt-master/requirements.txt`. Some workflows also call external services or executables described by the upstream skill. This package does not install or modify a machine-level Python environment.

### Observable success and failures

A successful composition lists one `bundled` skill named `ppt-master`, loads a body beginning with `# PPT Master Skill`, and resolves relative resources from the packaged `assets/ppt-master/` directory. A missing or damaged upstream attribution bundle causes PPT Master's own integrity guard to stop its scripts. The desktop payload gate rejects an installer missing the provider entry, attribution files, scripts, references, layouts, or representative binary resources.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This package registers one immutable candidate at `BUNDLED_SKILL_RANK`. Its candidate metadata mirrors the pinned upstream frontmatter, while the loaded body excludes that frontmatter. `resourceBase` and `path` are derived from `import.meta.url`, so neither the current working directory nor a mutable user skill folder participates in resolution.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Immutable provider, catalog metadata, packaged path resolution, and body loading |
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
- **Installer size** — the complete resource tree contains 12,939 files and 79,496,215 logical bytes before installer compression.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
