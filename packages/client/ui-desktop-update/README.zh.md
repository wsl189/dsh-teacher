# `@deepseek-ai/dsh-client-ui-desktop-update`

[English](README.md) | 中文

这是用于侧边栏 `sidebar.update` seat 的桌面端专用浏览器插件。只有隔离上下文的 Electron preload 暴露 `window.dshDesktopUpdate` 时，插件才会注册占位者；普通浏览器会让该 seat 保持为空。preload 提供同步快照与数字订阅 ID API，插件将其包装为 `HostObservable`，由 slot renderer 绑定成 `useUpdate`，组件本身不管理订阅。

检查中与已是最新版本时不渲染任何内容。发现新的 GitHub Release 后，会在「设置」右侧显示「更新」；下载时标签显示进度；下载完成后显示「重启更新」；下载失败后保留「重试更新」。侧边栏收起时，同一个操作会变成 36px 的纯图标轨道控件。下载与安装请求通过 preload bridge 返回；提供方访问、文件校验、Host 关闭与安装器重启都由 Electron 主进程持有。

renderer 会先校验每个复制过来的状态再发布。它不会获得 Electron 对象、文件系统能力、token 或任意 IPC 通道；`contextIsolation`、preload allowlist 与主进程状态机共同构成桌面端安全边界。

## 模型体验

无，因为该包只渲染本地应用更新状态，不会改变模型请求。

#### KV Cache 影响

无；更新元数据与操作始终位于会话和提供方请求之外。

## 已知限制与暂缓事项

- **该控件依赖已打包的 Electron preload**：源码启动与普通 Web 启动会有意隐藏更新操作；安装版还需要能访问配置好的公开 GitHub Releases feed。
- **只在桌面端启动时检查**：若 Release 在进程启动后才发布，需要下次启动才会出现；当前没有周期性后台轮询。
