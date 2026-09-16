# Agent Note: 保留教师配置的官方版本集成

Status: implemented

[English](2026-09-16-official-release-integration.md) | 中文

## Problem

教师发行版需要上游修复和受维护的插件版本，同时保持工作台流程及供应商模型配置稳定。用上游默认值替换整个应用会移除这些功能，并使生图和语音使用方脱离已保存的分配。

## Decision

集成以官方 `dsh-v0.1.6-alpha.1` 为基础，采用其 harness、Remote API、会话升级、原生系统支持和官方侧边栏。教师工作台包与模型设置保留原有用户操作、字段、默认值、存储位置和供应商分配；这些包中的修改仅适配上游 API。教师版 Electron 启动器和更新器保留现有应用标识及数据位置。

Web profile 加载官方文件、文档和终端侧边栏插件。保留的 Office 预览插件通过官方文档预览服务注册。发行版不包含 `dsh-better-sidebar` 包、草稿标签页适配器、Windows-MCP 包或私有 Python 运行时。

Windows 加载官方原生 Cua Driver 电脑操控提供方。发行检查仅允许 Web bundle 引入这一确定的实验性依赖；其他实验性运行时依赖仍被拒绝。其生命周期、工具目录、取消、截图准入与操作系统权限要求仍由上游负责。

[第三方清单](../../../../third-party/plugin-release-manifest.json)固定经审阅的插件版本。兼容补丁保留统一媒体模型分配、已保存的 IM 工作目录、QQ 语音委托和原生 Office 预览。可执行代码更新不改写用户设置或工作台数据。Univer 仅接收运行时许可证配置。

[内置扩展决策](../feature/2026-08-25-bundled-extensions-and-qq-speech.zh.md)、[机器人工作目录决策](../feature/2026-09-01-im-bot-desktop-workspaces.zh.md)和[供应商模型决策](2026-09-01-supplier-grouped-model-settings.zh.md)继续约束各自的数据与配置归属。此前 better-sidebar 和 Windows-MCP 的实现已移除，相应决策归档。

## Alternatives considered

**用发布归档替换所有包。** 这会丢失要求保留的工作台和模型设置行为，因此保留这些包，并针对实际上游服务验证适配。

**同时保留两套侧边栏或电脑操控实现。** 重复注册以及独立的权限和文件生命周期违背替换要求，因此仅保留官方实现和小型 Office 预览适配器。

**采用各插件独立的模型配置。** 这会拆散已保存的服务接入和使用场景分配，因此发行版继续管理这些设置，上游插件管理其具体操作。

## Consequences

上游修复共用一套实现，插件升级可复现。后续更新必须保留受保护的操作，并共同审查兼容补丁、许可证、工具目录、浏览器渲染和安装依赖。原生桌面行为需要在 Windows 上验证；Linux 单元测试只证明其实际执行的提供方与打包逻辑。
