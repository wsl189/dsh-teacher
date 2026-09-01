# Agent Note：Windows 桌面发行版与 Release 更新

状态：已实现

[English](2026-08-25-windows-desktop-updates.md) | 中文

## 问题

仓库原有的 Windows 运行方式要求准备 Node 与 pnpm checkout、完成整仓构建并用浏览器打开。这适合开发，却不能为迁移到新 Windows 电脑的用户提供可安装应用、稳定快捷方式或受控更新路径。

产品 UI 也没有由应用发行方持有的状态。浏览器部署无法知道服务器进程是否来自安装包、应使用哪个 Release feed、安装器是否已经下载，或何时能安全替换应用文件。若把这些事实放进普通 Web Host，就会让远程浏览器获得机器级安装能力，同时让非桌面部署携带没有意义的控件。

JavaScript 应用与本地 AI 服务依赖有不同的可移植性要求。Electron 可以分发已构建的 DSH 依赖闭包，但 vLLM、MinerU、ASR 服务器、模型权重、GPU 驱动与本机专属插件配置需要独立的服务和数据生命周期管理。

## 决策

`apps/desktop` 是一个 Electron 应用，并打包为当前用户安装的 Windows x64 NSIS 安装器。renderer 关闭 Node integration，并启用 context isolation 与 sandbox。它从私有 `127.0.0.1` 服务器加载现有 Web 表层。新增的 `@deepseek-ai/dsh/desktop-backend` 入口会以禁用浏览器打开和系统分配端口的方式启动普通 `web` profile，请求 Connection 在 loopback URL 中加入当前进程的启动令牌，通过子进程 IPC 报告该 URL，并只接受一种关闭请求。Electron 边界只接受这个私有 origin 上带唯一令牌 query 的 URL；加载它时会把令牌交换为普通的 authority 绑定浏览器 cookie，再重定向到 `/`。自适应目录选择器会识别这个由 Electron 托管的 win32 进程并挂载应用内浏览交互，包括 QQ 机器人工作区等第三方字段；独立 win32 Node.js Host 仍保留原生系统选择器。这样不会再把打包后的 Electron 可执行文件启动为 native COM 对话框 worker。当 Electron 的嵌入式 Node 无法暴露内部模块 importer 时，Loader 只在宿主 fallback 内加载公开 ESM 解析器，并保留每棵 entry 树的包解析基准与 import 条件；客户端 bundle 保留 Loader entry API，但不会遍历解析器的 Node 专用依赖。仅配置 HMR 仍然可用，模块 HMR 则继续要求 Node 内部机制。无论普通退出还是安装更新，Electron 进程都会等待 profile 完整释放后再继续。

Electron 会创建一个固定小尺寸、无边框且透明的 BrowserWindow，并在 fork 后端前显示不含脚本的本地品牌文档。本地 CSS 用一个可拖动卡片填满该窗口，并以 28 像素半径裁剪四角。Windows 上的 Electron 透明窗口要求采用无边框构造，无法同时提供可调整大小的普通应用边框，因此通过校验的私有 loopback 启动 URL 会在另一个带边框的隐藏 BrowserWindow 中加载。页面加载完成后，Electron 会显示可调整大小的普通 1440×900 窗口、销毁启动卡片并开始检查更新。若退出流程取得控制权，或用户在导航期间关闭启动卡片，Electron 会销毁隐藏的应用窗口，避免它继续存活。后端就绪没有墙钟时间上限：明确的 fatal IPC 消息、fork 错误或子进程退出会立即拒绝，仍存活的子进程则可以继续完成首次启动的文件系统与杀毒软件工作，直到成功或用户关闭应用。打包的 Windows-MCP 运行时会在启动器就绪后启动，因此不会让私有 Web 页面继续等待 Python 启动与工具发现。

启动文档与 Windows 应用标识共享官方鲸鱼路径。桌面打包命令会在 electron-builder 运行前，将该路径绘制到浅色圆角底板并写入包含九种分辨率的 ICO。主进程会把打包的 ICO 指定给 BrowserWindow，builder 则把它指定给可执行文件与 NSIS 安装生命周期；开始菜单和桌面快捷方式继承可执行文件图标。浅色底板可让黑色鲸鱼在 Windows 的浅色与深色 shell 背景上都保持清晰。

renderer session 只向经过校验的后端 origin 上、属于当前窗口的主 frame 授予麦克风音频与剪贴板写入权限。摄像头、子 frame、外来 WebContents、其他 origin 与无关权限类型都会被拒绝。Electron 的权限检查与权限请求 handler 使用同一规则，并随窗口一同清除。

侧边栏在 `sidebar.settings` 旁声明独立的 `sidebar.update` single seat。只有 Electron preload 暴露窄 updater bridge 时，`ui-desktop-update` 才会占用它。检查中的快照不渲染；已是最新版的快照会把已安装版本渲染为静态底部状态。发现版本、下载进度、下载完成与可重试失败会分别显示对应操作。preload 只复制经过校验的可辨识联合更新状态，并暴露状态订阅、下载与安装动词。GitHub 访问、SemVer 选择、checksum、文件存储与安装器重启都通过 electron-updater 留在主进程中。

ESM 主 bundle 将 electron-updater 保留为外部依赖，并通过 CommonJS 默认导出读取其惰性 `autoUpdater` getter。这里不使用 ESM 命名导入，因为 Node 无法把这个 getter 静态识别为 CommonJS 命名导出。

updater 使用公开的 `wsl189/dsh-teacher` GitHub Releases feed。controller 会在已认证 Web 页面加载后检查，并且在发现更高 Release 前每五分钟检查一次。它会让同一个活跃 provider 请求跨 timer tick 复用，在下一次间隔重试失败的请求，并在应用退出前清除计时器。自动下载被关闭，用户需要从可见的更新操作开始下载。预发布安装版可以接收 prerelease，稳定版则不会。生成的 `latest.yml` SHA-512 记录是下载文件的完整性来源；配置 Authenticode 凭据后还会增加 Windows 发布者验证与信誉。

`.github/workflows/windows-desktop.yml` 使用原生 Windows 与 Node 24，在每次分支推送和手动触发时构建 NSIS artifact。它会启动解包后的应用、等待主窗口、从桌面日志中取得经过认证的私有后端 URL，在不跟随重定向的情况下交换令牌，并要求已认证的 `directoryPicker/list` Remote 返回有效目录列表。随后，它会通过打包 Host 创建 `standard` preset 会话，并要求其命令目录包含 `/goal` 与 `/plan`，之后才保留 artifact。失败诊断会遮盖启动令牌。`v<版本>` tag 必须与仓库根共享 package 版本一致，workflow 才会把安装器、blockmap、channel 元数据与 SHA-256 checksum 列表发布到 GitHub Release。普通提交构建只保留为 workflow artifact，绝不会进入客户端更新 feed。

安装器包含 Electron、其内嵌 Node 运行时、已构建前端，以及关闭 `asar` 的 DSH 生产依赖闭包，使动态插件、worker、子进程入口与原生 addon 都保留为真实文件。作用于整个依赖树的文件过滤器会在 NSIS 压缩前，从 workspace 链接包与 registry 包中移除 Source Map 和 TypeScript 增量编译状态；两者都不参与安装版运行。桌面 manifest 会列出全部必需 workspace 对等依赖，以及 electron-builder 无法经传递关系收集的 workspace 依赖。它还会直接锚定 `turndown` 与 `@joplin/turndown-plugin-gfm`；标准 preset 动态 import `@deepseek-ai/dsh-tool-web` 时需要这两个包的可执行入口。electron-builder 完成依赖收集后，Windows `afterPack` 钩子会从桌面应用解析这两个包，并从 Turndown 的依赖解析基址定位 `@mixmark-io/domino`。钩子会把收集到的这三个包目录替换为明确的运行时子集，其中包含各包的 manifest、许可证与 `lib` 目录，并继续应用作用于依赖树的 Source Map 和编译状态排除规则。载荷门禁除检查每份已打包 workspace manifest、要求其非可选 workspace 依赖与 peer 位于应用根目录外，还会要求这三个可执行入口。安装器不包含 vLLM、MinerU、ASR、模型权重、GPU 驱动、第三方 profile 配置或 `%USERPROFILE%\.dsh` 用户数据。这些服务仍可独立部署，包括使用 Docker；安装版应用通过配置的端点调用它们。

## 考虑过的替代方案

**生成单个 `pkg` 可执行文件。** 现有单文件工作打包的是有意闭合的 JSON-RPC runtime，并且排除了 Windows。若扩展到完整 Web 组合，就要为动态 Loader 包解析、客户端资源、原生 addon、worker 与子进程文件，以及自替换 helper 定制处理，等于重新实现 Electron 与 NSIS 已维护的更新和安装生命周期。

**把完整应用与 GPU 服务放进同一个 Docker image。** 容器适合保障 MinerU、vLLM 与 ASR 服务的可重复性，但 Windows 桌面容器不能提供原生的当前用户 GUI、快捷方式、浏览器隔离或普通自更新体验。GPU 驱动与宿主兼容性也仍然位于 image 之外。因此桌面安装器与服务容器解决的是不同部署单元。

**从 Web Host 暴露更新控件。** 这会让用于服务浏览器的同一个网络表层具备替换宿主安装的能力。由 preload gating 的 seat 把安装权限留在已打包桌面进程本地，并让普通浏览器部署保持不变。

**仅在应用启动时检查。** 单次请求不会产生定期网络流量，但无法发现长期开窗期间发布的 Release，也无法在短暂 provider 故障后免重启恢复。五分钟轮询限制了发现延迟，并会在更新可用后停止 provider 请求。

**延长后端启动时限。** 更大的常量仍会保留创建窗口前的空白等待，并会在更慢的机器或杀毒扫描中再次失败。可见启动文档让等待可观察，而明确的子进程失败仍是终止条件。

**使用 `asar`，而不是逐项过滤构建产物。** 单一 archive 可以进一步减少文件系统条目，但当前 runtime 中的 Loader 包、子进程入口、worker 与原生 addon 需要真实路径。保持解包状态可以保留这些行为，而按后缀过滤仍能移除不参与安装版运行的文件。

**使用宽泛 glob 排除源码目录与第三方库的其他构建版本。** 包资源和 Loader 解析的入口没有统一目录布局，因此目录级规则可能移除可执行内容。因此载荷只移除在所有依赖中都只用于开发的后缀；若要进一步缩小文件集合，需要用显式的 staged-runtime manifest 证明每一条保留路径。

**依赖 electron-builder 保留动态 workspace 包的全部传递 registry 依赖。** pnpm 11 可能把直接依赖报告为 workspace 列表中的去重引用，却不提供 electron-builder 可收集的规范依赖树。桌面 manifest 的直接锚定仍会声明所有权，但无法强制该包及其传递依赖进入输出。打包后的运行时子集和可执行文件检查会显式固定该依赖闭包，而无需把每个动态插件都摊平进 Electron manifest。

## 结果

- Windows 用户无需安装 Node 或 pnpm 即可安装和更新本仓库构建。其 DSH home 保持独立；若要完整迁移电脑，仍需另行复制。
- 每次推送提交都会消耗一次原生 Windows 构建，但只有匹配的版本 tag 会发布更新元数据。发布操作者必须先递增共享版本，再创建 tag。
- 未签名构建仍能运行，但可能触发 SmartScreen。生产发行需要两个代码签名仓库 secret，并保证更新之间的证书发布者身份稳定。
- 发行版仅支持 Windows x64。外部 AI 服务与 GPU 软件继续采用各自的安装、健康检查、更新与存储流程。
- 桌面 Web server 仍只绑定 loopback，并使用临时端口，因此安装器不会新增暴露到 LAN 的代码执行表层，也不会占用固定本地端口。
- 已是最新版的安装版每五分钟最多发出一次公开 Release 元数据请求。长期开窗可以免重启发现已发布的 Release，短暂 provider 故障也会自动重试。
- 用户会在 profile 初始化开始前看到紧凑的圆角品牌卡片，已认证的 Web 应用仍使用带普通边框的窗口。无法 settle 的插件可能让卡片持续显示到用户关闭应用；仅凭经过时间无法把它与正常的首次启动工作区分开。
- 安装版不包含 Source Map，因此其中的 stack trace 指向生成后的 JavaScript；开发构建仍保留源码导航。移除 Source Map 与编译器状态可以减少 NSIS 解压工作，以及 Windows 安全软件需要检查的文件数量。
- 暂存的 HTML 转换包不会包含 registry 包的测试、工具和替代发行 bundle。如果依赖更新改变了必需的 manifest、许可证或 `lib` 入口，暂存钩子或载荷门禁会失败，直到明确运行时集合同步更新。

## 测试

桌面 update-controller 测试覆盖未打包时的当前版本投影、预发布选择、五分钟轮询、重入抑制、退出清理、发现版本、手动下载、进度、下载完成安装、隐藏检查失败、可见重试失败与无效操作。运行时适配器测试只把 electron-updater 暴露为 CommonJS 默认导出，并要求从中解析 `autoUpdater`。客户端测试覆盖隔离边界校验、observable 订阅释放、展开与轨道当前版本状态、更新操作、进度、重启、重试、普通浏览器抑制、晚到 slot 声明与插件释放。侧边栏测试固定新增 seat 声明及其展开／轨道 owner share。Web 场景会在真实已发布组合启动前注入同一个 preload API，确认当前版本位于「设置」旁，检查可用操作会在同一位置替换该状态，驱动下载与重启状态，并捕获两份无障碍快照。QQ 工作区场景会用一个预置的离线机器人启动真实发行组合，打开其工作区操作，并在不调用模型的情况下捕获真实 Host 支持的应用内目录列表。app-boot 与 preset 测试禁用 Loader 内部机制，并要求配置自有与宿主自有的包均保留 ESM import 解析；HMR 测试要求该模式下精确配置监听仍保持可用。Workspace constraints 会拒绝 `@deepseek-ai/dsh` 完整生产依赖图中缺失的任何非可选 peer。after-pack 测试会从各自所属包的解析基址定位直接 Turndown 包与传递 Domino 包，替换过期的收集器输出，只保留 manifest、许可证与经过过滤的 `lib` 目录，并拒绝缺失任何已声明运行时入口。桌面载荷校验器 fixture 会接受完整 workspace 依赖、缺失的可选 peer、运行时 JavaScript、资源与原生 addon，同时拒绝缺失的必需 workspace 包、嵌套 Source Map 与编译器状态；其 Windows 运行时集合会固定 Turndown、GFM 插件与 Domino 的入口文件。Windows workflow 构建真实 NSIS target，校验 `resources/app` 中的依赖闭包，使用隔离的用户数据运行应用，要求其打开 `DeepSeek Harness` 窗口、交换启动令牌、调用已认证的 `directoryPicker/list` Remote、创建标准会话，并要求其命令目录包含 `/goal` 与 `/plan`；它还会在保留或发布 artifact 前拒绝缺少安装器或 `latest.yml` 的结果。

renderer 权限测试会执行两种 Electron handler，并要求仅为当前回环主 frame 放行音频麦克风、保留剪贴板写入，拒绝视频、子 frame、外来 renderer、外来或畸形 origin 与无关权限，同时验证 handler 清理可重复调用。桌面启动测试要求紧凑的本地卡片先于后端工作变为可见，校验本地化且不含脚本的标记、透明的 28 像素圆角裁剪、相互独立的启动窗口与应用窗口构造选项，以及退出或卡片关闭在导航期间优先时对隐藏应用窗口的清理。测试还会让健康后端等待模拟的 90 秒，拒绝明确的 fatal 与退出结果，并证明 listener 清理。桌面图标测试要求 SVG 使用启动页鲸鱼路径，检查 ICO 的全部九个条目与 PNG 尺寸，并固定可执行文件和 NSIS 图标配置。
