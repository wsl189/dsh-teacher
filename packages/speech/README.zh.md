# speech/——浏览器语音转写

[English](README.md) | 中文

该能力族接收浏览器麦克风录音并返回规范化文本，使 UI Consumer 不需要绑定到某一种转写服务。

| 包 | 角色 | `ctx` key |
|---|---|---|
| [`speech/`](speech/README.zh.md) | 提供方注册、选择、稳定错误与浏览器 Remote | `ctx.speech` |
| [`speech-qq/`](speech-qq/README.zh.md) | 共享 dsh-im 实时 QQ ASR 设置的 OpenAI 兼容提供方 | 注册到 `ctx.speech` |

发行版 Web 组合选择 `qq-config`。对话输入框与教师工作台通过 `MediaRecorder` 录音，将一次完整录音发送到生成的 Remote，再把返回文本放进各自可编辑的普通草稿字段。
