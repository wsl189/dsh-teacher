---
description: "内置 PPT Master 提供方，供使用随附 Web 与桌面产品创建可编辑演示文稿的用户和维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-ppt-master

[English](README.md) | 中文

## 概述

随附 Web 与 Windows 桌面产品把 PPT Master 6.1.0 作为内置 `ppt-master` skill（技能）公开。该提供方无需把文件复制到 `DSH_HOME` 即可注册 skill，并向加载器提供随包资源目录的绝对路径，因此 PPT Master 的脚本、参考资料、布局、图片、声音、许可证和赞助记录在源码检出与已安装 EXE 中都从同一路径使用。上游完整分发保留在 `assets/ppt-master/` 下，并继续受其 MIT 许可证与归属门禁约束。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

默认 Web 组合无配置挂载本包，因此 `ppt-master` 会出现在会话 skill 目录中，可由模型加载或用户直接调用。桌面安装器包含该 Web 组合和完整的随包资源目录。

### 在其他组合中启用

在 `@deepseek-ai/dsh-skill` 之后添加提供方：

```yaml
- name: '@deepseek-ai/dsh-skill-ppt-master'
```

该提供方没有配置。不需要演示文稿创作的小型部署可以省略这一行。

### 运行环境要求

发现与加载只需要 JavaScript 应用。执行 PPT Master 的 Python 脚本需要兼容的 `python3` 命令，以及所选工作流需要的依赖；完整上游依赖清单位于 `assets/ppt-master/requirements.txt`。部分工作流还会调用上游 skill 所述的外部服务或可执行程序。本包不会安装或修改机器级 Python 环境。

### 可观察的成功与失败

组合成功时会列出一个名为 `ppt-master` 的 `bundled` skill，加载以 `# PPT Master Skill` 开头的正文，并从随包 `assets/ppt-master/` 目录解析相对资源。上游归属文件缺失或损坏时，PPT Master 自身的完整性门禁会停止其脚本。桌面载荷门禁会拒绝缺少提供方入口、归属文件、脚本、参考资料、布局或代表性二进制资源的安装包。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包以 `BUNDLED_SKILL_RANK` 注册一个不可变候选项。候选项元数据与固定上游 frontmatter 一致，加载后的正文则不包含 frontmatter。`resourceBase` 与 `path` 从 `import.meta.url` 派生，因此路径解析不依赖当前工作目录或可变的用户 skill 文件夹。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 不可变提供方、目录元数据、随包路径解析与正文加载 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件 |
| [`assets/ppt-master/`](assets/ppt-master/) | 未修改的上游 PPT Master 6.1.0 skill 完整分发 |
| [`tests/skill-ppt-master.spec.ts`](tests/skill-ppt-master.spec.ts) | 注册、归属与完整分发清单检查 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [PPT Master 官方仓库](https://github.com/hugohe3/ppt-master)——上游源码、使用文档与版本。
- [随包 MIT 许可证](assets/ppt-master/LICENSE)——与 skill 一并保留的条款。
- [skill 子系统参考](../../../docs/subsystems/skills.zh.md)——提供方优先级、目录组装与加载。
- [tool-skill 包](../tool-skill/README.zh.md)——目录与选中正文如何到达模型。
- [Windows 桌面包](../../../apps/desktop/README.zh.md)——安装器范围与载荷验证。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-skill` 间接影响模型；后者会在会话目录中发布 `ppt-master` 摘要、渲染选中的 skill 正文，并且只在已加载工作流提出请求时读取引用资源。

#### KV Cache 影响

目录摘要会改变会话前缀中的 skill 列表。加载 `ppt-master` 会在工具结果插入点加入其路由入口指令；后续引用文件只影响读取它们的轮次。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Python 仍在安装包外部**——安装器携带 Skill 资源，但不携带专用 Python 环境或其可选软件包。
- **固定上游版本**——本包包含 PPT Master 6.1.0；升级时必须重新导入并验证完整的新版上游分发。
- **安装包体积**——完整资源树在安装器压缩前包含 12,939 个文件，共 79,496,215 个逻辑字节。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
