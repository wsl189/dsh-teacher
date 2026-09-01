---
description: "由 DSH 桌面安装包随附的 Windows-MCP 运行时提供、默认开启的内置 Windows 桌面自动化能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-windows-mcp

[English](README.md) | 中文

## 概述

`dsh-windows-mcp` 以 DSH 原生工具提供 Windows 桌面与系统自动化。Windows 桌面安装包自带固定版本的 CPython 与 Python 依赖运行时，因此用户无需安装 Python、`uv`、Windows-MCP，也不必另建 MCP 配置项。运行时可用时，插件默认启动，但用户已保存的关闭设置会继续生效。标准 `dsh` 启动器会在应用就绪后启动 Python 子进程，因此运行时 import 与发现不会延迟主页面。Full access 会开放全部二十项工具，且本插件不再额外请求批准；其他模式提供十三项桌面工具并逐次请求批准。这些操作发生在 DSH 沙箱之外。

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

安装并启动 Windows 桌面 EXE，Windows 桌面控制即可自动启动。已持久化的选择仍优先于启动默认值，但通用**插件配置**标签页不展示该内置集成。桌面启动器会提供安装包内的运行时路径；没有该受信任载荷的部署保持关闭。设置区会随主 profile 激活，初始私有 stdio 子进程则在启动器就绪后启动，并在发现完成时发布工具。没有 `appReady` 启动器服务的手工组合会在插件激活期间启动子进程。之后再启用会立即启动子进程；关闭则会停止它并移除工具，无需重启 DSH。

<a id="tools-and-permission-modes"></a>
### 工具与权限模式

桌面工具集在 `mcp__windows__` 命名空间下包含十三项工具：`App`、`Click`、`DisplayInventory`、`Move`、`MultiEdit`、`MultiSelect`、`Screenshot`、`Scroll`、`Shortcut`、`Snapshot`、`Type`、`Wait` 与 `WaitFor`。处于 Full access（`danger-full-access`）的会话还会获得 `PowerShell`、`Registry`、`Process`、`Clipboard`、`FileSystem`、`Notification` 与 `Scrape`，覆盖固定运行时的全部二十项工具。切回 `read-only` 或 `workspace-write` 后，这七项系统工具会被隐藏并拒绝执行，桌面调用恢复逐次批准。切换只影响该会话，不影响其他会话，也无需重启运行时。所有模式都会拒绝未知名称。

### 配置

发行 Web profile 已包含该插件配置项，并在未提供运行时命令时将 `enabled` 覆盖为 false。下列字段主要供组合作者和源码开发使用；安装版桌面用户通常只需在设置中修改 `enabled`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 提供运行时命令时，启动内置服务器并发布经过审阅的工具 |
| `runtimeCommand` | 空 | 由受信任桌面启动器提供的 Python 绝对路径；为空表示当前部署不能挂载运行时 |
| `runtimeCwd` | 空 | 内置 Python 运行时的工作目录 |
| `toolCallTimeoutMs` | `180,000` | 每次 MCP 调用（含嵌套 sampling）的截止时间，覆盖 `WaitFor` 的 120 秒等待 |
| `samplingMaxInputBytes` | `1,048,576` | Scrape sampling 参数的 UTF-8 字节数上限 |
| `samplingMaxOutputTokens` | `2,048` | 单次 Scrape 模型补全的输出 token 上限 |

```yaml
- id: windows-mcp
  name: '@deepseek-ai/dsh-windows-mcp'
  config:
    enabled: !!js (process.env.DSH_WINDOWS_MCP_COMMAND ?? '').trim().length > 0
    runtimeCommand: !!js process.env.DSH_WINDOWS_MCP_COMMAND ?? ''
    runtimeCwd: !!js process.env.DSH_WINDOWS_MCP_RUNTIME_ROOT ?? ''
    toolCallTimeoutMs: 180000
```

每次调用都会经过常规 DSH 工具策略链。Full access 只免除本插件的额外批准；下游拒绝和批准请求仍然生效。批准策略 `never` 仍会拒绝其他策略要求的批准请求。缺少调用会话或已记录沙箱模式不会获得 Full access。批准被拒绝或不可用时，桌面调用不会执行；即使有应答方愿意批准，系统工具仍然要求 Full access。

`Snapshot` 与 `Screenshot` 接受以虚拟桌面像素表示的 `region=[left, top, right, bottom]`。`Scrape` 使用发起调用的会话模型提炼网页内容，以 `query` 指定重点；`use_dom` 选择活动浏览器的 DOM，`use_sampling=false` 则返回原文。Sampling 失败时也会回退到原文。独立模型调用会消耗已配置提供方的 token，并在该会话记录输入与输出；服务器不会获得对话历史或额外模型工具。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本插件通过真实 Loader 子项组合 `dsh-mcp-client`，并把固定工具目录同时传给 Windows-MCP 的 `--tools` 参数和桥接层的精确 `includeTools` 过滤器。存在 `ctx.appReady` 时，插件会在 profile 激活期间注册设置，把就绪前的设置变化折叠进当前来源，并在成功就绪后调度初始子进程协调；释放会取消尚未开始的工作。会话作用域的工具限制跟随最新记录的沙箱模式和 MCP 工具发现变化；执行前策略与只允许拒绝的守卫共同约束调用。子项成功移除前，策略会一直保留。运行时缺失或子项启动失败时，所有 Windows 工具都会保持缺失并记录错误，但不会阻止 DSH 启动；设置命名空间保持注册，以接收后续提交。

桌面构建会安装经过哈希固定的 CPython 与 wheel 包依赖闭包，再用经过审阅的源码快照替换完整 Windows-MCP Python 包。应用已记录的 TheFuzz 与 sampling 关联补丁前，会校验源码哈希和全部二十项工具签名。打包要求真实 MCP 工具发现、无副作用的 `Wait` 调用与 Scrape sampling 冒烟均通过。安装版启动会忽略环境中的运行时覆盖，只接受 `resources/windows-mcp/python.exe`；源码启动可以显式提供开发路径。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 设置协调与子项配置 |
| [`src/permissions.ts`](src/permissions.ts) | 固定工具目录、会话作用域发现与执行策略 |
| [`src/invariant.ts`](src/invariant.ts) | 运行时 invariant companion |
| [`../../../scripts/build-windows-mcp-runtime.ps1`](../../../scripts/build-windows-mcp-runtime.ps1) | 可复现 Windows 运行时装配与冒烟 |
| [`../../../third-party/windows-mcp/runtime.json`](../../../third-party/windows-mcp/runtime.json) | 上游版本、URL、哈希与本地补丁身份 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP 客户端桥接](../mcp-client/README.zh.md)——本插件继承的发现、命名、执行与重连行为。
- [Windows-MCP 集成 Agent Note](../../../.agents/notes/implemented/feature/2026-08-31-bundled-windows-mcp.zh.md)——发行、启用与安全决策。
- [Full access 策略 Agent Note](../../../.agents/notes/implemented/feature/2026-09-01-windows-mcp-full-access.zh.md)——完整系统权限与逐会话隔离。
- [默认启用 Agent Note](../../../.agents/notes/implemented/feature/2026-09-01-windows-mcp-default-on.zh.md)——运行时可用性与已保存选择的保留规则。
- [源码对齐与 sampling Agent Note](../../../.agents/notes/implemented/feature/2026-09-01-windows-mcp-source-parity.zh.md)——源码身份、关联模型访问与回放。
- [桌面应用](../../../apps/desktop/README.zh.md)——安装包布局与打包后启动。
- [第三方运行时清单](../../../third-party/README.zh.md)——上游出处与本地修改。

-----

<a id="model-experience"></a>
## 模型体验

### Windows 桌面工具

#### 模型看到什么

启用且连接成功时，模型会看到 `mcp__windows__Snapshot` 等十三项桌面工具；处于 Full access 时则能看到全部二十项工具，以及 Windows-MCP 提供的描述和 JSON schema。Full access 之外的桌面调用需要批准，额外系统工具则会被隐藏并拒绝执行。关闭该能力会从后续请求中移除全部 Windows 工具。

#### Token 影响

插件启用期间，可见的十三项或二十项工具的名称、描述与 schema 会为模型请求增加 token。工具参数以及返回的文本或图像会留在对话历史中，直到压缩发生。Scrape sampling 会增加一次独立记录的文本请求；只有生成的摘要或回退原文进入主对话。

#### KV Cache 影响

运行时与会话权限提供相同 schema 时，工具定义前缀保持稳定。启用、关闭、进入或退出 Full access，或修改已发布 schema 都会改变工具前缀，并可能从该点起影响缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义内置集成所支持的宿主、信任与工具范围。

- **仅支持 Windows x64 桌面版**——安装包使用官方 CPython AMD64 嵌入式发行版，非 Windows 构建不会携带该运行时。
- **依赖可见会话**——桌面操作需要未锁定的交互式 Windows 会话；服务、断开的会话与安全桌面不在支持路径内。
- **位于 DSH 沙箱之外**——Windows-MCP 使用其 Windows 进程权限执行操作。Full access 不会授予管理员令牌，也不能绕过 UAC 或安全桌面。权限降级不会撤销已经开始的操作。
- **仅限固定工具目录**——接纳固定二十项之外的工具需要代码、测试、安全审阅、运行时冒烟更新与新安装器。
- **每个启用的 profile 一个运行时**——本包拥有唯一 `windows` 命名空间，不提供用户自定义 Windows-MCP 服务器。
- **本地 stdio 集成**——内置功能不公开上游 HTTP/SSE 监听器或远程 OAuth 配置。只有当前路由明确支持图片输入且持久附件可用时，截图才会送达模型。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

上游版本、Python 版本、wheel 闭包、补丁摘要与冒烟表面构成同一个审阅升级单元。请一起更新并运行 Windows 桌面工作流；Linux 源码检出无法证明 UI Automation 或打包后的 AMD64 运行时。

</details>
