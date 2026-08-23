# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

> **This fork ships custom features that the npm-published `@deepseek-ai/dsh` does not include** — the built-in better-sidebar workbench, teacher workbench (question cutting, student folders), composer upload preview in the right sidebar, and the overlay rules for the top-right collapse button. `npx @deepseek-ai/dsh web` installs the official npm package and will NOT provide these. Always run from this repository.

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

### 2. Install the IM connector and cron plugins

These third-party bundles live in [`third-party/`](third-party/README.md) because they are not part of the npm package:

```sh
dsh plugin --profile web add third-party/dsh-im/xmanrui-dsh-im-1.0.3.tgz
dsh plugin --profile web add third-party/dsh-plugin-cron/dsh-plugin-cron-0.1.3.tgz
```

Then merge `third-party/dsh-im/cordis.patch.yml.example` into `~/.dsh/profiles/web/cordis.patch.yml` and adjust the `qq.outboundMediaRoots` paths for this machine. See [third-party/README.md](third-party/README.md) for the full install and verification steps.

### 3. Configure MinerU (document extraction)

The Web bundle defaults to a local MinerU endpoint at `http://127.0.0.1:8005/file_parse` (see `packages/bundle/web-app/cordis.patch.yml`). Run a MinerU server on this machine (for example the official `mineru` pipeline serving `/file_parse`), or override the endpoint on the **Plugins → Plugin configuration → Document extraction** settings page. Settings of interest: `endpoint`, `backend` (`pipeline` | `vlm-engine` | `hybrid-engine`), `effort`, `language` (`ch` for Chinese), `maxFileBytes` (default 20 MiB), and `layoutBatchPages` (4). If no MinerU server is reachable, document extraction and question cutting fail with a provider error.

### 4. Configure QQ voice recognition (ASR)

Edit `~/.dsh/integrations/dsh-qq/config.json` and enable `speech` (the current machine uses `enabled: true`):

```json
"speech": {
  "enabled": true,
  "baseUrl": "http://127.0.0.1:8000/v1/",
  "model": "whisper-1",
  "language": "zh"
}
```

`baseUrl` must be HTTPS or a loopback HTTP URL, and must point to an OpenAI-compatible transcription server (the current machine runs one at `127.0.0.1:8000`). If the server requires an API key, set the `DSH_QQ_ASR_API_KEY` environment variable. Restart `dsh web` after changing the config; QQ voice messages are then transcribed and fed to the conversation.

### 5. Install the Office preview plugin (optional)

Workspace `.docx`, `.xlsx`, and `.pptx` files preview through the external AGPL-3.0 viewer. Composer uploads preview in the right sidebar without it:

```sh
dsh plugin --profile web add @huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0
```

Restart `dsh web` and hard-refresh the browser afterwards. Legacy `.doc`, `.xls`, and `.ppt` remain download-only.

### 6. Verify

- Right-side better-sidebar handle appears (built-in workbench).
- Teacher workbench sidebar entry opens daily management, timetable, and question cutting.
- Selecting a composer upload card opens its preview tab in the right sidebar (PDF, DOCX, XLSX, PPTX, images).
- QQ bot replies; `qq_send_local_file` sends images/files; voice messages transcribe when ASR is enabled.
- Cron sidebar entry lists and manages scheduled jobs.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
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
