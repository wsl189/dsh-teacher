---
description: "供“模型”设置与能力专属 Consumer 共用的分类供应商请求线路和模型目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-service-settings

[English](README.md) | 中文

## 概述

该插件注册 `model-service-settings` namespace。每个供应商都可以提供四种固定模型类型中的任意类型——对话／推理、视觉理解、语音识别与图像生成——并为其保存完整请求地址、已安装的协议适配器和可编辑模型目录。“模型”设置写入该 namespace；使用场景选择器与运行时 Consumer 读取同一份解析后线路。

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

将该插件与设置提供方一同挂载，然后在 `providers` 下提供组合默认值，或由“模型”页面创建用户覆盖。一个供应商 profile 持有一项凭据引用，以及可选的 `chat`、`vision`、`speech` 和 `image` 线路。每条线路保存完整操作 URL、协议适配器 ID 与一个或多个模型 ID；可选显示名称只影响呈现。

完整 URL 必须使用 HTTPS；本地部署可以使用回环 HTTP。内嵌凭据、查询字符串与片段都会被拒绝。协议还会与模型类型交叉校验，因此图像生成序列化器不能分配给语音识别线路。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包持有可序列化 schema 与关系校验器。`findModelServiceRoute` 按准确的供应商、模型 ID 和类型为能力 Consumer 解析线路；它不会从供应商基础地址或 LLM 协议推断操作端点。invariant companion 有意为空，因为 namespace 校验会在每次设置提交前运行。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [设置包映射](../README.zh.md)——设置 namespace 与存储角色。
- [语音模型设置提供方](../../speech/speech-model-settings/README.zh.md)——运行所选语音线路。
- [按供应商分组的模型设置](../../../.agents/notes/implemented/architecture/2026-09-01-supplier-grouped-model-settings.zh.md)——UI 与持久化所有权。

<a id="model-experience"></a>
## 模型体验

间接，通过能力 Consumer；所选线路是否产生面向模型的内容由各 Consumer 持有。

#### KV 缓存影响

无直接影响。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **仅支持已安装适配器**：自定义完整 URL 只改变目标地址，不改变请求或响应格式；其协议必须匹配已安装适配器。
- **不发现端点**：供应商默认值来自组合预设，自定义线路必须明确填写完整 URL。
- **凭据按供应商共享**：一个供应商 profile 的所有分类线路共用一项凭据引用。

<a id="dev-note"></a>
### 开发备注

增加协议时，必须同时提供类型归属、请求 Consumer、响应解析与聚焦测试。供应商默认值放在组合中，不要写进 namespace 校验器。
