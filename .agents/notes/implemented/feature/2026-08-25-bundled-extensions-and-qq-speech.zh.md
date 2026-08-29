# Agent Note：内置扩展与 QQ 语音输入

状态：已实现

[English](2026-08-25-bundled-extensions-and-qq-speech.md) | 中文

## 问题

如果 IM、通用 cron 管理与 Office 工作区预览仍依赖 profile 本地安装插件，Windows 安装器就不能完整迁移产品。新电脑即使成功安装 EXE，也可能因为应用依赖闭包缺少这些可执行依赖而显示不同的界面与工具列表。插件的凭据、机器人会话、定时任务和用户数据具有另一种生命周期；把这些本机专属值嵌入安装器会泄露私有状态，并使安装器升级覆盖运行数据。

输入框与教师工作台语音控件也各自使用浏览器原生语音识别，没有复用 QQ 集成中可配置的 ASR 服务。这条重复路径使同一安装存在两个语音提供方、两个语言配置所有者、依赖浏览器的网络行为，并且缺少 Host 侧校验与资源上限。

## 决策

`@deepseek-ai/dsh-web-app` 直接依赖并挂载保存在 `third-party/` 下、经过审查的 `@xmanrui/dsh-im` 1.0.3 与 `dsh-plugin-cron` 0.1.3 tarball，以及已发布的 `@huanlin/dsh-plugin-better-sidebar-plugin-office` 0.1.2。Office 配置项位于内置 better-sidebar 配置项之后，因此会向现有文件预览注册表登记 DOCX、XLSX 与 PPTX 预览器。这些包属于普通 Web 生产依赖闭包，也因此属于 [Windows 桌面安装器](2026-08-25-windows-desktop-updates.zh.md)；用户无需再把它们安装到 profile。IM 配置与凭据、cron 记录、机器人路由状态及其他可变数据仍位于 `DSH_HOME` 下，因此需要迁移私有状态时，应单独复制该目录。

上游插件保留各自的运行时所有权。IM 继续持有平台连接、QQ 设置、移动通知路由与 `qq_send_local_file`；cron 继续持有通用命令调度、历史、管理界面与四项模型工具。内置只改变可用性，不改变这些职责。[移动端工作台提醒决策](2026-08-22-mobile-workbench-reminders.zh.md)仍把提醒计时器和确认保存在工作台文档中，而不镜像到 cron。[内置 better-sidebar 决策](2026-08-23-built-in-better-sidebar.zh.md)仍持有工作台挂载与去重防护；本决策明确接受 Office 扩展的 AGPL-3.0 分发义务，并在生成的第三方声明中保留它。

`@deepseek-ai/dsh-speech` 定义选择提供方的 Host 能力与带类型的 `speech.transcribe` Remote。`@deepseek-ai/dsh-speech-qq` 注册 `qq-config` 提供方。每次录音时，它都会重新读取 `integrations/dsh-qq/config.json`，并通过 credentials 服务解析 `DSH_QQ_ASR_API_KEY`，因此在 QQ 设置界面保存的变更无需重启 Host 即可影响下一次请求。适配器使用已配置的模型和语言发送一次兼容 OpenAI 的 multipart 转写请求，只返回规范化非空文本与提供方标识。QQ 集成仍是 ASR 端点、模型、语言、启用状态与凭据输入的唯一所有者；[持久教师工作台决策](2026-08-17-durable-teacher-workbench.zh.md)不再持有语音语言设置。

输入框与教师工作台控件共用一个 MediaRecorder hook。每次操作都会请求麦克风权限，收集一个完整 WebM、Ogg、MP4、MP3 或 WAV blob，并释放全部媒体轨道。随后，标准或 WebKit AudioContext 解码会在规范 base64 编码和调用 Host Remote 前，把非 WAV 录音转换为 16 kHz 单声道 PCM WAV；没有这种解码器的宿主会保留原始 MediaRecorder 容器。这样会让浏览器链路使用与 QQ 语音附件相同且兼容性更广的 WAV 输入，不再假设本地 OpenAI 兼容 ASR 实现能够解码 Chromium WebM。录制、准备或转写时会禁止冲突的提交操作，接受的文本仍可通过与键入文本相同的草稿、待办、备忘录或账本路径编辑。音频字节和提供方响应不会持久化或写入日志。

QQ 适配器只接受 HTTPS 端点与回环 HTTP。它拒绝内嵌凭据、query、fragment 与重定向，限制解码音频和响应字节，校验规范 base64、媒体类型、模型、语言、HTTP 状态与响应 JSON，并强制请求截止时间；稳定诊断不会包含提供方响应正文、凭据或音频。虽然选定的 ASR 服务会收到每条完整录音，这些检查仍让浏览器麦克风与 QQ 密钥远离第三方客户端代码。

## 考虑过的替代方案

**继续把三个插件作为 profile 安装项。** 这样可以缩小应用依赖闭包，但会让新安装的 EXE 不完整，使 profile 状态能够静默改变发行界面与工具列表，并要求每台电脑执行第二套安装流程。

**把插件配置与用户数据嵌入安装器。** 可执行代码是可复现的构建输入；token、机器人会话、cron 记录与本地工作属于可变私有状态。分发或替换这些内容会泄露凭据并使升级具有破坏性。`DSH_HOME` 继续作为这些状态的明确迁移单元。

**为应用控件保留 Web Speech API 识别。** 这会把提供方、保留策略、语言行为与可用性委托给每个浏览器，而 QQ 已经提供由运维者选择的 ASR 端点。一个 Host 能力可以让两个 UI 界面使用相同设置与校验。

**让每个浏览器组件直接调用 QQ ASR 端点。** 这会把凭据暴露给 renderer，重复 multipart 校验与上限，需要跨域访问，并让更换提供方成为 UI 修改。共享 Host Remote 集中传输，同时保持消费方与提供方无关。

**原样转发每种 MediaRecorder 容器。** OpenAI 服务接受常见浏览器容器，但兼容端点并不完全一致。QQ 语音附件本来就以 WAV 到达，因此本地服务可能可以识别机器人语音，却在浏览器 WebM/Opus 上一直等待或失败。浏览器端解码无需在安装器内增加可执行转码器，也让 Host 提供方不依赖浏览器 codec。

**把 ASR 服务、MinerU、vLLM、模型与 GPU runtime 一并放入 EXE。** 这些服务依赖部署专属的硬件、驱动、模型存储与更新策略。安装器包含其客户端与配置适配器，而不包含服务本身；服务容器与 Windows 应用仍是不同的部署单元。

## 后果

- 标准源码构建或 Windows 安装器无需 `dsh plugin add` 即可提供 IM、通用 cron 与 Office 预览；发行组合测试固定其 Host 工具与客户端模块，因此打包遗漏会在发布前失败。
- 迁移完整工作环境仍需复制有意保留的 `DSH_HOME` 状态，并准备可访问的 QQ ASR、MinerU 与模型服务。只安装 EXE 会迁移应用代码，不会迁移私有数据或 GPU 服务。
- 在支持 MediaRecorder 的浏览器中，输入框与日常管理语音输入现在保持一致。Web Audio 宿主还会在发送 Host 前缓冲解码后的 PCM 与一份 16 kHz 单声道 WAV；20 MiB 音频上限与操作截止时间限制传输录音的成本，仍不支持流式或部分转写。
- Office 预览引入 AGPL-3.0 运行时依赖。仓库与下游发行必须保留其声明并遵守许可证；为了让所需预览成为默认安装的一部分，本决策接受该后果。
- 集成依赖已发布的第三方插件接口与固定 artifact 版本。升级这些 artifact 时必须重新执行兼容性、许可证、工具列表与发行客户端审计。

## 测试

能力测试覆盖提供方选择与释放、实时读取 QQ 配置与凭据、端点限制、取消、multipart 字段、支持的媒体、大小与响应上限、HTTP 与 JSON 失败及安全诊断。客户端测试覆盖 MediaRecorder 支持与清理、SSR、PCM WAV header、立体声混合、重采样、解码器选择与清理、输入框手势与提交门控、工作台命令、可编辑转写和失败通知。一条无外部依赖的已组装 Web 场景会在输入框与日常管理中录制确定性音频，在真实浏览器 bundle 中转换，要求通过生成的 Remote 向本地 QQ 兼容 ASR 服务上传 WAV multipart，并在不调用模型的情况下固定最终 UI 快照。发行组合场景要求存在 IM 与 cron Host 工具，以及 Office、IM 与 cron 客户端模块。Windows workflow 把同一生产依赖闭包构建进 NSIS artifact。
