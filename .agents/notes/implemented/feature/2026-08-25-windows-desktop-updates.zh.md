# Agent Note：Windows 桌面发行版与 Release 更新

状态：已实现

[English](2026-08-25-windows-desktop-updates.md) | 中文

## 问题

仓库原有的 Windows 运行方式要求准备 Node 与 pnpm checkout、完成整仓构建并用浏览器打开。这适合开发，却不能为迁移到新 Windows 电脑的用户提供可安装应用、稳定快捷方式或受控更新路径。

产品 UI 也没有由应用发行方持有的状态。浏览器部署无法知道服务器进程是否来自安装包、应使用哪个 Release feed、安装器是否已经下载，或何时能安全替换应用文件。若把这些事实放进普通 Web Host，就会让远程浏览器获得机器级安装能力，同时让非桌面部署携带没有意义的控件。

JavaScript 应用与本地 AI 服务依赖有不同的可移植性要求。Electron 可以分发已构建的 DSH 依赖闭包，但 vLLM、MinerU、ASR 服务器、模型权重、GPU 驱动与本机专属插件配置需要独立的服务和数据生命周期管理。

## 决策

`apps/desktop` 是一个 Electron 应用，并打包为当前用户安装的 Windows x64 NSIS 安装器。renderer 关闭 Node integration，并启用 context isolation 与 sandbox。它从私有 `127.0.0.1` 服务器加载现有 Web 表层。新增的 `@deepseek-ai/dsh/desktop-backend` 入口会以禁用浏览器打开和系统分配端口的方式启动普通 `web` profile，通过子进程 IPC 报告经过校验的 loopback URL，并只接受一种关闭请求。自适应目录选择器会识别这个由 Electron 托管的 win32 进程并挂载应用内浏览交互，包括 QQ 机器人工作区等第三方字段；独立 win32 Node.js Host 仍保留原生系统选择器。这样不会再把打包后的 Electron 可执行文件启动为 native COM 对话框 worker。当 Electron 的嵌入式 Node 无法暴露内部模块 importer 时，Loader 只在宿主 fallback 内加载公开 ESM 解析器，并保留每棵 entry 树的包解析基准与 import 条件；客户端 bundle 保留 Loader entry API，但不会遍历解析器的 Node 专用依赖。仅配置 HMR 仍然可用，模块 HMR 则继续要求 Node 内部机制。无论普通退出还是安装更新，Electron 进程都会等待 profile 完整释放后再继续。

renderer session 只向经过校验的后端 origin 上、属于当前窗口的主 frame 授予麦克风音频与剪贴板写入权限。摄像头、子 frame、外来 WebContents、其他 origin 与无关权限类型都会被拒绝。Electron 的权限检查与权限请求 handler 使用同一规则，并随窗口一同清除。

侧边栏在 `sidebar.settings` 旁声明独立的 `sidebar.update` single seat。只有 Electron preload 暴露窄 updater bridge 时，`ui-desktop-update` 才会占用它。检查中与已是最新版的快照不渲染；发现版本、下载进度、下载完成与可重试失败会分别显示对应操作。preload 只复制经过校验的可辨识联合更新状态，并暴露状态订阅、下载与安装动词。GitHub 访问、SemVer 选择、checksum、文件存储与安装器重启都通过 electron-updater 留在主进程中。

ESM 主 bundle 将 electron-updater 保留为外部依赖，并通过 CommonJS 默认导出读取其惰性 `autoUpdater` getter。这里不使用 ESM 命名导入，因为 Node 无法把这个 getter 静态识别为 CommonJS 命名导出。

updater 使用公开的 `wsl189/dsh-teacher` GitHub Releases feed。自动下载被关闭，用户需要从可见的更新操作开始下载。预发布安装版可以接收 prerelease，稳定版则不会。生成的 `latest.yml` SHA-512 记录是下载文件的完整性来源；配置 Authenticode 凭据后还会增加 Windows 发布者验证与信誉。

`.github/workflows/windows-desktop.yml` 使用原生 Windows 与 Node 24，在每次分支推送和手动触发时构建 NSIS artifact。它会启动解包后的应用、等待主窗口、从桌面日志中取得私有后端 URL，并要求 `host.listDirectory` 返回有效目录列表，之后才保留 artifact。`v<版本>` tag 必须与仓库根共享 package 版本一致，workflow 才会把安装器、blockmap、channel 元数据与 SHA-256 checksum 列表发布到 GitHub Release。普通提交构建只保留为 workflow artifact，绝不会进入客户端更新 feed。

安装器包含 Electron、其内嵌 Node 运行时、已构建前端，以及关闭 `asar` 的 DSH 生产依赖闭包，使动态插件、worker、子进程入口与原生 addon 都保留为真实文件。electron-builder 会沿生产依赖图打包而不会使用 workspace 开发依赖，因此 `@deepseek-ai/dsh` manifest 会直接满足静态启动路径使用的所有非可选 peer。安装器不包含 vLLM、MinerU、ASR、模型权重、GPU 驱动、第三方 profile 配置或 `%USERPROFILE%\.dsh` 用户数据。这些服务仍可独立部署，包括使用 Docker；安装版应用通过配置的端点调用它们。

## 考虑过的替代方案

**生成单个 `pkg` 可执行文件。** 现有单文件工作打包的是有意闭合的 JSON-RPC runtime，并且排除了 Windows。若扩展到完整 Web 组合，就要为动态 Loader 包解析、客户端资源、原生 addon、worker 与子进程文件，以及自替换 helper 定制处理，等于重新实现 Electron 与 NSIS 已维护的更新和安装生命周期。

**把完整应用与 GPU 服务放进同一个 Docker image。** 容器适合保障 MinerU、vLLM 与 ASR 服务的可重复性，但 Windows 桌面容器不能提供原生的当前用户 GUI、快捷方式、浏览器隔离或普通自更新体验。GPU 驱动与宿主兼容性也仍然位于 image 之外。因此桌面安装器与服务容器解决的是不同部署单元。

**从 Web Host 暴露更新控件。** 这会让用于服务浏览器的同一个网络表层具备替换宿主安装的能力。由 preload gating 的 seat 把安装权限留在已打包桌面进程本地，并让普通浏览器部署保持不变。

## 结果

- Windows 用户无需安装 Node 或 pnpm 即可安装和更新本仓库构建。其 DSH home 保持独立；若要完整迁移电脑，仍需另行复制。
- 每次推送提交都会消耗一次原生 Windows 构建，但只有匹配的版本 tag 会发布更新元数据。发布操作者必须先递增共享版本，再创建 tag。
- 未签名构建仍能运行，但可能触发 SmartScreen。生产发行需要两个代码签名仓库 secret，并保证更新之间的证书发布者身份稳定。
- 发行版仅支持 Windows x64。外部 AI 服务与 GPU 软件继续采用各自的安装、健康检查、更新与存储流程。
- 桌面 Web server 仍只绑定 loopback，并使用临时端口，因此安装器不会新增暴露到 LAN 的代码执行表层，也不会占用固定本地端口。

## 测试

桌面 update-controller 测试覆盖未打包时抑制、预发布选择、发现版本、手动下载、进度、下载完成安装、隐藏检查失败、可见重试失败与无效操作。运行时适配器测试只把 electron-updater 暴露为 CommonJS 默认导出，并要求从中解析 `autoUpdater`。客户端测试覆盖隔离边界校验、observable 订阅释放、无更新时隐藏、展开与轨道操作、进度、重启、重试、普通浏览器抑制、晚到 slot 声明与插件释放。侧边栏测试固定新增 seat 声明及其展开／轨道 owner share。Web 场景会在真实已发布组合启动前注入同一个 preload API，确认已是最新版时没有按钮、可用操作位于设置右侧，驱动下载与重启状态，并捕获无障碍快照。QQ 工作区场景会用一个预置的离线机器人启动真实发行组合，打开其工作区操作，并在不调用模型的情况下捕获真实 Host 支持的应用内目录列表。app-boot 与 preset 测试禁用 Loader 内部机制，并要求配置自有与宿主自有的包均保留 ESM import 解析；HMR 测试要求该模式下精确配置监听仍保持可用。Workspace constraints 会拒绝 `@deepseek-ai/dsh` 完整生产依赖图中缺失的任何非可选 peer。Windows workflow 构建真实 NSIS target，使用隔离的用户数据运行应用，要求其打开 `DeepSeek Harness` 窗口且 `host.listDirectory` 方法成功，并在拒绝启动失败前输出 Electron 日志；它还会在保留或发布 artifact 前拒绝缺少安装器或 `latest.yml` 的结果。

renderer 权限测试会执行两种 Electron handler，并要求仅为当前回环主 frame 放行音频麦克风、保留剪贴板写入，拒绝视频、子 frame、外来 renderer、外来或畸形 origin 与无关权限，同时验证 handler 清理可重复调用。
