---
description: "零依赖有界异步映射：为模型支持与普通并发工作提供来源顺序结果和完全停稳失败。"
kind: "package-library"
---

# @deepseek-ai/dsh-concurrency

[English](README.md) | 中文

## 概述

这是一个零依赖异步映射原语，供需要重叠执行但禁止无界接收任务的工作使用。它是库，而非服务或插件；全部业务归属、取消与结果解释仍由消费方负责。结果保持来源顺序，且已经接收的全部 mapper 结算前不会报告失败。

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

当独立输入可以重叠执行，但调用方需要固定接收上限，并且只应在全部已接收工作完全停稳后重新取得控制时，使用本库。

### 对外接口

```ts
import { mapConcurrently } from '@deepseek-ai/dsh-concurrency'
```

`mapConcurrently(inputs, concurrency, mapper)` 同时最多启动 `concurrency` 个 mapper 调用，并按来源顺序为每个输入返回一个结果。上限必须是正安全整数。

任一 mapper 拒绝后，调度器会停止接收尚未启动的输入，并等待全部在途调用结算。随后，它重新抛出已观察到的失败中输入索引最小的一项。这项完全停稳保证使调用方可以处理失败，而不会在返回的 promise 结算后仍有延迟的在途工作继续运行。

调度器不会把某个输出值解释为失败。消费方如使用结果联合类型，需要先将其中的拒绝变体转换为能力自有错误，再从 mapper 返回。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

一个共享游标会在活动数量低于已校验上限时接收工作，结果写入各自来源索引。首次观察到拒绝后停止接收新工作，但会等待全部活动 mapper 结算，再重新抛出索引最小的拒绝；因此返回的 promise 拒绝后不会继续出现延迟工作。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`src/index.ts`](src/index.ts)——准确导出函数与类型约定。
- [教师工作台 Host](../../host/teacher-workbench/README.zh.md)——有界试题分割 Consumer。
- [Web 客户端](../../client/web/README.zh.md)——为客户端 bundle 注入本包的浏览器组合。

<a id="model-experience"></a>
## 模型体验

通过消费方间接影响模型；消费方使用有界重叠降低模型支持工作的墙钟延迟，但不改变请求内容。

#### KV Cache 影响

不会直接导致 KV Cache 失效；模型请求与缓存前缀由各消费方负责。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **不负责取消**：已接收的 mapper 调用会运行到各自的 promise 结算；需要取消的消费方必须自行传递并观察信号。
- **不负责回滚**：其他输入失败前已完成的副作用仍由消费方负责。
- **不支持优先级或动态容量**：一次完整调用会按来源顺序、在一个固定上限下接收任务。

<a id="dev-note"></a>
### 开发备注

本库不承载能力专用的取消、结果联合、重试或进度上报；这些策略由 Consumer 负责。
