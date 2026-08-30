# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

> **本 fork 包含 npm 官方发布的 `@deepseek-ai/dsh` 所没有的定制功能**——内置 better-sidebar 工作台、IM 连接、cron 管理、Office 预览、教师工作台（试题切割、学生目录）、共用 QQ 设置的语音输入、输入框上传文件的右侧预览，以及 overlay 挂载时隐藏右上角收起按钮的规则。`npx @deepseek-ai/dsh web` 安装的是官方 npm 包，**不会有这些功能**。请始终从本仓库运行。

### Windows 安装包

从本 fork 的 [GitHub Releases](https://github.com/wsl189/dsh-teacher/releases) 下载 `DSH-Teacher-<版本>-x64-Setup.exe`。安装版包含 Electron、Node.js、已构建的 Web UI 与本仓库的 DSH 插件依赖闭包。它会在启动时检查 Releases；发现更高的 SemVer 后，**设置**右侧会出现**更新**，点击后下载并校验安装器，准备完成后变成**重启更新**。

每次推送分支都会通过[桌面构建 workflow](.github/workflows/windows-desktop.yml)生成 Windows 安装器 artifact。推送 `v<package 版本>` tag 后，workflow 才会把安装器与 `latest.yml` 发布为客户端更新 feed。构建、发布、签名与迁移的准确步骤见[桌面发行版指南](apps/desktop/README.zh.md)。

EXE 不会打包 vLLM、MinerU、ASR 服务、模型权重或 GPU 驱动。这些服务需要单独运行——Docker 仍很适合承载这部分环境——再在 DSH 中配置其回环端点。用户数据也不会进入安装包，而是保存在 `%USERPROFILE%\.dsh`；迁移电脑时需要另行复制该目录。

### 从源码运行（推荐）

<a id="run-from-source"></a>

安装 `Node.js`（≥ 22）与 `pnpm`，然后：

```sh
git clone https://github.com/wsl189/dsh-teacher.git
cd dsh-teacher
pnpm install
pnpm run build
pnpm dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。`pnpm run build` 会准备仓库产物；`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

### 通过 `npm` 运行（仅官方版）

官方发布版不含本 fork 的定制功能：

```sh
npx @deepseek-ai/dsh web
```

详见 [Web UI 指南](docs/user/guide/index.zh.md)。

## 新设备部署清单

在新机器上从本仓库部署时，请按以下步骤逐项完成，否则对应功能会缺失。

### 1. 从本仓库运行

```sh
git clone https://github.com/wsl189/dsh-teacher.git
cd dsh-teacher
pnpm install
pnpm run build
pnpm dsh web
```

**不要**使用 `npx @deepseek-ai/dsh web`——它会安装官方 npm 包，不含本 fork 的定制功能（教师工作台、内置 better-sidebar、上传预览、overlay 收起规则）。

### 2. 内置 IM、cron 与 Office 预览

Web 组合与 Windows EXE 已包含经过审阅的 `@xmanrui/dsh-im` 1.0.3、`dsh-plugin-cron` 0.1.3 和 `@huanlin/dsh-plugin-better-sidebar-plugin-office` 0.1.2，新电脑上不要再为它们运行 `dsh plugin add`。机器人与 QQ 语音在**设置 → 插件 → 连接平台**中配置；cron 与 Office 预览侧边栏入口由发行 profile 直接加载。固定的来源包及其出处记录仍保存在 [`third-party/`](third-party/README.zh.md)。

### 3. 配置 MinerU（文档提取）

Web 组合包默认使用本机 MinerU 端点 `http://127.0.0.1:8005/file_parse`（见 `packages/bundle/web-app/cordis.patch.yml`）。请在本机运行 MinerU 服务（例如官方 `mineru` pipeline 提供 `/file_parse`），或在 **插件 → 插件配置 → 文档提取** 页面覆盖端点。常用设置项：`endpoint`、`backend`（`pipeline` | `vlm-engine` | `hybrid-engine`）、`effort`、`language`（中文用 `ch`）、`maxFileBytes`（默认 50 MiB）、`layoutBatchPages`（4）。若 MinerU 服务不可达，文档提取与试题切割会返回 provider 错误。

### 4. 配置 QQ 语音识别（ASR）

编辑 `~/.dsh/integrations/dsh-qq/config.json`，开启 `speech`（当前机器配置为 `enabled: true`）：

```json
"speech": {
  "enabled": true,
  "baseUrl": "http://127.0.0.1:8000/v1/",
  "model": "whisper-1",
  "language": "zh"
}
```

`baseUrl` 必须是 HTTPS 或本机回环 HTTP，且指向 OpenAI 兼容的转写服务（当前机器在 `127.0.0.1:8000` 运行了一个）。若服务需要 API key，可通过 QQ 设置页保存，或设置 `DSH_QQ_ASR_API_KEY`。QQ 机器人、主输入框和工作台「日常管理」的麦克风控件共用这些设置；保存后下一次完整录音会直接读取新值，无需重启 Host。

### 5. Office 预览格式

内置的 AGPL-3.0 Office 查看器可预览工作区中的 `.docx`、`.xlsx` 与 `.pptx`；输入框上传仍沿用既有的右侧栏预览路径。旧版 `.doc`、`.xls`、`.ppt` 仍只能下载，需要先转换格式。

### Windows 系统差异

以下内容在 Windows 上需要调整，其余步骤（仓库或 EXE 启动、MinerU、语音与内置插件）采用和 Linux 相同的配置方式。

- **`~/.dsh` 目录**：Windows 上位于 `C:\Users\<用户名>\.dsh`。所有配置路径（`cordis.patch.yml`、`integrations/dsh-qq/config.json`、`integrations/dsh-qq/workspaces.json`、`.credentials.yaml`）都在这下面，新设备需把这些文件从旧机器复制过来。
- **`cordis.patch.yml` 的 `qq.outboundMediaRoots`**：必须写 Windows 绝对路径，例如：

  ```yaml
  - id: xmanrui-dsh-im
    config:
      qq:
        outboundMediaRoots:
          - C:/Users/你的用户名/Desktop
  ```

  路径分隔符用 `/` 或 `\\` 均可，必须是绝对路径。若不配置此项，插件会回退到 `C:\Users\<用户名>\Desktop`（Windows 桌面）。
- **`workspaces.json`**：QQ 机器人的工作区路径也要改成 Windows 路径，例如 `C:/Users/你的用户名/dsh-teacher`（克隆仓库的位置）。
- **`DSH_HOME` 环境变量**（可选）：默认无需设置；如需自定义数据目录，Windows 用 `set DSH_HOME=C:\...` 或系统环境变量。
- **`dshHomePath` 自动适配**：教师工作台的存储（`segments`/`students`/`sources`/`generated`）和会话存储用 `dshHomePath()` 生成，自动落到 `C:\Users\<用户名>\.dsh\...`，**无需手动改**。
- **命令提示符**：PowerShell 中运行 `pnpm dsh web` 等命令即可；若提示执行策略限制，先运行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。
- **MinerU 与语音服务**：`baseUrl`/`endpoint` 用 `127.0.0.1` 回环地址即可（Windows 上同样支持）；这些服务若装在 WSL 里，则把地址改成 WSL 的 IP。

### 6. 验证

- 右侧出现 better-sidebar 手柄（内置工作台）。
- 侧边栏出现教师工作台入口，可打开日常管理、课表、试题切割。
- 点击输入框上传的文件卡片，会在右侧栏打开预览标签页（PDF、DOCX、XLSX、PPTX、图片）。
- QQ 机器人可收发消息；`qq_send_local_file` 可发送图片/文件；开启 ASR 后语音消息可转写。
- 侧边栏出现定时任务入口，可查看与管理定时任务。

## 社区与支持

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
