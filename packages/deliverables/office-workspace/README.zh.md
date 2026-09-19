---
description: "Office 生成临时目录、最终文件独占发布与清理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-office-workspace

[English](README.md) | 中文

## 概述

Word、Excel 和 PowerPoint 生成共用私有目录存放脚本、图片、工程文件和导出草稿。完成内容与视觉检查后，`office_workspace` 仅发布选中的最终文件并移除中间产物。Web bundle 为 Univer 和 PPT Master 挂载此插件；工作台导出器保持独立。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在工具、会话投影和沙箱策略旁挂载此插件。它没有配置字段。

```yaml
- name: '@deepseek-ai/dsh-office-workspace'
```

`create` 在当前会话工作区内分配唯一的 `.dsh-office-*` 目录。`finish` 将选中的非空普通文件复制到临时目录之外的新目标，再删除源目录。目标父目录必须已存在。已有文件永不覆盖；发布失败时保留草稿供同一轮内重试。`discard` 删除放弃的目录。调用这两种操作之前，所有编写和渲染进程都必须退出。

`pause` 在正常轮次结束后保留项目以等待用户确认方案；`resume` 将其关联到下一轮。其他临时目录在所属轮次结束时过期，包括取消或错误，也会在会话或插件释放时清理。最终文件必须在结束该轮之前发布。仅分配过的目录可以清理；不扫描无关路径和用户原件。工作区写入权限足够；只读模式拒绝工具写操作。即使使用 Full Access，此工具也只发布到会话工作区内。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

每个会话串行执行工作区操作和清理。目录身份检查阻止递归删除被替换的目录；嵌套符号链接和 Windows 目录联接只移除链接本身。发布时在各目标旁暂存完整副本，再独占链接到最终位置。发布失败只回滚本次创建的目标。最终文件的字节与草稿文件独立。

不发布运行时不变量伴随模块：插件仅拥有一个目录注册表及其串行操作，没有需要协调的独立服务观测。

</details>

<a id="model-experience"></a>
## 模型体验

### office_workspace

#### 模型看到什么

[工具 schema](../../../docs/tool-catalog.zh.md#office_workspace) 描述创建、发布、过期与清理。结果包含 `directory`、最终 `files`、`cleaned` 和 `paused`，不包含源文件或成品内容。加载的 Office 和 PPT Master 技能将所有中间输出指向分配的目录，并要求完成原有检查后再收尾。

#### Token 影响

一个静态工具 schema，加上创建和收尾各一次简短路径结果。文件数量决定最终路径列表长度；文件字节不进入模型上下文。

#### KV 缓存影响

工具 schema 在插件生命周期内保持稳定。工具结果扩展已记录历史，不改写现有前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 模型和脚本必须使用分配的目录；插件不扫描或删除其他位置的任意文件。
- 进程或机器突然崩溃可能留下已分配目录。启动时不猜测其他进程是否仍在使用它。
- 最终发布需要支持硬链接的本地文件系统。清理失败会报告；被替换的真实目录会保留，以免删除其他所有者的文件。
- 结构、数学、视觉和公式结果检查由编写流程负责。发布确认文件存在，不判断文档质量。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

所有权与过期取舍见[清理决策](../../../.agents/notes/implemented/feature/2026-09-19-office-generation-cleanup.zh.md)。

</details>
