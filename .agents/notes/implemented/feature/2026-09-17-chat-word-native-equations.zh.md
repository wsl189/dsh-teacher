# Agent Note: 聊天生成 Word 的原生公式

Status: implemented

[English](2026-09-17-chat-word-native-equations.md) | 中文

## Problem

聊天 Word 创作使用 Univer，其 Doc 文本不表示原生 Office 公式。仅靠指令无法使 DOCX 导出保留可编辑的分数、根号或上下标。默认西文字体也需要由确定的实现负责，而不是依赖模型的格式选择。

## Decision

[Univer 重打包](../../../../third-party/README.zh.md#word-equations-and-fonts)在 worker 的 DOCX 导出操作中使用 KaTeX 和维护中的 MathML-to-OMML 转换器，将明确标记的 TeX 转换为 OMML。转换保留周围富文本、表格、超链接、媒体和已有原生公式。不完整或不支持的已标记公式会拒绝导出。仅在转换成功后才将私有临时文件重命名到已授权目标，失败时保留已有输出。

默认西文字体为 Times New Roman；明确设置的正文字体和东亚字体保持不变。新转换的公式将拉丁字母与数字和运算符分开。这些词元在原生公式内部使用 Times New Roman，变量保持斜体，数字和函数名保持正体。运算符、可伸展符号及明确指定的数学字形类别保留数学排版。Word 的公式普通文本段会关闭词元内部的自动数学间距，但不会将周围 OMML 扁平化。已有原生公式的字体保持不变。

Doc 技能要求包括公式速查表在内的公式使用明确的 TeX 标记，导出器强制完成其转换。货币文本不作为公式解析。公式不能跨越段落、域、图片或超链接边界。速查表逐行创建段落，而不写入字面的 `\n`。转换器在实体解码后对 XML 文本和属性转义，保留 `<`、`>` 和 `&`；用引号替代会改变数学含义，不能作为错误恢复方式。导出失败会指出源公式。实时编辑器保留 TeX 源文；最终排版验证读取并渲染导出的 Word 文件。

[Office 性能决策](../bug-fix/2026-09-16-office-generation-overhead.zh.md)继续负责批量写入与 worker 缓存。[典例收集决策](2026-09-08-example-collection.zh.md)继续负责工作台的 Word 编辑与字体排版。两者均未被取代；本策略作用于聊天 DOCX 导出，不改变模型设置。

## Alternatives considered

**仅使用提示词规则。** 这无法让纯文本导出器生成原生公式，也无法阻止不支持的公式以文本形式交付。

**公式图片。** 图片会丢失 Word 公式编辑、数学结构和可靠的字体修改能力。

**整条公式都使用 Times New Roman。** 数学结构排版需要数学字体。单独的拉丁词元可保留要求的字体，而不替换根号、积分号、定界符或明确指定的数学字形类别。

## Consequences

导出增加一次本地 XML 转换，并保留原始 Univer 文本。图片公式无法恢复，上游导入保真度也独立于此。Windows Word 的编辑与渲染需要在该应用中验证；XML 检查和 LibreOffice 渲染提供相互补充的证据。

[导出回归测试](../../../../packages/bundle/web-app/tests/univer-word-export.spec.ts)覆盖转换、内容与字体保留、无效公式及发布失败。[实际聊天工具场景](../../../../apps/web/tests/univer-generation.e2e.ts)导出真实 Doc 内容，[已录制的技能场景](../../../../snapshots/web/univer-skills/snapshot.yml)固定创作指令。
