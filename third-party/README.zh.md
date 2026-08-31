# 第三方来源产物

[English](README.md) | 中文

本目录固定 dsh-teacher 发行版使用且已经审阅的第三方插件产物。它们是项目构建输入，不再是每台机器分别安装的文件：`@deepseek-ai/dsh-web-app` 已将其声明为依赖并挂载到发行 profile，因此从源码启动或使用 Windows EXE 都不需要另行执行 `dsh plugin add`。

## 清单

| 目录 | 产物 | 版本 | 上游 | 发行版作用 |
|---|---|---:|---|---|
| `dsh-imagegen/` | `dickpy-dsh-imagegen-1.5.1-dsh.1.tgz` | 1.5.1，DSH 运行时重打包 1 | [dickpy/dsh-imagegen](https://github.com/dickpy/dsh-imagegen) | AI 生图工作室、文生图与图生图工具、画廊和提示词模板。 |
| `dsh-im/` | `xmanrui-dsh-im-1.0.3.tgz` | 1.0.3 | [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | 九种 IM 平台、QQ 文件发送、手机提醒与 QQ ASR 设置。 |
| `dsh-plugin-cron/` | `dsh-plugin-cron-0.1.3.tgz` | 0.1.3 | [abiaoa1314/dsh-plugin-cron](https://github.com/abiaoa1314/dsh-plugin-cron) | 持久 cron 任务、模型工具与浏览器管理页。 |
| `dsh-skill-mcp-panel/` | `dsh-skill-mcp-panel-2.0.1.tgz` | 2.0.1 | [Fishquito7/dsh-skill-mcp-panel](https://github.com/Fishquito7/dsh-skill-mcp-panel) | 通过 Web 与 CLI 管理全局／工作区技能和 profile MCP 服务器。 |
| `dsh-univer-office/` | `dsh-univer-office-0.2.12-dsh.1.tgz` | 0.2.12，DSH 重构建 1 | [dream-num/dsh-univer-office](https://github.com/dream-num/dsh-univer-office) | 由 agent 创建 Sheets、Docs、Slides、Bases 与 Boards，并通过隔离草稿审阅和导入／导出 Office 文件。 |
| `windows-mcp/` | 嵌入式 CPython 与哈希固定的 wheel 输入 | CPython 3.14.7；Windows-MCP 0.8.5 | [python/cpython](https://github.com/python/cpython)、[CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) | 装配进 x64 桌面安装包、默认关闭的 Windows 桌面自动化运行时。 |

Web 组合还从 npm 固定 `@huanlin/dsh-plugin-better-sidebar-plugin-office` 0.1.2。该 AGPL-3.0 包把 DOCX、XLSX 与 PPTX 查看器注册到内置 better-sidebar 文件注册表。

## 配置与迁移

可执行代码会随仓库和 EXE 发布，本机专属状态不会进入安装包。机器人凭据、QQ 设置、cron 任务、技能文件、MCP 配置、Univer 文档、工作树与下载资源缓存仍保存在 `DSH_HOME` 或所选工作区下。机器人通过**设置 → 插件 → 连接平台**配置，生图服务渠道通过**设置 → 插件 → AI 生图**配置，技能在**设置 → 技能**中管理，MCP 服务器则在**设置 → MCP**中或通过 `dsh-panel mcp` 管理。生图 API 密钥保存在本机设置文档中，生成历史、画廊与模板缓存使用 `~/.dsh/dsh-imagegen`；参考图和提示词会发送给已配置的服务提供方。在 Windows 安装版中，机器人的「选择目录」操作使用应用内 Host 目录浏览器，不依赖 Windows 系统文件夹对话框。`dsh-im/cordis.patch.yml.example` 只作为需要显式覆盖 `qq.outboundMediaRoots` 的部署参考。

内置 Univer 配置项设置了 `telemetry: false`。Univer Office 需要通过运行时环境变量 `UNIVER_LICENSE` 提供有效的商业版 Univer Pro 许可证；产物中没有开发许可证回退值。部分 Slide 布局检查、SVG 文本测量与截图操作还需要本机 Chrome 或 Chromium；自动发现无效时可用 `UNIVER_RENDER_BROWSER` 显式指定。

Windows 桌面控制在**设置 → 插件 → Windows 桌面控制**中启用。安装后的 x64 桌面版会提供私有运行时，因此用户无需安装 Python、Windows-MCP 或另建 MCP 配置项。只会发布十三项经过审阅的可见桌面工具，而且每次调用都需要批准；PowerShell、注册表、进程、剪贴板、文件系统、通知与抓取工具保持排除。

迁移电脑时，在新机器安装 EXE 或克隆并构建仓库，再单独复制所需的 `DSH_HOME`、`~/.dsh/dsh-imagegen` 与工作区数据。不要把内置集成重复安装到生成的用户 profile；首次启动内置版本前应移除单独安装的生图或 Windows-MCP 配置项，否则重复配置项可能重复注册工具和侧边栏入口。

## 验证

真实发行组合的浏览器测试会断言所有客户端模块均进入模块图，并固定四项生图工具、Host 级 `cron_*`、`qq_send_local_file`、十三项 `univer_*` 工具与默认关闭的 Windows-MCP 设置命名空间。语音输入测试还会把浏览器录音经同一份 QQ 配置发送到本地转写服务。QQ 工作区选择测试会打开一个预置机器人的目录操作，并固定真实 Host 后端返回的应用内目录列表快照。桌面载荷门禁还会单独要求已打包依赖闭包包含生图 Host 与 Client bundle、内置模板快照与许可证；Univer Viewer、Gateway、worker、技能、商业资源 manifest 与 Windows x64 原生 binding；以及嵌入式 CPython 可执行文件、Windows-MCP 元数据和代表性的 Python 原生模块。

## 产物说明

生图压缩包是上游 npm 1.5.1 发行版的仅运行时重打包。它保留未经修改的 Host 与 Client 编译 bundle、内置 441 案例模板快照、包元数据、组合补丁、README 与 Apache-2.0 许可证；上游 50 MB 发行包中的截图、演示视频、非运行时 TypeScript 源码与 Source Map 不进入安装包。官方 npm tarball 的 SHA-256 为 `f95c6ac0099d2dc958e07efb2a4a35dd036c832db30d6e3d37fb63b916bda820`；经过审阅的运行时重打包 SHA-256 为 `dc0877229e38fbd19d716654460a0f0a4346992e37318fb8e48853f34a29ec51`。

dsh-im 压缩包包含源码与 MIT 许可证。cron 压缩包包含编译后的 `lib/`、组合补丁、README 与 MIT 许可证。技能／MCP 压缩包是上游 MIT 发行产物；仓库兼容补丁会为当前 DSH 版本更新其客户端注入项与会话查询。其 SHA-256 为 `5e8523cfea0c4ca2cf7a71600f6eaa67655258b1ddce317e5c06f0658620737a`。

Windows 运行时装配会在 `windows-mcp/runtime.json` 中按 SHA-256 固定官方 CPython 3.14.7 AMD64 嵌入式压缩包与 Windows-MCP 0.8.5 wheel；完整且仅含二进制 wheel 的闭包在 `windows-mcp/requirements.lock` 中逐项固定哈希。上游在桌面服务的一行中导入 GPL 许可的 `fuzzywuzzy`。DSH 会记录并校验 `windows-mcp/patches/use-thefuzz.patch` 的哈希，在装配时把该导入替换为兼容的 MIT `TheFuzz` API，并从载荷中排除 `fuzzywuzzy`、`Levenshtein` 与 `python-Levenshtein`。打包前必须通过真实 stdio initialize/list/`Wait` 冒烟。

Univer 压缩包从用户提供的 0.2.12 源码重新构建。该重构建移除了源码中内嵌的开发许可证回退值，并且只把运行时 `UNIVER_LICENSE` 值传给 Viewer、Gateway、渲染进程与 unit-content worker。其 SHA-256 为 `337d705ddcacd39269c8ab0c3835bb37ab5ff38f63cb775116d60ffbd5bc616a`。封装层声明 Apache-2.0，但其可执行依赖闭包含有三个外部 `@univerjs-pro/*` runtime 根包，以及构建脚本内联到产物中的 90 个分别许可的构建期模块，其中 79 个属于 `@univerjs-pro/*`，11 个属于 `@univer-cli/*`。编译后的压缩包没有携带这些模块各自的 manifest 或声明，因此生成的第三方声明会列出全部已声明包身份并固定其声明摘要。构建或分发本仓库前必须取得适当的 [Univer Pro 许可证与分发权](https://docs.univer.ai/guides/pro/license)，包括这些内联模块的授权。更新任一固定压缩包时，必须同时审阅其可执行依赖闭包、出处、许可证、本地兼容改动、原生载荷与发行组合行为。
