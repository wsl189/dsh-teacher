# @deepseek-ai/dsh-speech-qq

[English](README.md) | 中文

该插件把 `qq-config` 提供方注册到 `ctx.speech`。它读取与 `@xmanrui/dsh-im` 相同的 `integrations/dsh-qq/config.json` 文档和 `DSH_QQ_ASR_API_KEY` 凭据引用。每次录音都会重新解析二者，因此保存 QQ 设置后，下一次输入框或工作台录音无需重启 Host 即可使用新值。

提供方接受 WebM、Ogg、M4A、MP3 与 WAV，在发起网络请求前校验规范 base64 和解码后大小，再向 `<baseUrl>/audio/transcriptions` 发送 OpenAI 兼容 multipart 请求。表单包含 `file`、`model`、`language` 与 `response_format=json`；QQ key 为空时不发送 Authorization。成功响应中的 `text` 或 `transcript` 会先去除首尾空白再返回。

## 配置

| 字段 | 发行版值 | 含义 |
|---|---:|---|
| `configPath` | `<DSH_HOME>/integrations/dsh-qq/config.json` | dsh-im QQ 设置文档的绝对路径。 |
| `credentialRef` | `DSH_QQ_ASR_API_KEY` | QQ 设置界面写入的凭据引用。 |
| `timeoutMs` | `120000` | 完整上游请求截止时间。 |
| `maxAudioBytes` | `20971520` | 解码后录音大小上限。 |
| `maxResponseBytes` | `65536` | 可接受 JSON 响应大小上限。 |

QQ 设置文档必须使用 `version: 1`，并包含具有 `enabled`、`baseUrl`、`model` 与 `language` 的 `speech` 对象。Base URL 必须使用 HTTPS；本机服务可使用回环 HTTP。内嵌凭据、查询字符串、片段与重定向都会被拒绝。

## 模型体验

无，因为 QQ 配置提供方只向浏览器 Consumer 返回文本，不注册任何面向模型的表层。

#### KV 缓存影响

在用户通过普通消息路径提交编辑后的转写文本之前没有影响。

## 已知限制与暂缓事项

- **ASR 服务器仍是外部服务**：可执行文件包含该适配器，不包含 Whisper、模型权重、GPU 驱动或服务进程。
- **没有流式转写**：浏览器停止录音后才发起一次上游请求。
- **配置归 QQ 所有**：缺少有效且已启用的 dsh-im QQ 文档时会返回 `provider-disabled`；项目有意不提供第二套语音设置页。
