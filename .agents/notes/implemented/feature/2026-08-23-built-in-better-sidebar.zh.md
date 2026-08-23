# Agent Note: 内置 better-sidebar 工作台

Status: implemented

[English](2026-08-23-built-in-better-sidebar.md) | 中文

## 问题

标准 Web profile 通过聊天与 workspace 插件暴露工作区文件，但没有集成文件工作台。把 better-sidebar 作为独立 profile 组合包安装，会使右侧文件资源管理器、编辑器、终端与预览注册表依赖逐用户配置，导致发行的 Web 组合与新初始化的 profile 提供不同用户界面。

## 决策

`@deepseek-ai/dsh-web-app` 把 `dsh-better-sidebar` 声明为运行时依赖，并通过 `web-better-sidebar` 配置项挂载。上游插件仍是独立版本的 MIT 包；DSH 使用其已发布包，不把源码复制到本仓库。插件默认保持工作台收起，直到用户主动打开。

内置配置项使用与独立组合包的 `better-sidebar` 配置项不同的 id。由于 `dsh-web-app` 位于 profile 安装的组合包之前，独立组合包的重复挂载防护会观察到内置包配置项，并禁用多余实例。因此，现有 profile 迁移到包含该工作台的 DSH 版本时，可以暂时保留独立组合包。

工作区 Office 预览插件仍是外部 profile 依赖。它通过 better-sidebar 注册 `.docx`、`.xlsx` 与 `.pptx` 工作区预览器，但其 AGPL-3.0 声明不符合仓库的宽松运行时许可证策略。用户文档给出明确的 profile 安装命令，并说明重启要求、支持的扩展名与旧格式行为。浏览器保留的输入框上传文件使用[上传文件预览决策](2026-08-23-uploaded-document-sidebar-preview.zh.md)中的独立临时标签页，不依赖该 profile 包。

## 验证

组装后的已构建客户端快照要求存在工作台宿主标记与 better-sidebar 自有样式表。专用的 `better-sidebar.e2e.ts` 场景会在 Chromium 中启动发行的 Web 组合，选择预置会话，证明工作台只挂载一次并默认收起，然后打开其 Files 界面。Cordis 配置校验会检查 Web 组合包能够解析插件裸名称，生成的第三方声明则记录该 MIT 运行时依赖。

## 考虑过的替代方案

**让 better-sidebar 完全由 profile 安装。** 这种方案保留较小的默认组合，但标准 Web 界面仍依赖未记录的逐用户配置，也不能提供所要求的内置工作台。

**把上游源码复制为 workspace 包。** 本地 fork 会使上游修复与依赖变更成为本仓库的维护责任，却不改变扩展接口或运行时行为。使用已发布的 MIT 包可以明确保留所有权和发布节奏。

**在 Web 组合包中分发 Office 预览插件。** 这种方案无需第二条命令即可提供 Office 预览，但该插件声明 AGPL-3.0；如果没有明确的分发决策，仓库会拒绝非宽松运行时依赖。采用外部 profile 安装可以保留该功能，而不削弱许可证策略。

## 后果

每个标准 Web 安装都会包含 better-sidebar 的宿主与客户端产物及其运行时依赖闭包，其中包括 `node-pty`；仓库安装流程已经允许所需的原生构建脚本。工作台默认存在但保持收起，部署可以通过后续 patch 禁用或替换 `web-better-sidebar` 配置项。工作区 Office 预览仍需用户明确安装，并且不属于 DSH 分发许可证集合。
