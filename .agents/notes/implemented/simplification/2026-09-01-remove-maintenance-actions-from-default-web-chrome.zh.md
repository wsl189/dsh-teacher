# Agent Note: 从默认 Web 界面框架移除维护操作

Status: implemented

[English](2026-09-01-remove-maintenance-actions-from-default-web-chrome.md) | 中文

## 问题

Session Header 长期显示会话日志下载控件；只要本地 Host 报告提供方由文件支撑，Settings 标题栏就显示原生配置文件操作。两项操作都服务于维护工作流，却占据普通 Session 与设置控件旁的高频产品界面。设置操作还会仅为判断自身是否显示而发起一次特权能力读取。

## 决策

默认 Web 组合不渲染这两项维护操作。`session-log-export` 保留 `/export` 用户命令、认证 ZIP 路由、浏览器下载 controller 与 Session 级结果弹窗；其 Client contribution 只挂载弹窗，不提供 Header 按钮。高级用户可以输入 `/export`，该命令生命周期仍不进入模型历史。

`ui-settings-general` 继续声明并渲染通用 `settings.action` 列表 slot，但不注册配置文档条目。专用操作组件、可用性 store、locale 文案、样式、Client 依赖与可用性读取均不存在。Host 持有的 `settings/openSettingsDocument` 操作与设置提供方文档元数据仍可供其他受信任 Client 使用，普通产品配置继续位于功能自有的 Settings 表单中。

## 曾考虑的替代方案

**随按钮一起删除 Session 导出。** 不采用：逐字节忠实的 ZIP 对支持与调试仍有价值；`/export` 无需长期占用 Header 即可保留该能力。

**把两项操作移入更多菜单。** 不采用：这仍会在日常产品导航中保留维护选项，并为了保留请求移除的条目而新增一层菜单。

**用 CSS 隐藏现有组件。** 不采用：隐藏但仍存活的控件会继续保留闲置代码、locale 文案、特权读取、焦点行为与测试义务。

**删除通用 settings action slot 与 Host 文档操作。** 不采用：本次简化针对默认产品入口。该 slot 仍是有效的组合点；Host 操作则让未来显式 Client 的文件系统目标解析继续留在受信任侧。

## 后果

Session Header 保留谱系与活跃产品控件，不再长期显示日志下载胶囊。只有其他插件明确注册操作时，Settings 标题栏才会出现贡献项。默认浏览器不再探测文档可用性，也不再提供原生编辑器交接。Session 导出仍可通过 `/export` 使用，其准备、成功与失败状态继续按 Session 共用一个弹窗。

组件测试固定空的默认 settings-action slot 与仅命令触发的导出 contribution。浏览器场景固定两个控件均不存在，通过真实流式 ZIP 路由执行 `/export`，并记录结果 Header 与 Settings 可访问性树。
