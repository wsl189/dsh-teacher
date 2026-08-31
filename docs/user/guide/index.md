# Use the Web UI

English | [中文](index.zh.md)

Start the Web UI through the [root README](../../../README.md#run); the command prints its URL. This guide begins after that server is running. The `dsh` process uses its invoking directory as the default filesystem location, but a fresh Web UI has no selected workspace until you add one.

## Configure a model

Open **Settings → Models**, enter a [DeepSeek API key](https://platform.deepseek.com/), and save it. The model route becomes usable immediately without restarting the server.

The [model configuration guide](./providers.md) covers other providers and custom OpenAI-compatible endpoints.

## Choose a workspace

Click **Choose workspace**, add the project directory where you started `dsh`, and select it. The session composer remains unavailable until a workspace is selected.

## Run a task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The Web UI asks before operations that require approval under the active permission policy.

## Preview uploaded files

Use the file button in the composer to upload PDF, DOCX, XLSX, PPTX, or a supported image. Select the pending file card to open it in the right sidebar; preview is available while MinerU extraction is running and does not require the external Office viewer. Removing the file or sending the message closes its temporary preview because the browser-held upload is no longer part of the draft.

## Preview workspace files

The standard Web profile includes the better-sidebar workbench. Open its handle at the right edge and choose **Files** to browse and edit workspace files. The workbench also provides source control, terminals, and a loopback browser; right-click a tab and choose **Move to Free Window** when it needs its own movable surface.

Markdown previews render local images, sanitized inline HTML, and a table of contents. Images and PDF render inline, and the bundled Office viewer previews `.docx`, `.xlsx`, and `.pptx`; legacy `.doc`, `.xls`, and `.ppt` files remain download-only. The Office viewer is AGPL-3.0, so downstream distributions must preserve its license obligations.

## Continue

- [Configure models](./providers.md)
- [Use the Python SDK](./python-sdk.md)
- [Use other CLI modes](../../../apps/cli/README.md)
- [Develop a plugin](../develop/basic/index.md)
