# Agent Note：精选供应商预设与官方图标

Status: implemented

[English](2026-09-09-curated-provider-presets.md) | 中文

## 问题

添加目录在产品预设旁列出了全部已安装适配器 ID，包含重复的供应商身份，以及没有维护默认配置的国外服务。OpenRouter 和 OpenCode Go 缺少完整请求地址，已保存连接也缺少可识别的供应商图标。

## 决策

添加目录包含五家国内供应商、OpenRouter 和 OpenCode Go，并提供一个自定义服务入口。已保存线路保留配置及编辑操作。这缩小了[连接自动验证决策](2026-09-09-automatic-model-connection-verification.zh.md)中描述的添加目录，但不改变适配器可用范围。

OpenRouter 提供四种模型类型。对话和视觉共用 Chat Completions，图像生成使用独立的 Images API，语音识别使用兼容 multipart 的转写端点。能力预设保存精确请求地址和受支持的模型 ID。已安装的图像消费者支持通过该地址执行文生图，编辑器明确提示图像编辑不可用。

OpenCode Go 按模型继承已安装适配器目录中的协议和 Base URL。统一的线路默认值会把 Messages 或 Responses 模型发往错误端点。编辑器在自动模式下展示三个官方完整地址，切换协议时清除待保存的 LLM 地址草稿。官方 Go 目录未公布生图或语音识别线路，因此只提供对话和视觉类型。

官方图标以 data URL 形式随来源信息打包，设置页面不依赖远程图片。预设 ID 决定供应商品牌；可识别的自定义 ID 或完整显示名称也能匹配图标，包括 Ollama。未知服务显示中性首字标识，避免使用无关品牌图标。

## 来源

- [OpenRouter 视觉理解](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding)、[图像生成](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)及[语音识别 API 与 multipart 兼容性](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/)已于 2026-09-09 核对。
- [OpenCode Go 端点](https://opencode.ai/docs/go/#endpoints)与已安装的 pi-ai 供应商目录共同确定逐模型协议默认值。
- [OpenRouter 官方素材](https://github.com/OpenRouterTeam/sign-in-with-openrouter)按 MIT 许可提供当前标志；其他图标取自供应商官方网站图标。精确素材地址附在内置源码中。

## 考虑过的替代方案

- 保留原始适配器目录会重新产生重复且缺少维护的配置选项。
- 给全部 Go 模型统一覆盖 Chat Completions 会丢弃供应商持有的传输元数据。
- 热链图标会让本地配置页面依赖外部网站可用性。

## 影响

组件和浏览器用例覆盖精选目录、已保存线路保留、全部已提供类型的完整地址、Go 自动配置、过期草稿清理、媒体线路保存，以及离线图片解码。能力消费者测试以替代 HTTP 响应覆盖 OpenRouter 生图及 multipart 转写请求，不证明真实账户的接口可用性。
