# Agent Note: Univer Viewer 接受未配置的运行时许可证

Status: implemented

[English](2026-09-01-univer-viewer-evaluation.md) | 中文

## 问题

内置 Univer Viewer 在创建编辑器前拒绝空的运行时许可证。因此，默认安装会显示 `Univer Office requires a valid UNIVER_LICENSE environment variable`，而无法显示 Sheet。[Univer 许可证指南](https://docs.univer.ai/guides/pro/license)允许在没有许可证时试用，并施加上游水印和功能限制；Viewer 额外添加的检查阻止了这一受支持的模式。

## 决策

Viewer 接受 Gateway 返回的运行时 `license` 字段中的任意字符串，包括空字符串，并在传给 Univer 前去除首尾空白。Viewer 仍会拒绝格式错误的配置和失败的 HTTP 响应。Univer 保留全部许可证校验、水印和功能限制。DSH 不提供内嵌开发许可证或替代授权。

[源码补丁](../../../../third-party/dsh-univer-office/viewer-license.patch)记录了 Viewer 改动和包 README 更新。DSH 重构建 2 包含重新构建的 Viewer，并保持 Host、Gateway、渲染进程、worker 和原生依赖声明不变。[内置扩展决策](../feature/2026-08-25-bundled-extensions-and-qq-speech.zh.md)继续负责产物分发、遥测和密钥排除；本文仅替代其中关于 Viewer 启动前必须提供许可证的要求。

## 考虑过的替代方案

**打开任何文档前都要求许可证。** 这会阻止上游试用，并使默认安装在 agent（智能体）创建文档后出现失败。

**恢复内嵌开发许可证。** Viewer 可以直接使用上游试用模式，无需分发凭据。内嵌许可证会引入与打开文档无关的过期和分发义务。

**移除 Univer 的许可证限制。** DSH 不授予产品权益。其封装必须保留上游校验和限制。

## 后果

用户无需配置 `UNIVER_LICENSE` 即可打开 Sheet；授权功能仍需要适当且有效的许可证。运行时环境变量传递和商业分发义务保持不变。[Web 会话录制场景](../../../../snapshots/web/univer-viewer/snapshot.yml)及其[浏览器测试](../../../../apps/web/tests/univer-viewer.e2e.ts)运行实际打包的 Gateway 和 Viewer，要求显示 Sheet 网格，比较持久化工具轮次与可访问界面，拒绝非字符串的运行时值，并验证显式环境变量值的传递。该场景使用编写的模型回放和合成的 Sheet fixture；它不证明真实模型轮次或商业许可证有效性。
