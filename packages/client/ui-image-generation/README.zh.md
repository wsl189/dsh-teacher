---
description: "dsh Web 客户端的最终回答图片预览：把内置生图工具结果投影为独立 Conversation 节点，同时保留提供方的 Tool 卡片与工作室集成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-image-generation

[English](README.md) | 中文

## 概述

本包让生成的图片持续显示在 dsh Web 对话的最终回答旁，并可直接操作。它把内置生图工具中经过验证的图片引用按 Turn 汇总为一个独立 Chat 节点。点击图片会打开支持鼠标滚轮缩放的页内预览，鼠标悬浮或键盘聚焦则显示保存控件，把已加载图片交给系统“另存为”选择器。该节点位于紧凑过程折叠之外，现有 Tool 卡片则继续向图片工作室输送数据。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

随附的 Web bundle 会把本包与 `@dickpy/dsh-imagegen` 一起挂载。完成的 `generate_image`、`edit_image` 或 `get_image_generation_task` 结果会把其中不重复的图片贡献到该 Turn 的最终回答区域。

### 预览位置

预览出现在最新图片结果之后的 Assistant 消息之后、Turn 页脚之前。生成期间，它可以先出现在最新结果位置；下一条 Assistant 消息会把同一个节点移到回答边界。展开过程时也可能看到提供方拥有的 Tool 预览，因为本包不会替换它。

### 预览、保存与恢复

每张卡片都经 `/api/dsh-imagegen/agent-image` 加载不可变图片，并在卡片离开页面时撤销浏览器 object URL。点击卡片会打开视口预览；非零垂直滚轮手势可在 1× 至 8× 之间缩放，图片放大到超出视口后仍可滚动查看。卡片右上角的保存控件在悬浮或聚焦时出现，在粗指针设备上保持显示，并通过安全上下文的系统选择器写入已加载 Blob。不支持该选择器的浏览器会使用标准下载，用户取消时保持安静，写入失败时显示可重试的本地化错误。图片请求失败时会显示本地化重试按钮，同一 Turn 中的其他图片仍会独立加载。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

一个 `ConversationNodeDefinition` 会累积已识别生图 Tool 的 call id，并验证每个 append-origin `tool/result.meta.images` 值中的 snake-case 引用。结果会清除更早的 Assistant 锚点；只有后续 `assistant/message` 才能把节点锚定到回答。没有后续回答时以 Turn end 作为回退；Turn 仍打开时以最新结果序号作为实时回退。

keyed `image-generation-result` renderer 使用现有 `conversation` 图片文案和提供方的 Host 路由。预览缩放与保存进度属于组件本地状态；保存会复用已获取的 Blob，不会授权再次读取。本包不会在运行时导入另一个 Client 功能、修改 Session 事件、授权通用附件读取、抑制 Tool 视图或分发图片工作室状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖对话引擎、Chat target、Tool 展示与内置提供方。

- [Conversation 子系统](../../../docs/subsystems/conversation.zh.md)——业务自有 Definition 与最终 view node。
- [ui-chat](../ui-chat/README.zh.md)——排序、紧凑过程折叠与 keyed renderer slot。
- [ui-tool](../ui-tool/README.zh.md)——与本节点并存、由提供方拥有的 Tool 卡片。
- [Web app bundle](../../bundle/web-app/README.zh.md)——同时挂载两个插件的随附组合。

-----

<a id="model-experience"></a>
## 模型体验

无。该包只在浏览器中展示已有的生图结果元数据，不注册模型可见输入。

#### KV Cache 影响

无；该包既不改变 Session surface，也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定最终回答预览的提供方兼容范围与操作能力。

- **元数据适配器面向特定提供方**：只有与 `generate_image`、`edit_image` 或 `get_image_generation_task` 关联、来自 append-origin 且包含有效 `meta.images` 引用的结果才会生成节点。
- **历史分页遵循 Conversation 起始事件所有权**：只有 update 的已加载窗口会保持 pending，直至更早页面提供该 Turn 的 `turn/start` 事件。
- **字节读取器归内置提供方所有**：移除或更改 `/api/dsh-imagegen/agent-image` 后，持久节点仍然存在，但每张卡片都会进入重试状态。
- **最终卡片不是图片工作室**：它只拥有预览缩放与保存；复制、编辑、图库与任务控制仍位于提供方拥有的 Tool 卡片和工作室中，因此展开过程时可能同时看到两处预览。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
