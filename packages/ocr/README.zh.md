# ocr/ - 文档提取能力系列

[English](README.md) | 中文

本系列把上传文档提取为阅读顺序的 Markdown，使浏览器消费方不绑定某一解析器。

| 包 | 角色 | `ctx` 键 |
|---|---|---|
| [`ocr/`](ocr/README.md) | 定义提供方注册、选择、归一化结果与浏览器 Remote | `ctx.ocr` |
| [`ocr-mineru/`](ocr-mineru/README.md) | 经自托管 MinerU 同步 API 提取文档 | 注册到 `ctx.ocr` |

当前消费方包括对话文档导入与教师工作台的校历识别。[OCR 子系统参考](../../docs/subsystems/ocr.md)记录共享请求、结果、错误与提供方约定。
