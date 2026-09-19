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

`create` 在当前会话工作区内分配唯一的 `.dsh-office-*` 目录。`finish` 将选中的非空普通文件复制到临时目录之外的新目标，再删除源目录。目标父目录必须已存在。已有文件永不覆盖；发布失败时保留草稿供重试。`discard` 删除放弃的目录。调用这两种操作之前，所有编写和渲染进程都必须退出。

新建 Univer 工程、截图、资源导出、PDF 预览和 Office 导出必须写入调用会话及当前轮次拥有的活动临时目录。工具守卫在执行前拒绝其他输出路径，包括经符号链接指向无关目录的路径。已有原生工程仍可编辑；用户要求 `.univer` 格式时通过 `finish` 发布该文件。生成期间临时目录仍位于工作区内，以便沙箱命令共享文件。

`present` 在记录交付路径前，将选中的活动自有临时文件移至工作区根目录。同名冲突使用数字后缀；其他项目文件保留至收尾或清理。后续访问使用返回的路径。

`pause` 在正常轮次结束后保留项目以等待用户确认方案；`resume` 将其关联到下一轮。轮次结束、取消、错误或释放时的自动清理会先将剩余的非空 DOCX、XLSX 和 PPTX 保存至工作区根目录，不覆盖已有文件。保存失败会保留源目录。显式 `finish` 仅保留选中文件；`discard` 放弃所有草稿。仅扫描分配过的目录；用户原件和无关路径不受影响。工作区写入权限足够；只读模式拒绝工具写操作。即使使用 Full Access，也只发布到会话工作区内。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

每个会话串行执行工作区操作和清理。目录身份检查阻止递归删除被替换的目录；嵌套符号链接和 Windows 目录联接只移除链接本身。发布时在各目标旁暂存完整副本，再独占链接到最终位置。发布失败只回滚本次创建的目标。最终文件的字节与草稿文件独立。

发布或删除之前，`office-workspace/releasing` 在验证目录身份后串行等待资源所有者释放。Univer 在此关闭数据库缓存，使 Windows 可以删除文件，并确保原生项目副本包含已提交数据。释放、发布或删除失败时保留该目录并报告路径；其他目录独立继续清理。插件卸载等待每个会话清理结束后再报告失败。

不发布运行时不变量伴随模块：插件仅拥有一个目录注册表及其串行操作，没有需要协调的独立服务观测。

</details>

<a id="model-experience"></a>
## 模型体验

### office_workspace

#### 模型看到什么

[工具 schema](../../../docs/tool-catalog.zh.md#office_workspace) 描述创建、发布、过期与清理。结果包含 `directory`、最终 `files`、`cleaned` 和 `paused`，不包含源文件或成品内容。加载的 Office 和 PPT Master 技能将所有中间输出指向分配的目录，并要求完成原有检查后再收尾。Univer 输出被拒绝时，结果会说明如何创建或恢复临时项目，再通过 `finish` 发布所需成品；即使模型未加载技能也适用。

#### Token 影响

一个静态工具 schema，加上创建和收尾各一次简短路径结果。文件数量决定最终路径列表长度；文件字节不进入模型上下文。

#### KV 缓存影响

工具 schema 在插件生命周期内保持稳定。工具结果扩展已记录历史，不改写现有前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 生成的脚本及不属于受检查 Univer 输出的其他工具仍须遵守临时目录指令；插件不扫描或删除其他位置的任意文件。
- 进程或机器突然崩溃可能留下已分配目录。启动时不猜测其他进程是否仍在使用它。
- 最终发布需要支持硬链接的本地文件系统。清理失败会报告；被替换的真实目录会保留，以免删除其他所有者的文件。
- 结构、数学、视觉和公式结果检查由编写流程负责。恢复保留文件字节，不保证已通过质量检查，因此可能保留未完成的 Office 导出。PDF 预览与原生工程仅在显式选为交付文件时保留。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

所有权与过期取舍见[成品保留决策](../../../.agents/notes/implemented/bug-fix/2026-09-19-office-final-files-survive-cleanup.zh.md)与[清理决策](../../../.agents/notes/implemented/feature/2026-09-19-office-generation-cleanup.zh.md)。

</details>
