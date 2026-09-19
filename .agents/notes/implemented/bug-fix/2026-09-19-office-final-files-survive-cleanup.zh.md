# Agent Note: 清理前保留 Office 成品

Status: implemented

[English](2026-09-19-office-final-files-survive-cleanup.md) | 中文

## Problem

受管理的 Office 导出与源工程共用临时目录。模型可能漏调 `office_workspace finish`，也可能直接交付临时文件。无条件清理随后删除唯一的导出副本，交付卡片也指向不存在的文件。增加一条模型指令无法保证删除安全。

## Decision

[Office 工作区所有者](../../../../packages/deliverables/office-workspace/README.zh.md) 在 `present` 校验和记录最终路径前发布所选文件。`deliverables/prepare` 瀑布事件归 [tool-present](../../../../packages/deliverables/tool-present/README.zh.md) 所有；它保留普通源文件交付行为，并允许临时文件所有者提供持久的工作区路径。自动发布成功后仅移除选中的临时源文件，因此同一项目的其他文件仍可在后续调用中分别交付。

自动清理会先保留分配目录内剩余的非空 DOCX、XLSX 和 PPTX，再移除中间文件。它不跟随输入链接，也不扫描无关工作区文件。目标使用原文件名，冲突时添加数字后缀；独占发布确保并发时也遵守此规则。发布失败会保留源目录。显式 `finish` 仍决定最终文件集合；显式 `discard` 放弃草稿。

本决策部分取代[生成清理决策](../feature/2026-09-19-office-generation-cleanup.zh.md)中的无条件过期。该说明仍负责临时目录分配、限定所有权的 Univer 输出守卫、确认暂停与兼容沙箱的存储位置。

## Alternatives considered

**要求模型记住收尾。** 工具与技能指令帮助选择成品，但步骤遗漏或轮次中断时，不能据此删除唯一的导出文件。

**无限期保留每个工程。** 这能防止丢失，却留下用户要求清理的脚本、截图和原生工程。恢复只保留可识别的 Office 导出；明确选中的 PDF 或原生文件通过 `present` 或 `finish` 交付。

**复制文件但保留临时交付路径。** 文件卡片在清理后仍会失效。成功工具结果与 `deliverables/presented` 事件都包含发布后的路径。

## Consequences

正常收尾仅保留选中的交付文件。恢复可能保留工程中未完成的 Office 导出或输入副本；保留字节优先于判断其质量，不表示恢复文件已通过内容或视觉检查。发布失败或进程突然退出可能留下待恢复的临时文件；启动时不删除其他进程的目录。已有工作区文件永不覆盖。

## Verification

聚焦测试覆盖正常、取消和失败轮次、分次交付、暂停项目、只读策略、发布失败、同名冲突、并发发布与释放。负向对照在无条件清理实现上运行保留测试，并观察到导出丢失。真实 Web 组合测试在轮次清理后保留 DOCX、XLSX 和 PPTX 的导出字节，并断言持久交付路径位于临时存储之外。录制技能指令固定模型可见的成品发布指引。
