---
description: "语音包组：提供方无关的浏览器转写，以及对话和教师工作台草稿使用的 QQ 配置 OpenAI 兼容提供方。"
kind: "package-group"
---

# speech/——浏览器语音转写

[English](README.md) | 中文

## 概述

该能力族接收浏览器麦克风录音并返回规范化文本，使 UI Consumer 不需要绑定某一种转写服务。发行版 Web 组合选择 `qq-config`；对话与教师工作台 Consumer 会把受支持录音规范化为 16 kHz 单声道 PCM WAV，并把完整转写文本插入普通可编辑草稿。音频与返回文本在用户提交或保存草稿前保持临时状态。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | `ctx` key |
|---|---|---|
| [`speech/`](speech/README.zh.md) | 提供方注册、选择、稳定错误与浏览器 Remote | `ctx.speech` |
| [`speech-qq/`](speech-qq/README.zh.md) | 共享 dsh-im 实时 QQ ASR 设置的 OpenAI 兼容提供方 | 注册到 `ctx.speech` |

<a id="related-documentation"></a>
## 相关文档

- [语音子系统参考](../../docs/subsystems/speech.zh.md)——共享请求、结果、失败、提供方与生成的 Cordis 服务词汇。
- [对话 UI](../client/ui-conversation/README.zh.md)——负责麦克风入口和可编辑聊天草稿。
- [教师工作台 UI](../client/ui-teacher-workbench/README.zh.md)——负责教师记录的语音入口。

<a id="dev-note"></a>
## 开发备注

无。
