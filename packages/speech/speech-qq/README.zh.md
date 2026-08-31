---
description: "使用 QQ 配置的 OpenAI 兼容语音提供方：复用 dsh-im ASR 设置与凭据处理浏览器录音。"
kind: "package-reference"
---

# @deepseek-ai/dsh-speech-qq

[English](README.md) | 中文

## 概述

该插件把 `qq-config` 提供方注册到 `ctx.speech`。它读取与 `@xmanrui/dsh-im` 相同的 `integrations/dsh-qq/config.json` 文档和 `DSH_QQ_ASR_API_KEY` 凭据引用。每次录音都会重新解析二者，因此保存 QQ 设置后，下一次输入框或工作台录音无需重启 Host 即可使用新值。

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

将本提供方与 `dsh-speech` 及 dsh-im QQ 设置表层一同挂载。提供方接受 WebM、Ogg、M4A、MP3 与 WAV，在网络 I/O 前校验规范 base64 与解码大小，再向 `<baseUrl>/audio/transcriptions` 发送一次 OpenAI 兼容 multipart 请求。

### 配置

| 字段 | 发行版值 | 含义 |
|---|---:|---|
| `configPath` | `<DSH_HOME>/integrations/dsh-qq/config.json` | dsh-im QQ 设置文档的绝对路径。 |
| `credentialRef` | `DSH_QQ_ASR_API_KEY` | QQ 设置界面写入的凭据引用。 |
| `timeoutMs` | `120000` | 完整上游请求截止时间。 |
| `maxAudioBytes` | `20971520` | 解码后录音大小上限。 |
| `maxResponseBytes` | `65536` | 可接受 JSON 响应大小上限。 |

QQ 设置文档必须使用 `version: 1`，并包含具有 `enabled`、`baseUrl`、`model` 与 `language` 的 `speech` 对象。Base URL 必须使用 HTTPS；本机服务可使用回环 HTTP。内嵌凭据、查询字符串、片段与重定向都会被拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每次请求都会重新加载 QQ 文档与凭据引用、校验端点，并提交 `file`、`model`、`language` 与 `response_format=json`；key 为空时省略 Authorization。成功响应中的 `text` 或 `transcript` 会去除首尾空白后返回，上游诊断不会进入提供方结果。传输失败返回 `provider-unavailable`；重定向、非成功 HTTP 状态或无效配置返回 `provider-failure`，因此浏览器 Consumer 能区分连接失败与服务地址、模型或 API key 导致的请求拒绝。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [语音运行时](../speech/README.zh.md)——提供方选择与稳定结果所有权。
- [语音子系统](../../../docs/subsystems/speech.zh.md)——共享转写类型与 Cordis 服务参考。
- [捆绑扩展与 QQ 语音](../../../.agents/notes/implemented/feature/2026-08-25-bundled-extensions-and-qq-speech.zh.md)——发行版集成与配置所有权。

<a id="model-experience"></a>
## 模型体验

无，因为 QQ 配置提供方只向浏览器 Consumer 返回文本，不注册任何面向模型的表层。

#### KV 缓存影响

在用户通过普通消息路径提交编辑后的转写文本之前没有影响。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **ASR 服务器仍是外部服务**：可执行文件包含该适配器，不包含 Whisper、模型权重、GPU 驱动或服务进程。
- **模型选择是显式配置**：`speech.model` 必须命名已配置服务能够提供的模型；适配器不会推断或重试另一个模型。
- **没有流式转写**：浏览器停止录音后才发起一次上游请求。
- **配置归 QQ 所有**：缺少有效且已启用的 dsh-im QQ 文档时会返回 `provider-disabled`；项目有意不提供第二套语音设置页。

<a id="dev-note"></a>
### 开发备注

QQ 配置所有权保留在 dsh-im；本适配器只校验并消费其公开 ASR 设置。
