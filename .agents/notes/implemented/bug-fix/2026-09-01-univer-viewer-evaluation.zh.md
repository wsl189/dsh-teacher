# Agent Note: Univer 使用上游评估模式与运行时许可证

Status: implemented

[English](2026-09-01-univer-viewer-evaluation.md) | 中文

## 问题

分发版需要在不携带内置开发许可证的前提下打开受支持的评估文档。插件捆绑的 Univer 模块使用独立许可证，其验证逻辑和功能限制继续生效。

## 决策

[无界面分发决策](../simplification/2026-09-19-univer-headless-office.zh.md)取代 Viewer 界面；内容工具与后台渲染继续遵守评估模式及运行时许可规则。[运行时补丁](../../../../third-party/dsh-univer-office/runtime.patch)移除 Host 和文档工作线程中的开发许可证回退值；显式设置的 `UNIVER_LICENSE` 仍作为运行时输入。DSH 不提供替代授权，并保留上游验证、水印和功能限制。[内置扩展决策](../feature/2026-08-25-bundled-extensions-and-qq-speech.zh.md)拥有制品分发、遥测和凭据管理规则。

## 考虑过的替代方案

**打开任何文档前都要求许可证。** 这会阻止发布版 Viewer 支持的评估模式。

**分发开发许可证或禁用验证。** 内置凭据引入到期和分发义务；禁用验证则会授予 DSH 无权提供的权限。

## 后果

[录制的 Web 场景](../../../../snapshots/web/univer-viewer/snapshot.yml)在无许可证情况下运行打包的内容工具，并验证移除的 Viewer 不再可用。真实 Office 生成测试保留导出内容与后台渲染检查。这些场景不验证商业许可证。
