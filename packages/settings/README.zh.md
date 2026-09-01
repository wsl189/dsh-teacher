---
description: "用户设置包映射：namespace 解析、分类模型服务线路与 YAML/JSON 持久化。"
kind: "package-group"
---

# settings/：用户可编辑配置

[English](README.md) | 中文

## 概述

`settings/` 组让插件配置变为用户可编辑：插件用一个 schema 注册具名 namespace，用户在一份文档里覆盖值，无需改动 `cordis.yml`。用户覆盖优先于部署自身的配置与 schema 默认值，变更实时生效。`settings/` 提供服务，`settings-file/` 把所有 namespace 存进一份 YAML 或 JSON 文档，`model-service-settings/` 持有供“模型”设置与媒体 Consumer 共用的分类供应商请求线路。设置是可选的：没有挂载提供方时，配置保持组合原样。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

本组包含三个包；各子级 README 持有完整行为，穷尽式设置服务接口面由子系统参考负责。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`settings/`](settings/README.zh.md) | 设置服务：注册 namespace 并读取或修改其值 | `ctx.settings` |
| [`settings-file/`](settings-file/README.zh.md) | 把设置存进一个本地 YAML/JSON 文件并热发布外部编辑 | 注册 `ctx.settings` |
| [`model-service-settings/`](model-service-settings/README.zh.md) | 为配置界面与能力 Consumer 存储分类供应商端点和模型目录 | 注册 `model-service-settings` |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考了解共享词汇，再看本家族遵循的能力 seam 拆分。

- [设置子系统参考](../../docs/subsystems/settings.zh.md)——namespace、分层解析、descriptor、变更提交与生成的 cordis 接口面。
- [能力 seam](../../docs/capability-seams.zh.md)——本家族遵循的 Service Definition / Service Provider / Consumer 拆分。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
