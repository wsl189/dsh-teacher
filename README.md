# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

> **This fork ships custom features that the npm-published `@deepseek-ai/dsh` does not include** — the built-in better-sidebar workbench, IM connector, cron manager, skill/MCP manager, Office preview and Univer authoring, teacher workbench (question cutting, student folders), supplier-model voice input shared with QQ, composer upload preview in the right sidebar, and the overlay rules for the top-right collapse button. `npx @deepseek-ai/dsh web` installs the official npm package and will NOT provide these. Always run from this repository.

### Windows installer

Download `DSH-Teacher-<version>-x64-Setup.exe` from this fork's [GitHub Releases](https://github.com/wsl189/dsh-teacher/releases). The installed app includes Electron, Node.js, the built Web UI, and this repository's DSH plugin closure. It checks Releases at startup; when a higher SemVer exists, an **Update** action appears to the right of **Settings**, downloads the verified installer, and changes to **Restart to update** when ready.

Every branch push builds a Windows installer artifact through [the desktop workflow](.github/workflows/windows-desktop.yml). Pushing a `v<package version>` tag publishes the installer and `latest.yml` as the client update feed. Exact build, release, signing, and migration instructions are in the [desktop distribution guide](apps/desktop/README.md).

The EXE does not bundle vLLM, MinerU, ASR services, model weights, or GPU drivers. Run those separately—Docker remains a good fit for that service environment—and configure their loopback endpoints in DSH. User data also stays outside the installer under `%USERPROFILE%\.dsh`; copy that directory separately when migrating machines.

### Run from source (recommended)

<a id="run-from-source"></a>

Install `Node.js` (≥ 22) and `pnpm`, then:

```sh
git clone https://github.com/wsl189/dsh-teacher.git
cd dsh-teacher
pnpm install
pnpm run build
pnpm dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. `pnpm run build` prepares the repository artifacts; `pnpm dsh web` uses those built artifacts without rebuilding.

### Run from `npm` (official release only)

The official release runs without the custom features of this fork:

```sh
npx @deepseek-ai/dsh web
```

See [Web UI guide](docs/user/guide/index.md).

## New deployment checklist

When setting up a fresh machine from this repository, follow every step below or the corresponding feature will be missing.

### 1. Run from this repository

```sh
git clone https://github.com/wsl189/dsh-teacher.git
cd dsh-teacher
pnpm install
pnpm run build
pnpm dsh web
```

Do NOT use `npx @deepseek-ai/dsh web` — it installs the official npm package without the fork's custom features (teacher workbench, built-in better-sidebar, upload preview, overlay collapse rules).

### 2. Built-in image generation, IM, cron, skill/MCP management, and Office

The Web composition and Windows EXE already contain the reviewed `@dickpy/dsh-imagegen` 1.5.1 runtime repack, `@xmanrui/dsh-im` 1.0.3, `dsh-plugin-cron` 0.1.3, `dsh-skill-mcp-panel` 2.0.1, `dsh-univer-office` 0.2.12 DSH rebuild, and `@huanlin/dsh-plugin-better-sidebar-plugin-office` 0.1.2 packages. Do not run `dsh plugin add` for them on a new machine, and remove a separately installed image-generation row before starting this built-in version. Configure OpenAI-compatible image-provider channels under **Settings → Models → Image generation model**; adding an image model to the ordinary provider list alone does not create image-generation tools. Configure bots under **Settings → Plugins → Connected Platforms**. Configure supplier access under **Settings → Models → Service access**, then assign speech recognition under **Use cases**; the composer, QQ, and Daily Management share that assignment. Manage skills under **Settings → Skills**, and manage profile servers under **Settings → MCP** or through `dsh-panel mcp`; image generation, cron, Office preview, and Univer review surfaces load from the shipped profile. The pinned source artifacts and their provenance remain documented in [`third-party/`](third-party/README.md).

The Univer wrapper is Apache-2.0, but its executable closure includes commercial `@univerjs-pro/*` components. Supply a valid license through `UNIVER_LICENSE` before launch and obtain the required distribution rights before shipping an installer; the built-in row disables product telemetry. Some Slide layout, SVG measurement, and screenshot operations also need local Chrome or Chromium, with `UNIVER_RENDER_BROWSER` available to select its executable.

### 3. Configure MinerU (document extraction)

The Web bundle defaults to a local MinerU endpoint at `http://127.0.0.1:8005/file_parse` (see `packages/bundle/web-app/cordis.patch.yml`). Run a MinerU server on this machine (for example the official `mineru` pipeline serving `/file_parse`), or override the endpoint on the **Plugins → Plugin configuration → Document extraction** settings page. Settings of interest: `endpoint`, `backend` (`pipeline` | `vlm-engine` | `hybrid-engine`), `effort`, `language` (`ch` for Chinese), `maxFileBytes` (default 50 MiB), and `layoutBatchPages` (4). If no MinerU server is reachable, document extraction and question cutting fail with a provider error.

### 4. Configure speech recognition

Open **Settings → Models → Service access** and configure either Zhipu Standard API or Alibaba Model Studio/Qwen Standard API with its API key. Then open **Use cases → Speech recognition** and select `GLM-ASR-2512` or `Qwen3 ASR Flash`. The product fills the maintained official operation URL and request format for that exact provider/model pair; there is no separate Voice model card or QQ-owned ASR endpoint.

The QQ bot, main composer, and Workbench Daily Management microphone controls read the same assignment and supplier credential for every completed recording, so a saved change affects the next request without a Host restart. A QQ voice message can use text supplied directly by QQ and then bypass remote transcription; verify a selected supplier model with either browser microphone control instead of treating bot recognition alone as an endpoint check. Other suppliers or self-hosted ASR services require an explicit operation adapter before they appear as executable speech choices.

### 5. Office preview and authoring formats

The built-in AGPL-3.0 Office viewer previews workspace `.docx`, `.xlsx`, and `.pptx` files, while Univer Office creates and reviews editable `.univer` Sheets, Docs, Slides, Bases, and Boards. Univer imports `.xlsx`, `.csv`, `.tsv`, `.docx`, and `.pptx` and exports the supported Office formats after review. Composer uploads retain the existing right-sidebar preview path. Legacy `.doc`, `.xls`, and `.ppt` remain download-only and require conversion.

### Windows differences

The steps below need adjustment on Windows; everything else (repository or EXE launch, MinerU, voice, and the built-in plugins) follows the same configuration model as Linux.

- **`~/.dsh` directory**: on Windows it is `C:\Users\<user>\.dsh`. All config paths (`cordis.patch.yml`, `integrations/dsh-qq/config.json`, `integrations/dsh-qq/workspaces.json`, `.credentials.yaml`) live under it — copy these files from the old machine when moving.
- **`qq.outboundMediaRoots` in `cordis.patch.yml`**: use Windows absolute paths, for example:

  ```yaml
  - id: xmanrui-dsh-im
    config:
      qq:
        outboundMediaRoots:
          - C:/Users/你的用户名/Desktop
  ```

  Either `/` or `\\` separators work; the path must be absolute. When unset, the plugin falls back to `C:\Users\<user>\Desktop`.
- **`workspaces.json`**: point the QQ bot workspace at the Windows clone path, e.g. `C:/Users/<user>/dsh-teacher`.
- **`DSH_HOME` environment variable** (optional): default needs no override; on Windows use `set DSH_HOME=C:\...` or the system environment panel to customize the data directory.
- **Univer environment**: add a valid `UNIVER_LICENSE` to the Windows user or system environment before starting the installed app. If Chrome is not discovered automatically, set `UNIVER_RENDER_BROWSER` to its absolute executable path.
- **`dshHomePath` adapts automatically**: teacher-workbench storage (`segments`/`students`/`sources`/`generated`) and session storage use `dshHomePath()` and land under `C:\Users\<user>\.dsh\...` with no manual edit.
- **Shell**: run `pnpm dsh web` etc. in PowerShell; if the execution policy blocks scripts, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` first.
- **MinerU and voice services**: loopback `127.0.0.1` endpoints work on Windows too; when the services run inside WSL, point `baseUrl`/`endpoint` at the WSL address instead.

### 6. Verify

- Right-side better-sidebar handle appears (built-in workbench).
- Teacher workbench sidebar entry opens daily management, timetable, and question cutting.
- Selecting a composer upload card opens its preview tab in the right sidebar (PDF, DOCX, XLSX, PPTX, images).
- QQ bot replies; `qq_send_local_file` sends images/files; voice messages transcribe when ASR is enabled.
- Cron sidebar entry lists and manages scheduled jobs.
- **Settings → Skills** lists global and workspace skills, and **Settings → MCP** can list and test configured servers.
- An agent can create a `.univer` file, show its isolated review card, and export an approved Sheet, Doc, or Slide to a supported Office format.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
