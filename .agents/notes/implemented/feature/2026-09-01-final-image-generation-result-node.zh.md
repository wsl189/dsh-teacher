# Agent Note: 最终生图结果节点

Status: implemented

[English](2026-09-01-final-image-generation-result-node.md) | 中文

## 问题

内置生图 Client 会在 Tool 视图内渲染生成图片。紧凑文本记录会把该视图折叠进 Turn 过程，因此即使持久 Tool 结果仍引用生成产物，最终对话也可能只保留 Assistant 的简短完成文字。移动预览时必须保留提供方对图片工作室的分发，并且不得把仅用于展示的引用复制到模型可见消息中。

## 决策

`@deepseek-ai/dsh-client-ui-image-generation` 在随附 Web 组合中拥有独立的 `image-generation-result` Chat 节点。每个 Turn 对应一个从 `turn/start` 开始的 Conversation Context，只接受已识别的 `generate_image`、`edit_image` 与 `get_image_generation_task` 调用，按 call id 关联其 append-origin Tool 结果，验证 `meta.images`，并按首次出现顺序去重附件。只有 update 的历史窗口会保持 pending，直至分页提供该起始事件。

每个获准图片结果都会清除先前的回答锚点。后续 append-origin Assistant 消息成为节点的回答锚点；Turn end 是已关闭 Turn 的回退，最新结果序号是实时回退。回答锚点等于 Assistant 序号，因此稳定 Chat 排序会把独立图片节点放在回答之后、合成 Turn tail 之前。紧凑过程成员不包含位于回答边界或其后的节点。

renderer 经内置提供方仅限 loopback 的 `/api/dsh-imagegen/agent-image` 路由读取字节，并使用 `conversation` 图片字典。点击缩略图会打开经 body portal 渲染的预览，其非 passive 滚轮监听器可在 1× 至 8× 之间缩放图片；放大后的像素会扩展可滚动舞台，而不会改变文本记录布局。右上角保存控件在悬浮或键盘聚焦时出现，在粗指针设备上保持显示，并把已加载 Blob 交给 `showSaveFilePicker`；不支持该 API 的浏览器会回退到 anchor 下载，用户取消选择器时保持安静，写入失败时则在当前视图保留可重试错误。提供方的 Tool 视图保持注册，因为它拥有图片工作室分发与提供方操作。本包只改变 Client 展示：它不新增 Session 事件、surface 内容、附件授权、prompt、Tool schema 或模型请求。

[内置扩展决策](./2026-08-25-bundled-extensions-and-qq-speech.zh.md)继续拥有提供方打包与运行时职责。[Conversation 装配决策](../architecture/2026-08-09-client-conversation-node-assembly.zh.md)继续拥有 Definition 生命周期、排序与 keyed 渲染。这两份记录都未被本展示适配器取代。

## 考虑过的替代方案

**修改内置提供方 Client，用独立节点替换其 Tool 视图。** 未采用，因为 Tool 视图还会把生成图片分发给工作室。重新打包会把提供方维护与应用文本记录策略结合起来，并会让展开过程失去现有操作。

**让 `ui-chat` 或 `ui-tool` 提升任何携带图片的 Tool 结果。** 未采用，因为 `meta.images` 是提供方展示词汇，不是通用 Session 事件契约。核心功能包不得根据一个供应方的元数据推断业务节点。

**把生成引用附加到最终 Assistant 消息或新的 Session 事件。** 未采用，因为图片已经有持久 Tool 结果所有者。把它复制到模型 surface 会改变回放与提供方上下文，而仅用于展示的 Session 事件会重复现有持久事实。

**导入或移动附件插件的 `ImageLightbox`。** 未采用，因为一个功能插件不能在运行时导入另一个功能插件的组件，而把提供方专属 Blob 保存移动到 `ui-primitives` 会让通用界面框架负责附件名称与持久化。生图 renderer 在本地保留这项交互状态，只共享静态图标与本地化文案。

## 后果

紧凑文本记录会在最终回答旁保留可交互的生成图片，且不改变提供方或模型文本记录。即使任务轮询重复同一附件，同一 Turn 仍只贡献一个稳定节点；更晚的结果只会在更晚 Assistant 消息到达后移动锚点。预览与保存状态会随 renderer 消失，持久 Tool 结果仍是图片身份的唯一来源。

DSH Client 适配器依赖内置提供方的三个 Tool 名称、snake-case `meta.images` 字段与 loopback 图片路由。提供方发生变化时，会以节点缺失或重试卡片的形式显式失败，并需要协同更新适配器。系统选择器只在受支持的安全上下文浏览器中可用；anchor 回退会把保存位置交给浏览器下载设置。展开过程模式可能同时显示提供方 Tool 预览和最终回答预览；这种重复保留了工作室分发与提供方拥有的控制项。
