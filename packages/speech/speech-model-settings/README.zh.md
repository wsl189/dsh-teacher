---
description: "执行「模型」设置中所选供应商线路与语音模型的语音提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-speech-model-settings

[English](README.md) | 中文

## 概述

该插件把 `model-settings` 提供方注册到 `ctx.speech`。每次录音时，它都会读取当前**设置 → 模型 → 使用场景 → 语音识别**分配，从 `model-service-settings` 解析准确端点与协议，读取该提供方的凭据，并调用所选语音模型。因此，对话、教师工作台与 QQ 语音消息共用同一项模型选择和提供方线路。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本提供方与 `dsh-speech`、`agent-default-model`、`model-service-settings`、settings 及 credentials 一同挂载。发行适配器支持 OpenAI 兼容 multipart 转写线路和 Qwen 兼容 `input_audio` 消息线路，包括随附的智谱 `glm-asr-2512` 与 Qwen `qwen3-asr-flash` 默认值。它接受 WebM、Ogg、M4A、MP3 与 WAV，并在网络 I/O 前校验规范 base64 与解码大小上限。

### 配置

| 字段 | 发行版值 | 含义 |
|---|---:|---|
| `timeoutMs` | `120000` | 完整上游请求截止时间。 |
| `maxAudioBytes` | `26214400` | 应用模型专属更低上限前的部署级解码录音上限。 |
| `maxResponseBytes` | `65536` | 可接受 JSON 响应大小上限。 |

操作端点与模型 ID 属于 `model-service-settings`，不属于本插件的 tunable。所选提供方 profile 的 `apiKeyEnv`、匹配的 `llm-pi-ai` profile 引用，或由线路派生的凭据引用负责提供 bearer token。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每次请求都会重新加载语音分配、分类提供方线路与凭据，因此保存的变更无需重启 Host 即可影响下一次录音。分发遵循已存协议适配器，不依赖写死的提供方／模型列表。OpenAI 兼容转写线路接收 multipart `file`、`model` 与 `stream=false` 字段；Qwen 兼容线路接收对话请求中的一项 `input_audio` data URL。成功文本会去除首尾空白后返回，上游正文不会进入面向用户的诊断。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [语音运行时](../speech/README.zh.md)——提供方选择与稳定结果所有权。
- [语音子系统](../../../docs/subsystems/speech.zh.md)——共享转写类型与 Cordis 服务参考。
- [按供应商分组的模型设置](../../../.agents/notes/implemented/architecture/2026-09-01-supplier-grouped-model-settings.zh.md)——线路、模型分配与凭据所有权。

<a id="model-experience"></a>
## 模型体验

无，因为转写文本只返回 UI 或 IM Consumer，本包不注册面向模型的表层。

#### KV 缓存影响

在用户或 IM 工作流通过普通消息路径提交结果文本之前没有影响。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **适配器需要明确维护**：自定义 URL 只有搭配已安装的语音请求与响应适配器时才有效；修改 URL 不会让无关的提供方协议变得兼容。
- **没有流式转写**：录音完成后才会发起一次上游请求。
- **服务位于外部**：可执行文件包含请求适配器，不包含语音模型、模型权重、GPU 驱动或供应商服务。
- **生图使用自己的执行器**：语音与生图线路共用模型设置，但生图请求由内置生图提供方执行；本包不执行生图模型。

<a id="dev-note"></a>
### 开发备注

增加语音协议时，必须同时加入请求编码、响应解析、资源上限与聚焦测试。提供方 URL 与模型 ID 放在 `model-service-settings` 中。
