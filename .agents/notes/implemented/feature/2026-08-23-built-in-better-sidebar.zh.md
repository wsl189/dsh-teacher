# Agent Note: 内置 better-sidebar 工作台

Status: implemented

[English](2026-08-23-built-in-better-sidebar.md) | 中文

## 问题

标准 Web profile 通过聊天与 workspace 插件暴露工作区文件，但没有集成文件工作台。把 better-sidebar 作为独立 profile 组合包安装，会使右侧文件资源管理器、编辑器、终端与预览注册表依赖逐用户配置，导致发行的 Web 组合与新初始化的 profile 提供不同用户界面。

## 决策

`@deepseek-ai/dsh-web-app` 把 `dsh-better-sidebar@^0.17.1` 声明为运行时依赖，并通过 `web-better-sidebar` 配置项挂载。上游插件仍是独立版本的 MIT 包；DSH 使用其已发布包，不把源码复制到本仓库。包补丁把客户端注入列表改接到当前 DSH 的 API、连接、渲染器与设置插件。补丁还提供 Side Chat 用来读取已过滤继承种子的实时或持久化事件的插件自有 `sidechat.events` 路由，因为当前连接客户端不再公开旧版会话历史 API。插件默认保持工作台收起，直到用户主动打开。

`0.17.1` 基线使用经过认证的 Remote 网关和当前富文本标签。工作台包含可移动自由窗口、范围受限的多仓库 Git 发现、终端与本机回环地址浏览器界面、更多编辑器语言支持，以及包含本地图片、经过净化的内联 HTML 和目录的 Markdown 预览。面向模型的 `sidebar_open` 工具默认保持禁用。

内置配置项使用与独立组合包的 `better-sidebar` 配置项不同的 id。由于 `dsh-web-app` 位于 profile 安装的组合包之前，独立组合包的重复挂载防护会观察到内置包配置项，并禁用多余实例。因此，现有 profile 迁移到包含该工作台的 DSH 版本时，可以暂时保留独立组合包。

[内置扩展与 QQ 语音决策](2026-08-25-bundled-extensions-and-qq-speech.zh.md)明确取代了本记录中 Office 仅外置的选择。Web 依赖闭包现在包含 AGPL-3.0 Office 预览插件，并在 better-sidebar 之后挂载，无需逐 profile 安装即可注册 `.docx`、`.xlsx` 与 `.pptx` 工作区预览器。浏览器保留的输入框上传文件仍使用[上传文件预览决策](2026-08-23-uploaded-document-sidebar-preview.zh.md)中的独立临时标签页，不依赖该工作区预览器。

## 验证

组装后的已构建客户端快照要求存在工作台宿主标记与 better-sidebar 自有样式表。专用的 `better-sidebar.e2e.ts` 场景会在 Chromium 中启动发行的 Web 组合，选择预置会话，证明工作台只挂载一次并默认收起，打开其 Files 界面，再把 Files 标签页移入自由窗口并停靠回侧边栏。快照会记录自由窗口命令，以及同时包含已提交用户消息和返回助手消息的 Side Chat 对话记录。Side Chat 场景使用插件自有事件路由，而不是已移除的连接 API。Cordis 配置校验会检查 Web 组合包能够解析插件裸名称，发行组合测试要求存在 Office 客户端模块，生成的第三方声明则同时记录 MIT 工作台与 AGPL Office 运行时依赖。

## 考虑过的替代方案

**让 better-sidebar 完全由 profile 安装。** 这种方案保留较小的默认组合，但标准 Web 界面仍依赖未记录的逐用户配置，也不能提供所要求的内置工作台。

**把上游源码复制为 workspace 包。** 本地 fork 会使上游修复与依赖变更成为本仓库的维护责任，却不改变扩展接口或运行时行为。使用已发布的 MIT 包可以明确保留所有权和发布节奏。

**从上游 main 分支构建。** 可变分支包含尚未经过上游包发布关口的修改，也无法通过 npm 锁文件复现。最新稳定包提供可审查的版本、完整性哈希与发布说明，同时保留相同的集成方式。

**继续把 Office 预览插件作为外部 profile 依赖。** 这样可以避免分发 AGPL-3.0 运行时依赖，却会让标准安装不完整，并使电脑迁移依赖未记录的 profile 状态。后续内置扩展决策明确接受许可证影响，并固定依赖版本与声明生成。

## 后果

每个标准 Web 安装都会包含 better-sidebar 的宿主与客户端产物及其运行时依赖闭包，其中包括 `node-pty`、DOMPurify 与编辑器语言包；仓库安装流程已经允许所需的原生构建脚本。工作台默认存在但保持收起，部署可以通过后续 patch 禁用或替换 `web-better-sidebar` 配置项。工作区 Office 预览无需用户安装即可使用，下游分发者必须保留 Office 预览插件的 AGPL-3.0 义务。
