---
description: "提供方无关的 OCR 运行时：选择文档解析器，并向浏览器与文件系统 Consumer 返回受限 Markdown 或结构化页面几何信息。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ocr

[English](README.md) | 中文

## 概述

`OcrRuntime`（`ctx.ocr`）是上传文档提取的 Service Definition。提供方接收 base64 文档字节，返回受限的阅读顺序 Markdown 或结构化页面几何信息；消费方决定这些输出是进入草稿、持久记录、源文档裁切还是其他产品投影。

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

将本 Service Definition 与一个或多个提供方包一同挂载，再由每个 Consumer 决定提取结果保持临时状态，还是成为持久或模型可见内容。

### 服务 API

`registerProvider(provider)` 以小写 id 为调用插件的生命周期注册提供方，并返回 disposer。重复 id 在插件加载时失败。`extract(request)` 返回含 Markdown 的 `OcrExtractResult`；消费方需要提供方主阅读顺序之外的标题或年级标签时，可以设置 `includeDiscardedText`，密集栅格图片需要提供方定义的细节提取时可以请求 `enhanceImageDetail`。`layout(request)` 返回含源页面尺寸与阅读顺序元素的 `OcrLayoutResult`，元素边界框使用 `[左, 上, 右, 下]`。`layoutLimits()` 返回所选提供方当前对单次版面请求的解码字节与页数限制，使浏览器消费方可在 base64 传输前拆分源 PDF。三种方法都在执行时选择提供方；预期内的请求、提供方和响应错误作为数据返回，而不是 Remote 异常。

显式配置 `provider` 时，提取必须使用该已注册且本地可用的提供方。未配置时，只有恰好一个本地可用提供方才会自动选择；零个或多个候选都返回 `provider-unavailable`。`available()` 只执行廉价的本地检查，不发起网络 I/O。

### Remote 与数据处理

Typert 命名空间为 `ocr`，通过 `extract`、`layout` 与 `layoutLimits` 向获准的浏览器消费方开放。文档请求携带名称、媒体类型与规范 base64 字节；提取请求可以选择包含丢弃文本并增强栅格图片细节，版面请求则可携带从零开始且首尾均包含的页码范围。成功的版面响应携带每个源页面的索引、宽、高，以及按提供方阅读顺序归一化的文本、公式、图片、表格或其他元素。运行时不持久化原始文档、提取文本或几何信息；后续持久性与访问策略由各消费方拥有。

### 配置

| 字段 | 含义 |
|---|---|
| `provider` | 可选提供方 id。只有组合中恰好一个可用提供方时才可留空。 |

源码等价声明见生成的[配置目录](../../../docs/config-catalog.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

运行时校验传输字段，在每次操作时解析已配置的提供方，并把预期内的提供方失败收敛为冻结的可辨识结果。同进程操作还会转发取消信号；Typert Remote 只携带 JSON 数据。准确请求与结果声明位于 [`src/types.ts`](src/types.ts)，提供方选择位于 [`src/index.ts`](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [OCR 子系统](../../../docs/subsystems/ocr.zh.md)——共享类型与生成的 Cordis 服务参考。
- [MinerU 提供方](../ocr-mineru/README.zh.md)——发行版自托管解析器实现。
- [文件系统工具](../../fs/tool-fs/README.zh.md)——面向模型的 `read_document` Consumer。

<a id="model-experience"></a>
## 模型体验

间接影响：`ctx.ocr` 存在时，`dsh-tool-fs` 会注册面向模型的 `read_document` schema；`dsh-client-ui-conversation` 等浏览器消费方也可把提取的 Markdown 放入普通用户消息。本运行时自身不添加提示词或 schema。

#### KV Cache 影响

无直接失效；提交提取文本的消费方拥有请求前缀变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **单次请求使用 JSON base64 传输**：每个请求携带一个完整文件，并在提供方处理前扩大字节占用。消费方可按 `layoutLimits` 拆分 PDF，但尚未开放流式与断点续传。
- **无提取缓存**：重复上传会再次调用所选提供方；需要去重的消费方必须连同保留策略一起拥有它。
- **浏览器 Remote 无取消信号**：同进程消费方可通过 `extractAbortable` 转发中止信号，但 Typert 方法不能携带浏览器中止信号。
- **版面精度由提供方决定**：页面坐标与阅读顺序会被归一化，但识别质量仍由所选解析器负责；领域消费方必须校验或复核派生区域。

<a id="dev-note"></a>
### 开发备注

领域分割不得进入本包；提供方只归一化提取证据，各 Consumer 负责全部领域解释。
