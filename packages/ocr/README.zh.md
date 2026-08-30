---
description: "OCR 包组：提供方无关的文档提取，以及文件系统、对话和教师工作台 Consumer 使用的自托管 MinerU 提供方。"
kind: "package-group"
---

# ocr/——文档提取

[English](README.md) | 中文

## 概述

本系列从上传文档提取阅读顺序 Markdown 与结构化页面几何信息，同时让 Consumer 不绑定某一解析器。Service Definition 负责提供方选择与归一化结果，MinerU 包负责转换由部署方控制的同步 API。各 Consumer 决定提取内容是成为模型可见工具结果、可编辑浏览器草稿，还是经过复核的来源几何信息。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | `ctx` 键 |
|---|---|---|
| [`ocr/`](ocr/README.zh.md) | 提供方注册、选择、归一化结果与浏览器 Remote | `ctx.ocr` |
| [`ocr-mineru/`](ocr-mineru/README.zh.md) | 自托管 MinerU 提取提供方 | 注册到 `ctx.ocr` |

<a id="related-documentation"></a>
## 相关文档

- [OCR 子系统参考](../../docs/subsystems/ocr.zh.md)——共享请求、结果、错误、提供方与生成的 Cordis 服务词汇。
- [文件系统工具](../fs/tool-fs/README.zh.md)——负责面向模型的 `read_document` Consumer。
- [教师工作台](../host/teacher-workbench/README.zh.md)——负责对 OCR 输出进行复核式课程表与试题分割处理。

<a id="dev-note"></a>
## 开发备注

无。
