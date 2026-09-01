# Agent Note: GUI Full access 风险确认

Status: implemented

[English](2026-07-31-gui-full-access-confirmation.md) | 中文

## 问题

在 Web 客户端的权限选择器中切换到 `danger-full-access` 只需一次点击，且预设以 Title Case 机器名 `Danger Full Access` 展示。Full access 会减少确认步骤，允许 agent（智能体）执行敏感操作、修改文件或运行外部命令，误点即在毫无刻意确认环节的情况下启用了最危险的预设。

## 决策

**每个 GUI 权限选择器默认都把 `danger-full-access` 关进共享的页面内 `RiskConfirmation` 对话框：启用按钮在用户勾选明确的风险确认复选框前保持禁用；可选的左下角“不再提醒”只有在用户确认切换后才会抑制后续 GUI 风险门。预设以产品标签 `Full access` 展示；所有取消路径都不提交也不持久化任何内容。**

- `RiskConfirmation`（ui-primitives）是受控的 Modal 组合：标题、说明、风险确认复选框、可选的抑制复选框、取消，以及 `acknowledged` 勾选前禁用的确认按钮。它始终是页面内对话框——Modal portal 到本文档 body，绝不打开可能落在另一块显示器上的原生或独立浏览器窗口。`Modal` 提供 `contentClassName` slot，让警示正文在受限的移动端或横屏视口内滚动，同时保持动作行固定。抑制复选框只承载呈现状态；所属表面决定已经确认的选择能否持久化。
- 宿主拥有的 `permission` 设置命名空间在 `defaultPreset` 旁保存默认为 `true` 的 `confirmFullAccess`。三个 GUI 入口都读取这一份偏好。成功的抑制写入存储 `false`；设置不可写的表面不会显示该选项，避免承诺无法持久化的结果。
- composer chip（ui-conversation 的 `PermissionSelect`）在确认启用时于 `/permission` 提交前拦截 Full access 选择。确认后经与其他选择相同的注入 `command` 通道提交 `/permission danger-full-access`；勾选抑制时，偏好写入先于该命令。取消、Escape、关闭、点击遮罩、会话锁定与任务切换都会重置本地复选框，但不改变偏好或当前预设。文案经标准 `conversation` locale slot 以 `access.confirm.*` 键供给。
- `/permission` popup（ui-permission 构建于 ui-commands 外壳之上）以数据而非第二套对话框实现把关：`SelectOption` 携带可选的 `confirmation` 载荷，popup 控制器拥有未决复选框状态，`PopupSelectView` 把选择卡换成同一个 `RiskConfirmation`。控制器只在用户完成风险确认的路径、选项结算前调用可选的业务方抑制回调。
- 「通用」设置中的「权限」行在把 Full access 持久化为后续会话的默认值前，也使用同一个受控 `RiskConfirmation`。勾选抑制并确认后，`defaultPreset: danger-full-access` 与 `confirmFullAccess: false` 会原子写入；取消、Escape、关闭与点击遮罩不会写入任何一个字段。
- `Full access` 在每个选择器中都有意覆盖 kebab 转 Title Case 的显示变换；命令与 Settings 写入在 wire 上保留机器名，每份警示正文都保持中英文 locale 感知。直接输入带参数命令仍不经过浏览器选择器风险门。

## 考虑过的替代方案

**原生／操作系统或独立窗口确认。** 已拒：对话框必须留在当前 WebUI 窗口内；第二个窗口可能出现在另一块显示器上，使决策脱离其守护的页面状态。

**每个界面的安全文案共享一个 locale namespace。**不予采用：ui-permission bundle 与 ui-conversation 可独立加载，而 Settings 警示说明的是另一种只影响后续会话的生效周期。每个 bundle 各自拥有文案，ui-permission 也将 popup 与 Settings 词典分开，而非跨 bundle 边界 import。

**在 host／权限后端把关。** 设计上即出界：本变更只涉浏览器客户端确认流；后端权限语义、默认值与更安全预设的一键行为均不变。

## 后果

全新设置会在进入 Full access 的每条可见 GUI 路径上要求刻意且知情的确认。用户可以主动抑制 composer 选择器、`/permission` popup 与「通用」设置行后续的提示，而不会削弱宿主权限写入路径或改变直接命令行为。偏好写入失败或不可用时，下次选择仍会要求确认。验收覆盖 `input-bar.client.spec.tsx` 中的 composer 流、`popup-view.client.spec.tsx` 与 `popup.client.spec.ts` 中的 popup 外壳、`permission-presets-row.client.spec.tsx` 与 `settings-store.client.spec.ts` 中的默认设置流、`browser-plugin.client.spec.ts` 中的浏览器装饰，以及 `access-confirmation.e2e.ts` 与 `settings-chrome.e2e.ts` 中的组装态 Web 回放。
