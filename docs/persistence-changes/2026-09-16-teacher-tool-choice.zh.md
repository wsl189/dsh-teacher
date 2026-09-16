---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-16-teacher-tool-choice

[English](2026-09-16-teacher-tool-choice.md) | 中文

## 概述

记录教师分发版保留的可选 toolChoice 请求设置。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-16-teacher-tool-choice
baseline: false
changes:
  - root: "event:request/header"
    previous: "2026-09-11-initial"
    after: "d1c3f0c4a0dd526c4558e19f5b75d61cd30a2f0d2169de63d26ad698a2cac1dc"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

请求头允许省略 toolChoice，或使用既有的 auto、required 与 none 值。此可选字段不改变会话结构格式；读取方将它与模型请求配置一起保留。

<a id="verification"></a>
## 验证

生成的持久化 schema 将此新增字段归类为同版本兼容。定向 LLM 与模型配置测试覆盖保留的请求路由与工具选择。

<a id="dev-note"></a>
## 开发备注

无。
