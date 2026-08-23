# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

<a id="run"></a>

## 运行

> **本 fork 包含 npm 官方发布的 `@deepseek-ai/dsh` 所没有的定制功能**——内置 better-sidebar 工作台、教师工作台（试题切割、学生目录）、输入框上传文件的右侧预览，以及 overlay 挂载时隐藏右上角收起按钮的规则。`npx @deepseek-ai/dsh web` 安装的是官方 npm 包，**不会有这些功能**。请始终从本仓库运行。

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

### 2. 安装 IM 连接与 cron 插件

这两个第三方插件放在 [`third-party/`](third-party/README.zh.md) 目录，因为官方 npm 包不包含它们：

```sh
dsh plugin --profile web add third-party/dsh-im/xmanrui-dsh-im-1.0.3.tgz
dsh plugin --profile web add third-party/dsh-plugin-cron/dsh-plugin-cron-0.1.3.tgz
```

然后把 `third-party/dsh-im/cordis.patch.yml.example` 的内容合并进 `~/.dsh/profiles/web/cordis.patch.yml`，并按本机情况调整 `qq.outboundMediaRoots` 路径。完整安装与验证步骤见 [third-party/README.zh.md](third-party/README.zh.md)。

### 3. 配置 MinerU（文档提取）

Web 组合包默认使用本机 MinerU 端点 `http://127.0.0.1:8005/file_parse`（见 `packages/bundle/web-app/cordis.patch.yml`）。请在本机运行 MinerU 服务（例如官方 `mineru` pipeline 提供 `/file_parse`），或在 **插件 → 插件配置 → 文档提取** 页面覆盖端点。常用设置项：`endpoint`、`backend`（`pipeline` | `vlm-engine` | `hybrid-engine`）、`effort`、`language`（中文用 `ch`）、`maxFileBytes`（默认 20 MiB）、`layoutBatchPages`（4）。若 MinerU 服务不可达，文档提取与试题切割会返回 provider 错误。

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

`baseUrl` 必须是 HTTPS 或本机回环 HTTP，且指向 OpenAI 兼容的转写服务（当前机器在 `127.0.0.1:8000` 运行了一个）。若服务需要 API key，请设置环境变量 `DSH_QQ_ASR_API_KEY`。修改配置后重启 `dsh web`；之后 QQ 语音消息会被转写并进入对话。

### 5. 安装 Office 预览插件（可选）

工作区中的 `.docx`、`.xlsx`、`.pptx` 文件通过外部 AGPL-3.0 查看器预览；输入框上传的文件无需该插件即可在右侧栏预览：

```sh
dsh plugin --profile web add @huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0
```

安装后重启 `dsh web` 并强制刷新浏览器。旧版 `.doc`、`.xls`、`.ppt` 仍只能下载。

### 6. 验证

- 右侧出现 better-sidebar 手柄（内置工作台）。
- 侧边栏出现教师工作台入口，可打开日常管理、课表、试题切割。
- 点击输入框上传的文件卡片，会在右侧栏打开预览标签页（PDF、DOCX、XLSX、PPTX、图片）。
- QQ 机器人可收发消息；`qq_send_local_file` 可发送图片/文件；开启 ASR 后语音消息可转写。
- 侧边栏出现定时任务入口，可查看与管理定时任务。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
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
