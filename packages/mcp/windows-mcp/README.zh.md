---
description: "由 DSH 桌面安装包随附的 Windows-MCP stdio 服务器提供、默认关闭的内置 Windows 桌面自动化能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-windows-mcp

[English](README.md) | 中文

## 概述

`dsh-windows-mcp` 把经过审阅的 Windows-MCP 桌面控制子集作为 DSH 原生工具提供。Windows 桌面安装包自带固定版本的 CPython 与 Python 依赖运行时，因此用户无需安装 Python、`uv`、Windows-MCP，也不必另建 MCP 配置项。插件默认关闭；需要桌面自动化时，在**设置 → 插件 → Windows 桌面控制**中启用。每次调用仍需用户批准，因为子进程能够观察和控制 DSH 沙箱之外的应用程序。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

安装 Windows 桌面 EXE，打开**设置 → 插件**，再开启**Windows 桌面控制**。桌面启动器会提供安装包内的运行时路径；如果受信任载荷缺失，设置卡片会保持不可用。开启后会启动一个私有 stdio MCP 子进程；关闭后会停止它并移除工具，无需重启 DSH。

### 已审阅工具集

模型只会在 `mcp__windows__` 命名空间下获得这十三项工具：`App`、`Click`、`DisplayInventory`、`Move`、`MultiEdit`、`MultiSelect`、`Screenshot`、`Scroll`、`Shortcut`、`Snapshot`、`Type`、`Wait` 与 `WaitFor`。PowerShell、Registry、Process、Clipboard、FileSystem、Notification 与 Scrape 不会被发现或注册。保留命名空间中出现的未知名称会被拒绝。

### 配置

发行 Web profile 已包含该插件配置项。下列字段主要供组合作者和源码开发使用；安装版桌面用户通常只需在设置中修改 `enabled`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `false` | 启动内置服务器并发布经过审阅的工具 |
| `runtimeCommand` | 空 | 由受信任桌面启动器提供的 Python 绝对路径；为空表示当前部署不能挂载运行时 |
| `runtimeCwd` | 空 | 内置 Python 运行时的工作目录 |
| `toolCallTimeoutMs` | `60,000` | 每次 MCP 桌面调用的截止时间 |

```yaml
- id: windows-mcp
  name: '@deepseek-ai/dsh-windows-mcp'
  config:
    enabled: false
    runtimeCommand: !!js process.env.DSH_WINDOWS_MCP_COMMAND ?? ''
    runtimeCwd: !!js process.env.DSH_WINDOWS_MCP_RUNTIME_ROOT ?? ''
    toolCallTimeoutMs: 60000
```

每次已审阅调用都会先经过常规 DSH 工具策略链。下游拒绝仍是最终结果；否则本插件会请求用户批准桌面操作。拒绝批准后，调用不会到达 Windows-MCP。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本插件是 `dsh-mcp-client` 上的组合层，不是另一套 MCP 实现。设置变化时，它会创建或移除真实 Loader 子项，把 allowlist 同时传给 Windows-MCP 的 `--tools` 参数和 DSH 桥接层的精确 `includeTools` 过滤器，并且只在子项活动期间注册批准策略。运行时缺失或子进程启动失败时，所有桌面工具都会保持缺失并记录错误，但不会阻止 DSH 启动，因此持久化的已启用值仍能在设置页中关闭。

桌面构建会下载经过哈希固定的官方嵌入式 CPython 压缩包，安装经过哈希固定且仅含二进制 wheel 的依赖闭包，应用已记录的 `use-thefuzz.patch`，并在打包前完成真实 MCP initialize/list/call 冒烟。安装版启动会忽略环境中的运行时覆盖，只接受 `resources/windows-mcp/python.exe`；源码启动可以显式提供开发路径。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 设置协调、子项配置、allowlist 与批准策略 |
| [`src/invariant.ts`](src/invariant.ts) | 运行时 invariant companion |
| [`../../../scripts/build-windows-mcp-runtime.ps1`](../../../scripts/build-windows-mcp-runtime.ps1) | 可复现 Windows 运行时装配与冒烟 |
| [`../../../third-party/windows-mcp/runtime.json`](../../../third-party/windows-mcp/runtime.json) | 上游版本、URL、哈希与本地补丁身份 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP 客户端桥接](../mcp-client/README.zh.md)——本插件继承的发现、命名、执行与重连行为。
- [Windows-MCP 集成 Agent Note](../../../.agents/notes/implemented/feature/2026-08-31-bundled-windows-mcp.zh.md)——发行、启用与安全决策。
- [桌面应用](../../../apps/desktop/README.zh.md)——安装包布局与打包后启动。
- [第三方运行时清单](../../../third-party/README.zh.md)——上游出处与本地修改。

-----

<a id="model-experience"></a>
## 模型体验

### Windows 桌面工具

#### 模型看到什么

启用且连接成功时，模型会看到十三项 `mcp__windows__*` 工具以及 Windows-MCP 提供的描述和 JSON schema。调用可以检查可见 UI 状态、截取屏幕，并且只在用户批准后发送鼠标或键盘输入。关闭该能力会从后续请求中移除全部工具。

#### Token 影响

插件启用期间，十三项工具的名称、描述与 schema 会为每次模型请求增加 token。工具参数以及返回的文本或图片会保留在对话历史中，直至压缩。

#### KV Cache 影响

只要固定运行时发布相同的已审阅 schema，工具定义前缀就保持稳定。启用、关闭或已发布 schema 变化会改变工具前缀，并可能从该位置起使缓存复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义内置集成所支持的宿主、信任与工具范围。

- **仅支持 Windows x64 桌面版**——安装包使用官方 CPython AMD64 嵌入式发行版，非 Windows 构建不会携带该运行时。
- **依赖可见会话**——桌面操作需要未锁定的交互式 Windows 会话；服务、断开的会话与安全桌面不在支持路径内。
- **位于 DSH 沙箱之外**——Windows-MCP 是原生 Python 子进程和 UI Automation 客户端；DSH 批准可以减少误调用，但不构成操作系统级隔离。
- **不开放任意上游工具**——扩展十三项 allowlist 需要同时修改代码、测试、安全审阅、运行时冒烟并重新生成安装包。
- **每个启用的 profile 一个运行时**——本包拥有唯一 `windows` 命名空间，不提供用户自定义 Windows-MCP 服务器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

上游版本、Python 版本、wheel 闭包、补丁摘要与冒烟表面构成同一个审阅升级单元。请一起更新并运行 Windows 桌面工作流；Linux 源码检出无法证明 UI Automation 或打包后的 AMD64 运行时。

</details>
