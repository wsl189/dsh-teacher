---
description: "提供方无关的语音转写运行时与 Typert Remote：把完整浏览器录音转换为临时可编辑文本。"
kind: "package-reference"
---

# @deepseek-ai/dsh-speech

[English](README.md) | 中文

## 概述

提供方无关的语音转写运行时与 Typert Remote。`ctx.speech.registerProvider()` 管理提供方生命周期，`provider` 配置可显式选择一个 id；未显式配置时，必须恰好只有一个提供方报告可用。浏览器调用返回冻结的可辨识联合结果；提供方异常会被收敛为稳定错误码，不会暴露凭据、音频或上游响应正文。

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

将本 Service Definition 与一个或多个转写提供方一同挂载。`speech.transcribe` 携带浏览器媒体类型与规范 base64 字节；同进程 Consumer 可用 `transcribeAbortable` 转发取消信号。提供方负责校验传输字段，并返回一份非空文本和稳定提供方 id。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每次录音都会重新选择提供方，预期内的请求或提供方失败以稳定可辨识数据返回。运行时不保留音频或文本；浏览器 Consumer 负责草稿生命周期。准确请求与结果声明位于 [`src/types.ts`](src/types.ts)。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [语音子系统参考](../../../docs/subsystems/speech.zh.md)——共享请求、结果、失败、提供方与生成的 Cordis 服务词汇。
- [QQ 配置提供方](../speech-qq/README.zh.md)——发行版 OpenAI 兼容提供方。
- [对话 UI](../../client/ui-conversation/README.zh.md)——麦克风入口与可编辑草稿 Consumer。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器转写结果仍是用户持有的草稿文本，本包不注册任何面向模型的表层。

#### KV 缓存影响

在用户通过普通消息路径提交编辑后的草稿之前没有影响。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **只处理完整录音**：Remote 不流式传输局部转写或音频分块。
- **只选择一个提供方**：自动选择遇到零个或多个可用提供方时会拒绝，不使用隐式优先级。
- **不持久化音频**：该能力不保存录音或转写文本，各 Consumer 管理自己的草稿生命周期。

<a id="dev-note"></a>
### 开发备注

录音与转写文本在本包中保持临时状态；只有 Consumer 接受编辑后草稿时才开始持久化。
