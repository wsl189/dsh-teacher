# 第三方来源包

[English](README.md) | 中文

此目录固定 dsh-teacher Web 和 Windows 发行版内置的第三方插件。[版本清单](plugin-release-manifest.json)记录了 2026-09-16 核实的上游版本和完整性摘要。Web profile 直接加载这些包，无需在用户 profile 中重复安装。

## 清单

| 包 | 版本 | 发行版用途 |
|---|---:|---|
| `@anysearch/anysearch-dsh` | 0.1.4 | Web 搜索、内容提取、能力发现和批量搜索。 |
| `@dickpy/dsh-imagegen` | 1.5.12 | 生图工作室、画布、图库、模板和生图工具。 |
| `@xmanrui/dsh-im` | 4.21.1 | 十一个 IM 平台、文件发送、提醒及共用的 QQ 语音输入。 |
| `dsh-plugin-cron` | 0.1.3 | 持久化定时任务、模型工具和浏览器管理。 |
| `dsh-skill-mcp-panel` | 2.0.4 | 技能与 profile MCP 管理。 |
| `dsh-univer-office` | 0.3.0，DSH 重打包 6 | Sheets、Docs、Slides、Bases、Boards、审阅和导入导出。 |
| `@huanlin/dsh-plugin-better-sidebar-plugin-office` | 0.2.0 | 官方侧边栏中的 DOCX、XLSX 和 PPTX 预览。 |

Office 预览器保留上游包名，但不依赖 `dsh-better-sidebar`。兼容补丁通过官方文档预览服务注册预览器。侧边栏文件、文档和终端由 DSH 提供。Windows 电脑操控使用官方[原生 Cua Driver 提供方](../packages/experimental/computer-use-cua-driver-native/README.zh.md)；发行版不包含 Windows-MCP 及其私有 Python 运行时。

[PPT Master 提供方](../packages/skill/skill-ppt-master/README.zh.md)另行内置上游 v6.4.0 的完整技能目录。执行具体工作流仍需满足外部 Python 和工具前置条件。

<a id="configuration-and-migration"></a>
## 配置与迁移

在**设置 → 模型 → 服务接入**配置供应商线路，在**使用场景**分配对话、工具、生图和语音模型。生图、浏览器语音输入、工作台语音输入和 QQ 共用这些分配与凭据存储。上游插件自带模型表单时，兼容补丁仍保留这一配置归属。

在**设置 → IM机器人**配置机器人，在**设置 → 技能**管理技能，在**设置 → MCP**或 `dsh-panel mcp` 中管理 profile 服务器。AnySearch 可在服务限制内匿名使用；[Web 搜索参考](../packages/bundle/web-app/README.zh.md#built-in-web-search)说明其端点、凭据和结果上限配置。

日常管理提醒从内置 IM 插件列出已配置机器人，包括标注连接状态的离线机器人。兼容补丁在上游主动投递功能之外提供工作台通知服务，保留机器人别名，并把私聊收件人与凭据留在 IM 内部。QQ 提醒使用最近记住的私聊会话；没有记住私聊时使用绑定的所有者。发送需要机器人已连接且存在可用的私聊收件人。

可执行来源包不包含用户凭据或文档。机器人状态、cron 任务、技能、MCP 设置、Univer 文件和工作树仍保存在原有用户目录中。生图历史与缓存仍位于 `~/.dsh/dsh-imagegen`。迁移应用时，另行迁移所需的 `DSH_HOME`、生图历史及工作区数据。

Univer profile 关闭遥测，并将运行时的 `UNIVER_LICENSE` 转发给内容 worker；重打包移除了内嵌的开发许可证兜底值。授权功能仍受上游条款约束。浏览器渲染操作可能需要 Chrome 或 Chromium，可通过 `UNIVER_RENDER_BROWSER` 指定。Office 预览包保留 AGPL-3.0 许可证，Univer 包含的独立授权模块记录在[第三方声明](../THIRD_PARTY_NOTICES.md)中。

Univer 每次内容操作均在独立的 Node 进程中运行，并共用 `<DSH_HOME>/cache/dsh-univer-office/node` 中的编译缓存。可设置 `NODE_COMPILE_CACHE` 指定其他目录，或设置 `NODE_DISABLE_COMPILE_CACHE=1` 关闭缓存。代码或运行时版本变化时，Node 会使对应的编译缓存失效；该缓存不替代已保存的 Office 文档或工作树。

<a id="word-equations-and-fonts"></a>
## Word 公式与字体

聊天生成的 Word 默认使用 Times New Roman 排版拉丁字母和数字。Doc 技能以 `\(...\)` 和 `\[...\]` 标记行内与独立 TeX 公式；DOCX 导出将这些表达式转换为可编辑的原生 Office 公式。新公式中的字母和数字使用 Times New Roman，变量保留斜体，数字及函数名保持正体。运算符和可伸展符号保留 Cambria Math，明确指定的数学字形类别保留各自样式。不支持的已标记公式会使导出失败，不会替换已有目标文件。明确设置的正文字体及中文字体保持不变。

Univer 实时编辑器显示 TeX 源文，因此需要检查导出 Word 的公式排版。已经栅格化为图片的公式无法通过此转换恢复。[原生 Word 决策](../.agents/notes/implemented/feature/2026-09-17-chat-word-native-equations.zh.md)定义转换范围和验证方式；工作台导出与模型设置各自独立。

## 机器人工作目录

新机器人默认使用 Host 用户的桌面。Electron 通过 `DSH_DESKTOP_DIR` 提供系统桌面路径；其他启动方式使用该绝对路径覆盖值或 `<home>/Desktop`。显式配置与已保存的机器人工作目录优先。应用内目录选择器只替换所选机器人的目录。[工作目录决策](../.agents/notes/implemented/feature/2026-09-01-im-bot-desktop-workspaces.zh.md)规定这一保留规则。

<a id="artifact-notes"></a>
## 来源包说明

固定版本的技能/MCP 面板使用兼容补丁适配 alpha.2 的 Typert 编解码器工厂；其版本、已保存技能、分组和服务器配置保持不变。Univer 以具名回合尾部列表项贡献预览，与官方文件修改卡片共存。

npm 发布包保留许可证和来源元数据。`pnpm-workspace.yaml` 列出每个兼容补丁，`pnpm-lock.yaml` 固定解析后的依赖集合。AnySearch 沿用经审阅的 0.1.4 源码构建。Univer 在 `dsh-univer-office-0.3.0-dsh.6.tgz` 旁保留原始 npm 来源包和 [runtime.patch](dsh-univer-office/runtime.patch)，便于复现重打包。其 WebSocket 代理保留文本帧和二进制帧的类型，并将 Viewer 会话票据转发给 Gateway。

Univer 重打包补齐[上游 0.3.0 锁文件](https://github.com/dream-num/dsh-univer-office/blob/v0.3.0/pnpm-lock.yaml)指定版本的 `@univerjs-pro/engine-formula-rust-binding`（`1.0.0-insiders.20260910-22fe9c7`）和 `@univerjs-pro/exchange-node-binding`（`0.1.2`）。技能将相关写入合为批次，并保留独立读回与视觉检查。技能和 API 工具说明均建议精确查询成员，并区分 `find` 的结果条数限制与 `show` 的完整响应。[Office 生成决策](../.agents/notes/implemented/bug-fix/2026-09-16-office-generation-overhead.zh.md)记录了 worker 测量结果与验证范围。

## 验证

发行组合测试要求官方侧边栏模块、保留的插件模块和工具均存在，并确认不加载 better-sidebar 与 Windows-MCP。模型测试验证所配置的生图和语音线路。浏览器场景覆盖工作台行为、模型设置、Office 展示和机器人工作目录；桌面产物检查要求官方电脑操控 SDK 与各保留插件的运行时文件齐全。原生 Windows 操作需要 Windows 桌面环境。
