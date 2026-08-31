---
description: "桌面更新状态与操作：通过隔离的 Electron bridge 显示已安装版本，并安装经校验的 Windows Release。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-update

[English](README.md) | 中文

## 概述

当隔离上下文的 Electron preload 暴露 `window.dshDesktopUpdate` 时，本包填充侧边栏的 `sidebar.update` seat。它展示桌面更新器的当前状态，但不会向浏览器代码提供 Electron 对象、文件系统访问、凭据或任意 IPC。普通 Web 启动会让该 seat 保持为空。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在打包桌面版的 Web 组合中，将本插件与 `ui-sidebar` 一同挂载。检查中不渲染任何内容；已是最新版本时，会在「设置」旁以**版本号**标注已安装版本。发现新的 GitHub Release 后，该状态会替换为**更新**；下载时标签显示进度，完成后显示**重启更新**，失败后保留**重试更新**。侧边栏收起时不显示当前版本状态，各项更新操作仍显示为纯图标轨道按钮。

浏览器只能通过 preload allowlist 请求下载或安装。Release 访问、完整性校验、后端关闭与安装器重启都由 Electron 主进程负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

preload 公开同步快照、数字订阅和两个命令。插件会校验每份复制后的快照，将来源包装为 `HostObservable`，再由 slot renderer 通过 `useUpdate` 绑定；组件实例本身不持有订阅状态。只有存在有效 bridge 时才注册占位者，因此浏览器构建和不完整的 preload API 会通过保持 seat 为空实现故障关闭。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [桌面应用](../../../apps/desktop/README.zh.md)——负责隔离 preload、更新控制器、后端生命周期与安装包行为。
- [ui-sidebar](../ui-sidebar/README.zh.md)——声明更新 seat 及其展开和收起位置。
- [Windows 桌面更新](../../../.agents/notes/implemented/feature/2026-08-25-windows-desktop-updates.zh.md)——记录 Release 选择、校验、CI 与安装义务。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该包只渲染本地应用更新状态，不会改变模型请求。

#### KV 缓存影响

无；更新元数据与操作始终位于会话和提供方请求之外。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **仅限打包后的 Electron 应用**：源码启动与普通 Web 启动会有意隐藏更新操作；安装版还需要能访问配置好的公开 GitHub Releases feed。
- **只在启动时检查**：若 Release 在进程启动后才发布，需要下次启动才会出现；应用不会在后台周期轮询。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

preload 与浏览器来源必须对协议进行对称校验。新增更新器命令需要显式加入 preload allowlist 并由主进程实现；不要公开通用 IPC 发送器。

</details>
