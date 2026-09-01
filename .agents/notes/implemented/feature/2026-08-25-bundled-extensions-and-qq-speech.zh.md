# Agent Note：内置扩展、AnySearch、生图、PPT Master、Univer Office 与 QQ 语音输入

状态：已实现

[English](2026-08-25-bundled-extensions-and-qq-speech.md) | 中文

## 问题

如果 AI 生图、IM、通用 cron 管理、技能与 MCP 管理、Office 工作区预览、Univer 创作及产品演示文稿工作流仍依赖 profile 本地安装，Windows 安装器就不能完整迁移产品。新电脑即使成功安装 EXE，也可能因为应用依赖闭包缺少这些可执行依赖与资源而显示不同的界面、工具列表或 skill 目录。插件凭据、机器人会话、定时任务、用户 skill 文件、MCP 配置、生图历史、画廊、Univer 文档与工作树具有另一种生命周期；把这些本机专属值嵌入安装器会泄露私有状态，并使安装器升级覆盖运行数据。

输入框与教师工作台语音控件也各自使用浏览器原生语音识别，没有复用 QQ 集成中可配置的 ASR 服务。这条重复路径使同一安装存在两个语音提供方、两个语言配置所有者、依赖浏览器的网络行为，并且缺少 Host 侧校验与资源上限。

## 决策

Web 与桌面组合包含从用户提供的源码构建、固定在 `third-party/` 下的 MIT `@anysearch/anysearch-dsh` 0.1.4 产物。它为 `web_search` 与 `web_fetch` 选择 AnySearch，base、headless 与 SDK 的默认值保持不变。Web patch 会禁用继承的 `web-search-deepseek` 配置项，因此 Web 与桌面版不会注册一个未使用的第二搜索提供方，也不会暴露其 settings 分节。插件的三项高级工具全局注册；经过审阅的兼容补丁移除其全局 `web_fetch` 回退注册，使各会话 preset 继续持有标准工具的可用性与指导。限定范围的 peer 覆盖让经过测试的 workspace 服务保持为唯一实现。「网页搜索」设置卡经由 DSH credential store 写入可选凭据，并经由 `web-search-anysearch` settings 分节写入服务地址；客户端会为每次操作对两者取一次快照。每次操作都会解析可选的 `ANYSEARCH_API_KEY`；缺失时使用匿名远程访问，不代表离线服务或安装器自动申请账户。查询与正文提取 URL 会离开本机并发往配置端点，该端点的配额与认证失败会直接显示，不会自动切换提供方。

`@deepseek-ai/dsh-web-app` 直接依赖并挂载保存在 `third-party/` 下、经过审查的 `@dickpy/dsh-imagegen` 1.5.1 运行时重打包、`@xmanrui/dsh-im` 1.0.3、`dsh-plugin-cron` 0.1.3、`dsh-skill-mcp-panel` 2.0.1 与 `dsh-univer-office` 0.2.12 DSH 重构建版 tarball，以及已发布的 `@huanlin/dsh-plugin-better-sidebar-plugin-office` 0.1.2。生图插件提供浏览器工作室与四项 Host 工具；预览包配置项位于内置 better-sidebar 配置项之后，因此会向现有文件预览注册表登记 DOCX、XLSX 与 PPTX 预览器；Univer 则另外提供 agent 编辑工具、内置技能、Gateway、Viewer 与对话审阅卡片。这些包属于普通 Web 生产依赖闭包，也因此属于 [Windows 桌面安装器](2026-08-25-windows-desktop-updates.zh.md)；用户无需再把它们安装到 profile。生图服务配置与密钥、IM 配置与凭据、cron 记录、机器人路由状态、技能文件、MCP 配置、Univer 内容、工作树、资源缓存及其他可变数据均留在可执行依赖闭包之外，因此需要迁移这些状态时，应单独复制。生图设置使用本机设置文档，历史、画廊与模板缓存则位于 `~/.dsh/dsh-imagegen`。

同一 Web 组合会挂载 `@deepseek-ai/dsh-skill-ppt-master`，即上游 PPT Master 6.1.0 skill 的不可变提供方。该包保留完整上游目录，包括脚本、参考资料、布局、图片、声音、许可证、赞助记录、依赖声明与完整性门禁，并从已安装包派生 `path` 与 `resourceBase`，而不是把资源复制到 `DSH_HOME`。因此源码构建与桌面 EXE 都会从相同的包相对布局加载一个固定的 `bundled` 目录条目。安装器不会创建 Python 环境或安装工作流专用软件包；运维者需要提供兼容的 `python3` 运行时和所选 PPT Master 路由要求的依赖。

生图产物是上游 npm 1.5.1 发行版的仅运行时重打包。它保留未经修改的 Host 与 Client 编译 bundle、441 案例模板快照、包元数据、组合补丁、README 与 Apache-2.0 许可证，同时移除非运行时截图、演示视频、TypeScript 源码与 Source Map。仓库兼容补丁以顺序值 `-10` 把安装后的 Client 卡片注册到 `settings.models.specialized-model`，将其命名为**生图模型**并保持默认收起，直至用户点击，同时把 Host 与 Client 配置指引更新为**设置 → 模型 → 生图模型**；它不再注册 `settings.plugin.item`。其设置界面仍会把 API 密钥记录在本机设置文档中。生成请求会把提示词与参考图发送给已配置的 OpenAI 兼容服务，安装器不包含该服务或模型。技能／MCP 发行产物会应用仓库补丁，把已过时的客户端注入项与会话查询替换为当前 DSH 版本的 renderer 与 session-controller API。Univer 产物从用户提供的 0.2.12 源码重新构建：内嵌开发许可证回退值为空，只有应用环境中的 `UNIVER_LICENSE` 会传给 Viewer、Gateway、渲染进程与 unit-content worker。发行 Univer 配置项设置了 `telemetry: false`。其 Viewer 资源、进程、技能、资源 manifest 与 Windows x64 原生 binding 仍作为普通生产依赖，使桌面载荷门禁能够显式要求这些文件。Univer 封装层采用 Apache-2.0，而其可执行依赖闭包含有三个外部 `@univerjs-pro/*` runtime 根包，以及构建脚本内联的 90 个分别许可的模块，其中 79 个属于 `@univerjs-pro/*`，11 个属于 `@univer-cli/*`。编译后的压缩包既不包含这些模块各自的 manifest，也不包含它们的声明。生成的第三方声明会列出已声明包身份、固定构建期声明摘要，并在摘要变化时要求重新审阅。有效商业许可证与适当的生产和分发权必须覆盖该闭包。执行浏览器渲染的 Slide 操作仍把 Chrome 或 Chromium 作为外部前置条件，并可通过 `UNIVER_RENDER_BROWSER` 指定。

上游插件保留各自的运行时所有权。生图插件持有服务渠道、模型目录、生成请求、历史、画廊、模板、四项模型工具与 `/edit_image`；IM 继续持有平台连接、QQ 设置、移动通知路由与 `qq_send_local_file`；cron 继续持有通用命令调度、历史、管理界面与四项模型工具；技能／MCP 面板持有技能文件操作、CLI 与所选 profile patch 中的受管 MCP 区块；Univer 持有其十三项工具与审阅生命周期。内置只改变可用性，不改变这些职责。[移动端工作台提醒决策](2026-08-22-mobile-workbench-reminders.zh.md)仍把提醒计时器和确认保存在工作台文档中，而不镜像到 cron。[内置 better-sidebar 决策](2026-08-23-built-in-better-sidebar.zh.md)仍持有工作台挂载与去重防护；本决策同时接受 Office 查看器的 AGPL-3.0 分发义务与独立的 Univer 商业 runtime 义务，并在生成的第三方声明中保留它们。

`@deepseek-ai/dsh-speech` 定义选择提供方的 Host 能力与带类型的 `speech.transcribe` Remote。`@deepseek-ai/dsh-speech-qq` 注册 `qq-config` 提供方。每次录音时，它都会重新读取 `integrations/dsh-qq/config.json`，并通过 credentials 服务解析 `DSH_QQ_ASR_API_KEY`，因此在**设置 → 模型 → 语音模型**中保存的变更无需重启 Host 即可影响下一次请求。内置 IM 客户端通过 `settings.models.specialized-model` 在工具模型正下方注册该默认收起的卡片，并且不再于连接平台 → QQ 中渲染 ASR 字段。适配器使用已配置的模型和语言发送一次兼容 OpenAI 的 multipart 转写请求，只返回规范化非空文本与提供方标识。dsh-im 仍是 ASR 端点、模型、语言、启用状态、凭据输入与持久化的唯一所有者；[持久教师工作台决策](2026-08-17-durable-teacher-workbench.zh.md)不再持有语音语言设置。

输入框与教师工作台控件共用一个 MediaRecorder hook。每次操作都会请求麦克风权限，收集一个完整 WebM、Ogg、MP4、MP3 或 WAV blob，并释放全部媒体轨道。随后，标准或 WebKit AudioContext 解码会在规范 base64 编码和调用 Host Remote 前，把非 WAV 录音转换为 16 kHz 单声道 PCM WAV；没有这种解码器的宿主会保留原始 MediaRecorder 容器。这样会让浏览器链路使用与 QQ 语音附件相同且兼容性更广的 WAV 输入，不再假设本地 OpenAI 兼容 ASR 实现能够解码 Chromium WebM。录制、准备或转写时会禁止冲突的提交操作，接受的文本仍可通过与键入文本相同的草稿、待办、备忘录或账本路径编辑。音频字节和提供方响应不会持久化或写入日志。

QQ 适配器只接受 HTTPS 端点与回环 HTTP。它拒绝内嵌凭据、query、fragment 与重定向，限制解码音频和响应字节，校验规范 base64、媒体类型、模型、语言、HTTP 状态与响应 JSON，并强制请求截止时间；稳定诊断不会包含提供方响应正文、凭据或音频。传输失败返回 `provider-unavailable`，无效设置、重定向与非成功 HTTP 状态返回 `provider-failure`；两个浏览器 Consumer 都把后者显示为请求或设置失败，而不是网络故障。虽然选定的 ASR 服务会收到每条完整录音，这些检查仍让浏览器麦克风与 QQ 密钥远离第三方客户端代码。

## 考虑过的替代方案

**继续把内置扩展与 PPT Master 作为 profile 安装项。** 这样可以缩小应用依赖闭包，但会让新安装的 EXE 不完整，使 profile 状态能够静默改变发行界面、工具列表与 skill 目录，并要求每台电脑执行第二套安装流程。

**把模型页普通提供方列表中的图像输入能力视为生图能力。** 该注册表描述对话模型输入，并不会注册生成协议、服务渠道、生图工具、画廊或结果 renderer。专用的生图模型卡片会展示插件持有的配置，而不会从 LLM 提供方行推断这些操作。

**只分发 PPT Master 的 `SKILL.md`。** 它的各条路由依赖随包脚本、参考资料、模板与媒体，而归属门禁要求完整的官方归属文件和执行门禁集合。仅复制正文会发布一个只要按自身资源路径执行就会失败的工作流。

**首次启动时把 PPT Master 复制到 `DSH_HOME`。** 启动时复制会把版本化应用资源变成可变用户状态，并在用户编辑、升级与重新安装之间产生所有权冲突。包提供方让发行资源保持不可变，并把 `DSH_HOME` 留给用户持有的 skill 与配置。

**把插件配置与用户数据嵌入安装器。** 可执行代码是可复现的构建输入；token、机器人会话、cron 记录与本地工作属于可变私有状态。分发或替换这些内容会泄露凭据并使升级具有破坏性。`DSH_HOME` 继续作为这些状态的明确迁移单元。

**为应用控件保留 Web Speech API 识别。** 这会把提供方、保留策略、语言行为与可用性委托给每个浏览器，而 QQ 已经提供由运维者选择的 ASR 端点。一个 Host 能力可以让两个 UI 界面使用相同设置与校验。

**让每个浏览器组件直接调用 QQ ASR 端点。** 这会把凭据暴露给 renderer，重复 multipart 校验与上限，需要跨域访问，并让更换提供方成为 UI 修改。共享 Host Remote 集中传输，同时保持消费方与提供方无关。

**把 ASR 配置保留在连接平台 → QQ 中。** 这个位置符合其持久化实现，但会把 QQ、输入框与日常管理共享的模型隐藏在一个机器人页面里。语音模型卡片能显示其产品级作用，同时不改变持久化文档、凭据引用或 Host Remote。

**原样转发每种 MediaRecorder 容器。** OpenAI 服务接受常见浏览器容器，但兼容端点并不完全一致。QQ 语音附件本来就以 WAV 到达，因此本地服务可能可以识别机器人语音，却在浏览器 WebM/Opus 上一直等待或失败。浏览器端解码无需在安装器内增加可执行转码器，也让 Host 提供方不依赖浏览器 codec。

**推断或重试另一个 ASR 模型。** OpenAI 兼容的模型列表响应并不统一标识语音模型，选择另一个模型还会覆盖由运维者持有的 QQ 设置。适配器只发送一次已配置模型，并报告被拒绝的请求，使运维者能够显式选择已安装模型。

**把 ASR 服务、MinerU、vLLM、模型与 GPU runtime 一并放入 EXE。** 这些服务依赖部署专属的硬件、驱动、模型存储与更新策略。安装器包含其客户端与配置适配器，而不包含服务本身；服务容器与 Windows 应用仍是不同的部署单元。

## 后果

- 标准 Web 源码构建或 Windows 安装器无需 `dsh plugin add` 即可提供 AI 生图工作室、四项生图工具、IM、通用 cron、技能／MCP 管理、Office 预览、Univer 创作与完整 `ppt-master` skill；发行组合测试固定其 Host 工具、全部六个客户端模块与随包 skill 条目，因此组合遗漏会在发布前失败。
- PPT Master 由 12,939 个文件、79,496,215 个逻辑字节组成的资源树会增加应用依赖闭包与安装器输入。安装器压缩可以减小 artifact，但发布存储与 Windows 解压仍需处理完整资源树。
- 安装后可以立即加载 PPT Master 指令。执行具体路由仍需外部兼容 Python 运行时，以及该路由选中的可选软件包或可执行程序。
- 迁移完整工作环境仍需复制有意保留的 `DSH_HOME` 状态与 `~/.dsh/dsh-imagegen`，并准备可访问的生图、QQ ASR、MinerU 与模型服务。只安装 EXE 会迁移应用代码，不会迁移私有数据或 GPU 服务。
- 模型页会在工具模型正下方显示默认收起的生图模型卡片，随后显示默认收起的语音模型卡片。前者展示插件的渠道、模型、端点、密钥、提示词增强与开关设置；插件页不再重复该卡片。连接平台 → QQ 保留机器人与工作区设置，但不再重复 ASR 表单；已有生图与语音配置仍从原存储位置读取。
- 在支持 MediaRecorder 的浏览器中，输入框与日常管理语音输入保持一致。Web Audio 宿主还会在发送 Host 前缓冲解码后的 PCM 与一份 16 kHz 单声道 WAV；20 MiB 音频上限与操作截止时间限制传输录音的成本，仍不支持流式或部分转写。
- QQ 平台转写文本可以在不访问已配置 ASR 服务的情况下满足机器人语音消息。浏览器麦克风输入是直接端点检查；已配置模型不可用时会显示设置或请求提示，而不是网络提示。
- Office 预览引入 AGPL-3.0 运行时依赖。仓库与下游发行必须保留其声明并遵守许可证；为了让所需预览成为默认安装的一部分，本决策接受该后果。
- Univer Office 的授权部署与浏览器渲染 Slide 操作仍分别以商业分发权和本机 Chrome／Chromium 为前置条件。[Viewer 试用决策](../bug-fix/2026-09-01-univer-viewer-evaluation.zh.md)允许在未设置 `UNIVER_LICENSE` 时按上游限制启动。安装器不包含许可证值或浏览器可执行文件，内置组合会关闭 Univer 遥测。
- 集成依赖已发布的第三方插件接口与固定 artifact 版本。升级这些 artifact 时必须重新执行兼容性、许可证、工具列表与发行客户端审计。

## 测试

AnySearch 集成测试针对本地 HTTP fixture 启动真实发行 Web Loader 组合，要求存在 AnySearch settings 命名空间且继承的 DeepSeek 搜索命名空间不存在，然后覆盖匿名搜索与正文提取、两类能力目录、高级搜索、服务地址与凭据引用的实时 settings 变更、无效密钥处理、配额与限流下的批量部分成功，以及携带凭据的重定向。「插件」页浏览器场景会把密钥存入 credentials 而不暴露在 settings 文档中，并在重新打开卡片后确认已配置状态。已记录的 Web 搜索会话使用真实 AnySearch 提供方，固定持久化且限制数量的来源列表与浏览器卡片，并且无需 API 密钥即可回放。载荷测试逐项拒绝 AnySearch 运行文件缺失；发布检查仅接受已审阅的压缩包路径。固定压缩包前还会运行所提供源码自带的类型检查、测试、构建与包内容检查。

能力测试覆盖提供方选择与释放、实时读取 QQ 配置与凭据、端点限制、取消、multipart 字段、支持的媒体、大小与响应上限、传输与 HTTP 失败分类、JSON 失败及安全诊断。客户端测试覆盖 MediaRecorder 支持与清理、SSR、PCM WAV header、立体声混合、重采样、解码器选择与清理、输入框手势与提交门控、工作台命令、可编辑转写，以及不同的连接失败与请求拒绝通知。模型页浏览器场景要求默认收起的生图模型卡片位于工具模型下方，语音模型卡片位于其后；场景会展开前者并要求存在渠道控件，再通过后者保存全部 ASR 字段与凭据，并确认持久化语音文档不含密钥。插件页浏览器场景确认生图配置不再出现，QQ 工作区场景则确认连接平台 → QQ 中不再存在语音字段。一条无外部依赖的已组装 Web 场景会在输入框与日常管理中录制确定性音频，在真实浏览器 bundle 中转换，要求通过生成的 Remote 向本地 QQ 兼容 ASR 服务上传 WAV multipart，并在不调用模型的情况下固定成功转写与模型拒绝提示。PPT Master 包测试会加载真实提供方，并固定上游版本、许可证摘要、完整性门禁标记、文件数量与逻辑字节数。发行组合场景要求存在四项生图工具、IM 与 cron Host 工具、全部十三项 Univer 工具、六个内置客户端模块，以及可加载的 `ppt-master` 目录条目。桌面载荷测试要求生图 Host 与 Client bundle、模板快照与许可证、技能／MCP 包、PPT Master 完整分发各类资源的代表文件，以及 Univer Viewer、Gateway、worker、技能、商业资源与 Windows x64 原生 binding，之后 Windows workflow 才会把同一生产依赖闭包构建进 NSIS artifact。
