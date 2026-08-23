# 使用 Web UI

[English](index.md) | 中文

请先按照[根目录 README](../../../README.zh.md#run) 中的说明启动 Web UI；命令会打印其访问地址。本指南从服务器已经运行的状态开始。`dsh` 进程会把启动时所在的目录作为默认文件系统位置；全新的 Web UI 则不会选中任何工作区，你需要添加一个工作区。

## 配置模型

打开**设置 → 模型**，输入 [DeepSeek API 密钥](https://platform.deepseek.com/)并保存。模型路由会立即可用，不需要重启服务器。

[模型配置指南](./providers.zh.md)介绍其他提供方和自定义 OpenAI 兼容端点。

## 选择工作区

点击**选择工作区**，添加启动 `dsh` 时所在的项目目录，然后选中它。选中工作区前，会话输入框不可用。

## 运行任务

启动一个会话并发送：

> Summarize this repository and identify its main packages.

Agent（智能体）可以读取和编辑工作区文件、运行命令、委派工作并维护计划。如果根据当前权限策略，某项操作需要审批，Web UI 会先询问你。

## 预览上传文件

使用输入框中的文件按钮上传 PDF、DOCX、XLSX、PPTX 或受支持的图片。选择待发送文件卡片即可在右侧栏打开预览；MinerU 提取过程中也可以预览，不需要外部 Office 预览插件。移除文件或发送消息后，浏览器保留的上传文件不再属于草稿，对应临时预览也会关闭。

<a id="preview-workspace-files"></a>

## 预览工作区文件

标准 Web profile 内置 better-sidebar 工作台。打开页面右侧边缘的入口，选择 **Files**，然后打开工作区文件。Markdown、图片和 PDF 无需额外安装即可内联预览。

从工作区预览新版 Word、Excel 与 PowerPoint 文件需要安装外部 Office 预览插件：

```sh
dsh plugin --profile web add @huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0
```

Office 预览插件使用 AGPL-3.0，因此安装在用户的 Web profile 中，不随 MIT 许可证的 Harness 运行时一起分发。安装后请重启 `dsh web` 并硬刷新浏览器。该插件支持 `.docx`、`.xlsx` 与 `.pptx`；旧版 `.doc`、`.xls` 与 `.ppt` 文件仍只能下载。

## 继续使用

- [配置模型](./providers.zh.md)
- [使用 Python SDK](./python-sdk.zh.md)
- [使用其他 CLI 模式](../../../apps/cli/README.zh.md)
- [开发插件](../develop/basic/index.zh.md)
