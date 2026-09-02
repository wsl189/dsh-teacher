---
description: "dsh Web 客户端的模型设置与产品引导插件：直接使用场景分配、按供应商分组的接入线路、API 密钥管理、能力模型目录与 DeepSeek 首次运行弹窗。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-models

[English](README.md) | 中文

## 概述

`dsh-client-ui-settings-models` 是 dsh Web 客户端的 Models 设置页。**使用场景**为默认对话、后台工具、生图与语音识别各提供一个直接选择器；每项选择都来自声明所需操作的已配置线路，并且该面板不包含提供方专属控件。**服务接入**按供应商归组智谱、Kimi、DeepSeek、阿里云百炼／Qwen 与 MiniMax 的官方预设，但标准 API、Coding Plan 和 Token Plan 仍各自鉴权、各自配置；插件持有的生图与语音接入卡也只在这个面板渲染。用户可以添加已安装 catalog 中的提供方，或手工声明自定义 pi-ai 路由。页面把提供方目录、设置文档与凭据描述合并为一个共享快照，并带首次运行的用户走完版本化内测声明与按条件显示的官方 DeepSeek 凭据步骤。

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

从设置导航打开 Models。在**服务接入**中选择供应商及其一种接入方式，再配置该线路。供应商分组只是展示层级：标准 API、Coding Plan 与 Token Plan 各自保留独立的设置路径、凭据、协议、地址和模型目录。展开的提供方编辑器保持有界高度并在内部滚动，因此较大的模型目录不会移动 Settings 框架或供应商控件。至少有一条可用线路后，再到**使用场景**把其中的模型分配给对话、后台工具、生图与语音识别。生图与语音选择器只列出拥有官方能力线路且已配置的产品预设；公共分配无法表达的适配器专属配置仍归**服务接入**。其配置键未在任何位置配置的整分节提供方仍会在首次运行姿态中渲染为展开的设置卡片，直到用户关闭它。

### API 密钥

每条接入线路的编辑卡都把 **API 协议**与单独一个 **API 密钥**输入框放在同一凭据分区；协议属于线路，不是每个模型的覆盖项。键入的密钥经 `credentials.set` 以只写方式存入 profile 的引用之下，profile 没有引用时便派生 `<ROUTE>_API_KEY`，pi-ai profile 会把这次派生记录为 `apiKeyEnv`，因此 `settings.yaml` 从不携带密钥值。即使同一供应商使用同一域名，订阅套餐 Key 仍与标准 API Key 彻底隔离。为新的 pi-ai 提供方留空密钥会保存一个不带引用的 profile，从而保留提供方原生认证。行会以可访问的状态点标识已确认配置或已确认缺失的凭据，成功保存也绝不回显机密内容。

### 编辑提供方

产品预设会直接展示请求路由与模型目录。选择受支持的 LLM 协议后，页面会自动套用官方 Base URL 并预览完整请求地址；对话、图片输入和编程 LLM 共用该线路。选择生图或语音识别时，页面会预览该操作独立的官方地址和产品持有的模型目录，而不会把该端点当成 LLM 协议覆盖。每个 LLM 模型单独声明仅文本或文本加图片的输入能力。修改该能力会把模型行移到匹配的对话或视觉目录，并让未完成的草稿保持可操作。预设编辑器、**添加提供方**表单和**添加自定义提供方**表单都采用这一切换规则；没有视觉目录的线路不会开放图片输入。通用提供方把这些字段收在**模型目录与高级设置**下，手工声明的路由也可修改显示名称。Provider ID 保持固定，因为 settings、已记录会话与凭据引用都用它识别路由。精选集之外的现有字段在编辑后仍会保留。

### 新增与删除提供方

国内供应商工作区持有产品预设，包括为已安装 pi-ai catalog 中缺失的受支持路由提供完整初始值。**添加提供方**仍可采纳 catalog 中其余的路由，**添加自定义提供方**则声明一条 pi-ai 不提供的路由；创建卡片会索要唯一的 Provider ID、端点、协议与至少一个模型，因为没有东西能为它们兜底。**获取可用模型**通过 `llm/discoverModels` 查询表单显示的端点，并打开一个选择器，直到点击**添加所选**才写入。只有用户层携带某条线路时才可删除它，确认对话框会标识该线路以及本页是否同时持有其凭据。

### 首次运行弹窗

版本化声明步骤完成后，DeepSeek 步骤从同一份合并快照投影首次运行就绪状态。用户已经能够到达的**任何**提供方都会直接结束该步骤、不做渲染；只有没有任何提供方的用户才会被询问官方 DeepSeek 密钥。「稍后配置」只完成这次协调器遍历；适配器缺失、路由不活动、合并失败、只读部署或能力不可用时，该步骤不渲染即完成——Models 仍是诊断界面。

### 扩展插槽

本分区为仓库外分发的插件声明三个席位，类型定义在 [`src/client/slot-contract.ts`](src/client/slot-contract.ts) 并从 `./client` 导出。`settings.models.specialized-model`（list）渲染在**服务接入**的通用提供方工作区之后，用于不属于通用 LLM 提供方行的产品专属配置。`settings.models.provider-card`（keyed）渲染在每张展示目录行的服务接入卡片内，以 `entryKey = settingsNs` 分发，并携带该行的 `ConfigurableProviderView`、configured 状态与已确认的 API 密钥状态。`settings.models.footer`（list）渲染在两个服务接入区域之后。注册方通过 `ctx.slots.inject` 激活，并以 type-only import 引入本包 `/client` 入口；没有注册方时三个席位均不渲染任何内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

页面只持有脱敏后的描述符，从不持有完整设置分区：因此每次编辑都以 `settings.mutate` 路径操作落到已存分区上——使用场景分配成对 set 提供方与模型，每个提供方改动字段一次 set、每个清除字段一次 unset、删除提供方行则一次 unset。

### 校验

键入的 API 密钥按其自身字段判定：去除首尾空白后必须非空，且每个字符都必须是可打印 ASCII（`[\x21-\x7E]`），这正是 HTTP 头值能够携带的字符集——与 `@deepseek-ai/dsh-llm` 中的 `normalizeApiKey` 互为镜像，此处复刻是因为源平面拆分禁止导入它。与粘贴的 `NAME=value` 环境行一致或包裹在匹配引号内的值，会作为同样的格式失败被拒绝。空 id、重复 id、空显式名称以及不可读、非正数或小数的容量都会在任何写入之前失败。DeepSeek 的 `models` 是一个按值整体替换的数组：编辑器先显示继承的有效行，直到第一次模型编辑把完整数组物化进用户层，重置则取消该覆盖。

### 并发与凭据

每次 settings 写入都携带卡片当前的 `revision`，因此来自另一个标签页或外部 `settings.yaml` 编辑的并发写入会以 `settings-conflict` 被拒绝。settings 提交后，卡片会在存储凭据前采纳返回的脱敏用户子树与 revision，因此失败的凭据阶段只重试该阶段。删除只会在 profile 指名本页派生的 `<ROUTE>_API_KEY` 目标时移除已配置且可写的凭据，然后 unset 该 profile；两个操作都幂等。加载完成后，页面订阅转发的 `settings/document-updated`、`credentials/reference-updated` 与 `llm/adapters-updated` 属主事件，以及本地 `connection/reset`，因此外部编辑无需轮询即可收敛。

### 引导协调器

声明步骤在 `src/client/locales.ts` 中持有精确文案，并在 `src/onboarding-copy.ts` 中持有确认版本；回环时它通过既有 settings API 比较并写入 `ui-onboarding.welcomeNoticeVersion`，且只有显式点击「继续」才会记录当前版本。非回环浏览器无法使用这个仅限宿主的 namespace，因此确认只保留在进程内，刷新后声明会再次出现。DeepSeek 步骤在共享引导模态框内以仅凭据模式渲染既有 `ProviderEditor`；`credentials.set` 仍是唯一的机密写入，且不改变任何提供方设置。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖设置底座、本页所合并的 seam 与设计依据。

- [ui-settings](../ui-settings/README.zh.md)——本页所依赖 scope 与 schema 服务所在的领域底座。
- [settings](../../settings/README.zh.md)——持久化用户设置 seam 及其文件提供方。
- [credentials](../../credentials/README.zh.md)——本页写入密钥所经的凭据引用 seam。
- [llm](../../llm/README.zh.md)——本页所配置提供方所在的适配器注册表。
- [Web 配置平面](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.zh.md)——手写编辑器的设计依据。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义编辑器的字段覆盖范围与本页的触达范围；它们是当前包约束，不是设置路线图。

- **卡片上只有线路凭据与精选的请求／模型字段可编辑**：手写编辑器以 schema 通用字段覆盖换取产品层级。重试策略、超时、DeepSeek 模型说明及其他进阶字段仍留在 `settings.yaml` 中；编辑器未展示的现有模型字段会予以保留。
- **凭据清理范围刻意保持狭窄**：删除一行时，仅当其引用与页面派生的 `<ROUTE>_API_KEY` 目标完全一致，才会清除已配置且可写的凭据。自定义引用、环境凭据与无法识别的目标会保留，因为该行无法证明自己拥有它们。
- **只有 pi-ai 路由可以手工声明**：自定义提供方卡片写入 `llm-pi-ai`——唯一一个其 profile 描述整个提供方的 namespace。`llm-deepseek` 路由是组合面的事实，不是本页能创建的东西。
- **询问只覆盖 OpenAI 兼容端点**：适配器只读这种模型列表响应格式，因此讲其他协议的网关会报告自己无法被询问，其模型需手工填写。
- **媒体分配不会让 LLM 适配器执行媒体操作**：生图与语音消费方必须读取相应分配，并实现提供方专属的请求与响应格式；适配器持有的传输参数仍保留在**服务接入**中。
- **未声明的存活路由无处渲染**：未附带可配置提供方声明即注册的路由没有 settings 地址；它在各选择器中仍然可见，但不会出现在本页的行里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
