---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-05-teacher-session-format-v4

[English](2026-10-05-teacher-session-format-v4.md) | 中文

## 概述

DSH Teacher 接入官方 dsh-v0.2.1-alpha.1，将教师版会话写入器从 V3 升级到 V4。本次迁移包含工具角色结果、提供方所属来源、开发者记录及迟到的问题回答，同时保留可选的教师版工具选择字段和 OCR／模型检查消息归属。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-05-teacher-session-format-v4
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "1a3440e3577382704d42a6263aa463504eb74c566734a55e9503a63efcd02445"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "f3e1ec4605d357c0bded966d0abf062168778b84f136be6a6fcda720d01f7476"
    decision: version-bump
  - root: "event:assistant/attempt"
    previous: "2026-09-14-image-offload"
    after: "15d5dfdd822aa35e115afd74a8982825a493880457774e6850bc1520b50875e4"
    decision: version-bump
  - root: "event:assistant/message"
    previous: "2026-09-14-image-offload"
    after: "1033093edd0db80ff410e00830b523405e00bb0c7684948e531ff65095799625"
    decision: version-bump
  - root: "event:compaction/summary"
    previous: "2026-09-14-image-offload"
    after: "e2f9a41e0989f54ed8cee80f8db2bcf9d60a5c810dc9d45b83fa050b9dce7602"
    decision: version-bump
  - root: "event:developer/message"
    previous: null
    after: "7c3f65c5ef7e39e3ac29b8c9f46d7c18b5a6401f425839c0775fefc0bfa1a4e4"
    decision: version-bump
  - root: "event:request/header"
    previous: "2026-09-16-teacher-tool-choice"
    after: "a47f524cda2e4d58d434e2cc5db7b6b27a94d49907a487542f4616d79324856f"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "d43a0a8f23e67271d1785ce68b477291d4943385ca62543d3c7cd0a629150d9a"
    decision: version-bump
  - root: "event:system/message"
    previous: "2026-09-14-image-offload"
    after: "69081694be231d56fd9580ba14645fd5e35373202605d5c5c841a9435b5fa3b1"
    decision: version-bump
  - root: "event:team/message/queued"
    previous: "2026-09-14-image-offload"
    after: "21fb6a90d5068f6a0003b7ab316ed2f56342477146a65c00db0f13c4d8df667d"
    decision: version-bump
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-14-image-offload"
    after: "100f6dca1468538239522cde3533e5bd721d0f1a7b50bea8b0eb533ea6c96163"
    decision: version-bump
  - root: "event:tool/result"
    previous: "2026-09-14-image-offload"
    after: "7c9f44e90a0058f4cc532ae20dad0c10afa6eba22e70a6c79fc79490bad64397"
    decision: version-bump
  - root: "event:turn/end"
    previous: "2026-09-14-image-offload"
    after: "0f8512903d94f57a4748fa1a2092e64342856796684e6b8343db685b192745ce"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "8881bb31dd0435a6c25d93d4fb3ff6832490c6188818658ed007d2b141a7c03e"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

这是教师分支首次接入 V4。前序历史包含已发布的 2026-09-16-teacher-tool-choice 记录，因此不能复用从另一种请求头演变而来的官方 V4 检查点。已有教师版确认记录和历史发布 schema 保持原样。共用的 V3→V4 读取器执行官方迁移，V0–V3 原始数据仍可读取，前序文件会保留。未知提供方元数据采用官方归属保留策略。新写入的 V4 记录中，OCR 通知和模型检查使用有类型的来源；toolChoice 仍为可选且与提供方无关。

<a id="verification"></a>
## 验证

合并后的 Host 回归套件通过 809 项测试，覆盖 Settings、教师工作台、会话控制器模型检查、DeepSeek 序列化及反射生成。模型设置浏览器场景的 19 项测试全部通过；上传文档场景验证只有一条 OCR 消息携带识别正文，且可见会话不展示正文。常规持久化验证器会核对生成目录及分支检查点与本声明的一致性。

<a id="dev-note"></a>
## 开发备注

无。
