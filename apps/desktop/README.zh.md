# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

这是本仓库的 Windows 桌面发行版。Electron 在强化后的 renderer 中打开现有 Web 表层，`@deepseek-ai/dsh/desktop-backend` 则把完整 `web` profile 作为受 IPC 控制的子进程运行在 `127.0.0.1` 的系统分配端口上。子进程会向 Electron 提供一次性启动令牌 URL，并创建与 `dsh web` 相同的已认证浏览器会话。关闭应用时，Electron 会先要求该子进程释放插件树；若关闭停滞，Electron 再终止该进程。目录选择会留在当前应用内：工作区操作以及 QQ 机器人当前工作区等插件字段会打开应用内目录浏览器，不再启动第二个打包进程来显示 Windows 文件夹对话框。

Electron 会创建一个固定小尺寸、无边框、透明且不含脚本的品牌卡片；卡片四角采用 28 像素圆角，并在卡片加载期间启动后端。profile 树初始化期间，卡片会保持可见。子进程报告通过校验的启动 URL 且该页面在隐藏的普通窗口中加载完成后，Electron 才会显示带普通边框且可调整大小的 1440×900 应用窗口，并销毁启动卡片。若用户在私有页面加载期间关闭卡片，隐藏的应用窗口也会销毁。启动没有固定的墙钟时间上限：明确的 fatal 消息、fork 错误或子进程提前退出仍会立即失败，健康的首次启动则可继续完成杀毒软件扫描。后端只在 profile 成功启动后才调度 Windows-MCP，Electron 则只在应用窗口可见后加载更新提供方，因此这两项任务都不会阻塞各自所跟随的就绪时点。

Electron 为[新建 IM 机器人的工作区](../../third-party/README.zh.md)提供系统桌面目录，包括重定向到 OneDrive 或其他磁盘的桌面。

## 安装与更新

从本仓库的 [GitHub Releases](https://github.com/wsl189/dsh-teacher/releases) 下载 `DSH-Teacher-<版本>-x64-Setup.exe`。NSIS 安装器支持选择当前用户的安装目录，并创建开始菜单项与桌面快捷方式。可执行文件、任务栏窗口、快捷方式、安装器与卸载器统一使用浅色圆角底板上的黑色鲸鱼图标。安装器把 PPT Master 包含 12,939 个文件的完整分发存为一个预压缩归档，因此首次安装与版本替换不会逐个创建这些文件。安装版会在启动时检查同一个 Release feed，并且在发现更高版本前每五分钟检查一次。没有更高版本时，界面底部会显示已安装版本。出现更高版本后，该状态会替换为「设置」右侧的「更新」操作；点击后下载安装器，通过 electron-builder 的 `latest.yml` SHA-512 元数据校验文件，完成后显示「重启更新」。该操作会立即隐藏应用，给后端 1 秒时间完成正常释放，必要时终止后端，然后启动已校验的安装器；普通退出仍使用较长的关闭时限。

会话、设置、凭据与教师工作台数据仍保存在普通 DSH home 下（未设置 `DSH_HOME` 时为 `%USERPROFILE%\.dsh`）。生图插件会把生成历史、画廊与模板缓存保存在 `%USERPROFILE%\.dsh\dsh-imagegen`。重新安装应用不会替换这些目录。迁移到另一台电脑时，需要另行复制这些数据目录。

对话输入框与日常管理共用同一条麦克风链路。Electron 只允许本应用私有回环地址的主页面采集音频，仍拒绝摄像头与外来内容，并保留复制控件所需的剪贴板写入。完整浏览器录音会先在本机解码为 16 kHz 单声道 PCM WAV，再调用**设置 → 模型 → 使用场景**中选择的供应商语音服务。QQ 语音消息也会把其 WAV 附件交给同一个 Host 语音运行时，因此三处共用一项模型分配，不再要求每个本地服务都能解码 Chromium WebM。Windows 中还必须打开**设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问麦克风**；操作系统拒绝时，界面会显示既有的麦克风权限提示。

应用内目录浏览器会列出 Windows Host 上的真实文件夹，并可直接选择当前文件夹；QQ 工作区对话框的标题为「选择机器人工作区目录」。安装版不出现 Windows 系统文件夹窗口是预期行为。

安装包还包含一套仅供内置 Windows-MCP 集成使用、版本固定的私有 Python 运行时。桌面控制默认启动，但用户已保存的关闭设置会继续生效；运行时不会加入 `PATH`。通用**插件配置**标签页不展示 Windows 桌面控制配置项；无需另装 Python、`uv`、Windows-MCP 或配置 MCP。Full access 会开放固定运行时的全部二十项工具，不额外请求桌面操作批准；其他模式提供十三项桌面工具并逐次请求批准。[Windows-MCP 权限](../../packages/mcp/windows-mcp/README.zh.md#tools-and-permission-modes)定义会话隔离和仍然生效的策略检查。

AnySearch 已内置，用于网页搜索与正文提取。可选密钥、服务地址与单次搜索结果上限在**设置 → 插件 → 插件配置 → 网页搜索**中配置；未配置密钥时使用匿名访问。[网页搜索配置](../../packages/bundle/web-app/README.zh.md#built-in-web-search)说明可接受的结果范围、远程服务限制与向外发送的数据。桌面载荷门禁要求包含其编译插件与 MIT 许可证。

## 本机构建

请在原生 Windows PowerShell 中，从仓库根目录运行：

```powershell
pnpm install
pwsh -NoProfile -File scripts/build-windows-mcp-runtime.ps1
pnpm run build:official
pnpm --filter @deepseek-ai/dsh-desktop run package:win
```

运行时装配要求使用 `third-party/windows-mcp/runtime.json` 记录的确切 setup Python 版本。脚本会下载并校验官方嵌入式压缩包，只安装经过哈希固定的二进制 wheel，应用已记录的本地补丁，并在创建桌面安装包前完成真实 MCP stdio 冒烟。桌面打包命令会在 electron-builder 运行前，从启动页的官方鲸鱼路径重新生成 `apps/desktop/build/icon.svg` 与包含九种分辨率的 `icon.ico`。

安装器、blockmap、更新元数据与解包后的应用都会写入 `apps/desktop/release/`。分发安装器前，请在 Windows 上启动 `apps/desktop/release/win-unpacked/DSH Teacher.exe`，等待 `DeepSeek Harness` 主窗口出现，创建标准会话，并确认其斜杠命令目录与工作区目录操作均可加载；仅成功生成 artifact 并不会执行 Electron 主进程或动态解析的 preset。签入的 builder 配置面向 Windows x64，并有意关闭 `asar`，因为 Host 需要从真实文件加载插件包、子进程入口、worker 与原生 addon。作用于整个依赖树的排除规则会移除 Source Map 与 TypeScript 增量编译状态。标准 preset 会动态解析 `dsh-tool-web`，因此桌面 manifest 直接锚定 Turndown 及其 GFM 插件。`afterPack` 钩子从桌面应用解析这两个包，并从 Turndown 的依赖解析基址定位 Domino，再把各包的 manifest、许可证与运行时 `lib` 目录写入 `resources/app`；同一钩子把经过排序的完整 PPT Master 目录写入 `resources/ppt-master.tgz`，并移除安装载荷中的散文件副本。载荷门禁会读取该归档，并要求其中包含精确的文件数、逻辑字节数、归属文件、脚本、参考资料、布局和代表性二进制资源。门禁还要求包含生图 Host 与 Client bundle、模板快照与许可证、技能／MCP 包、Univer Viewer、Gateway、worker、技能、商业资源、Windows x64 原生 binding、嵌入式 CPython 可执行文件、Windows-MCP 元数据和代表性的原生 Python 模块。

## GitHub 自动化

`.github/workflows/windows-desktop.yml` 会在每次分支推送和手动触发时运行。它在 `windows-2025` 上构建并冒烟固定的 Windows-MCP 运行时，随后构建仓库、生成 NSIS 安装器、启动解包后的应用，把启动令牌交换为浏览器 cookie，调用真实的 `directoryPicker/list` Remote，创建标准 preset 会话，并要求其返回 `/goal` 与 `/plan` 命令行，之后才写入 `SHA256SUMS.txt` 并把安装器保留为 workflow artifact。只有 tag 与 `v<根 package 版本>` 完全一致时，才会把这些文件发布为更新 feed。

要发布一个客户端可见的新版本，请先递增仓库共享版本，推送版本提交，再创建匹配的桌面 tag：

```sh
pnpm run release:dsh patch
git push origin HEAD
git tag v0.1.2
git push origin v0.1.2
```

请把 `0.1.2` 换成 bump 命令实际写入的版本。bump 命令会自行创建版本提交。它输出的 `dsh-v<版本>` tag 属于独立的 npm 发布流程；桌面 workflow 使用额外的 `v<版本>` tag。`0.1.2-rc.1` 这类预发布版本会创建 GitHub prerelease，并且只会推送给已安装的预发布版。

仓库 secrets `WINDOWS_CSC_LINK` 与 `WINDOWS_CSC_KEY_PASSWORD` 可让 electron-builder 启用 Authenticode 签名。没有它们也能构建，但未签名安装器可能触发 Microsoft Defender SmartScreen，不应把这种产物描述为可信生产二进制文件。

## 安全与打包范围

renderer 启用 `contextIsolation` 与 sandbox，并关闭 Node integration。preload 只暴露更新快照、订阅、下载和安装方法。初始 loopback URL 会把当前进程的令牌交换为绑定 authority 的 HttpOnly 浏览器 cookie，再重定向到不带令牌的根 URL。外部导航会被拒绝并交给系统浏览器。GitHub 元数据与下载始终留在主进程，安装器由 electron-updater 按 SemVer 选择。

安装器包含 Electron、JavaScript／Node 运行时、本仓库已构建的 Web UI，以及完整的发行版 DSH 插件闭包，其中包括 AI 生图工作室、IM、cron、技能／MCP 管理、Windows 桌面控制、AGPL Office 查看器、Univer Office、供应商模型媒体适配器，以及带脚本、参考资料、模板、媒体、许可证与赞助记录的 PPT Master 6.1.0。这些插件和 Skill 资源不需要单独安装。仅 Windows-MCP 带有一套私有嵌入式 CPython 与 wheel 闭包，除非 Windows 桌面控制被关闭，否则它会默认启动；安装版从 `resources/windows-mcp` 解析它，并忽略环境中的覆盖路径。EXE 不会内嵌生图服务或模型、PPT Master 的可选 Python 包、vLLM、MinerU、语音识别服务、模型权重、GPU 驱动、Docker、Chrome／Chromium 可执行文件、Univer 许可证或本机专属插件配置。请在**设置 → 模型 → 服务接入**中配置语音识别与图像生成线路，再于**使用场景**分别分配受支持的模型；录音、提示词与参考图会离开本机并发送给所选服务。外部运行时、服务与私有值应独立维护，并单独迁移 `DSH_HOME` 与生图数据目录。

## 已知限制与暂缓事项

- **仅支持 Windows x64**：不会生成 arm64 安装器，也没有 macOS／Linux 桌面产物。
- **外部 AI 服务仍是部署依赖**：MinerU 默认指向 `http://127.0.0.1:8005/file_parse`；生图、vLLM 与 ASR 端点需要单独安装和运行。
- **Windows 桌面控制需要交互式会话**：可见桌面操作要求 Windows 未锁定。Full access 不会授予 Windows 管理员权限，也不能绕过 UAC、安全桌面或其他 DSH 策略。
- **Univer 试用与授权使用**：未设置 `UNIVER_LICENSE` 时，Viewer 按上游试用限制打开；授权功能需要有效的运行时许可证，分发时仍需取得相应权利；Slide 渲染操作还需要本机 Chrome／Chromium，必要时通过 `UNIVER_RENDER_BROWSER` 指定。
- **代码签名依赖仓库 secret**：未签名的 fork 构建可以运行，但 Windows 可能显示信誉警告。
