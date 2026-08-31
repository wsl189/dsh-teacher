---
description: "MCP 包组：挂载外部 Model Context Protocol 服务器，让它们的工具可以作为原生工具调用。"
kind: "package-group"
---

# MCP — 模型上下文协议

[English](README.md) | 中文

## 概述

`mcp/` 组把 harness 连接到 Model Context Protocol（MCP）工具服务器生态。通用客户端挂载由操作者配置的服务器——文件系统、GitHub、数据库或记忆服务器——并提供稳定的服务器限定工具名。Windows 组合包则挂载桌面安装包随附 Windows-MCP 运行时中经过审阅的桌面控制子集。两者都需要显式启用，而且只桥接 Tools 能力：MCP resources 与 prompts 不受支持。本页映射该组；各包 README 负责自身约定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

本组包含两个包；各包 README 与下方链接拥有细节。

| 包 | 提供的能力 |
|---|---|
| [`mcp-client/`](mcp-client/README.zh.md) | 挂载一台外部 MCP 服务器，让模型可以把它的工具当作原生工具调用 |
| [`windows-mcp/`](windows-mcp/README.zh.md) | 通过桌面 EXE 自带的固定运行时提供默认关闭的 Windows 桌面控制 |

-----

<a id="related-documentation"></a>
## 相关文档

先用可运行的示例配置体验插件，再阅读 Agent Note 了解其背后的行为决策。

- [MCP 客户端插件 Agent Note](../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.zh.md)——桥接的设计：服务器限定命名、发现、执行与环境清洗。
- [MCP 客户端自动重连 Agent Note](../../.agents/notes/implemented/feature/2026-08-06-mcp-client-auto-reconnect.zh.md)——重连策略、单次中断的尝试预算与退出开关。
- [内置 Windows-MCP Agent Note](../../.agents/notes/implemented/feature/2026-08-31-bundled-windows-mcp.zh.md)——运行时发行、固定工具集、启用与批准策略。
- [第三方记忆 MCP 示例 Agent Note](../../.agents/notes/implemented/feature/2026-07-31-third-party-memory-mcp-examples.zh.md)——作为参考配置交付的三个默认关闭的记忆服务器 overlay。
- [第三方记忆 MCP 指南](../../docs/user/guide/mcp-memory.zh.md)——可运行的 overlay 配置行与设置说明。
- [工具子系统参考](../../docs/subsystems/tools.zh.md)——接收已注册工具的 `ToolRuntime`。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
