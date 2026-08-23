# Agent Note: 移除产品内产出文件预览

Status: implemented

[English](2026-08-22-remove-web-produced-file-preview.md) | 中文

## Problem

产出文件预览使用一套仅在浏览器运行的文档栈，重复了 Host 原生文件操作。它最初旨在为远程和无界面客户端提供统一读取途径，覆盖 PDF、PowerPoint、Word、电子表格、Markdown 和图片，同时避免在 Harness API 附近执行 agent 写出的活动文档。实现为此加入了受限的整文件 RPC、每会话预览选择状态、6 个文档解析依赖，以及约 4.5 MB 未压缩客户端代码。目标桌面部署具备原生文件打开能力，不把远程预览作为产品要求，也不需要额外的右栏行为。

## Decision

产出文件标签和匹配的行内代码文件名使用现有 `openFile(path)` 操作。常驻详情栏继续用于检查工具调用；Host 支持原生路径时，**在文件夹中显示**仍然可用。[workspace 文件链接决策](../feature/2026-07-31-web-workspace-file-links.zh.md)负责原生打开、浏览器偏好、远程客户端范围和活动文档隔离。

产出文件路径不包含 `session.previewFile` RPC、`previewFileMaxBytes` 配置、`conversation.details.file` 插槽、预览选择状态或 Host 文件读取传输，也没有保留兼容路径或持久数据。原预览决策已完整合并至本记录，其英文／中文配对和一致性记录随之删除。

浏览器保留的输入框上传文件是另一类当前调用方，由[上传文件预览决策](../feature/2026-08-23-uploaded-document-sidebar-preview.zh.md)负责。该渲染器读取浏览器已经拥有的未发送 `File`，不创建工作区路径或 Host RPC，并随草稿关闭；它不会恢复产出文件预览行为。

## Alternatives considered

**通过 `previewFileMaxBytes: 0` 禁用预览读取。** 这会阻止 Host 读取，但右栏操作、浏览器包、RPC、配置、测试和不支持状态的用户体验仍留在产品中。

**保留 RPC 而删除浏览器渲染器。** 生产环境不再有调用方，因此保留它只会为可能的未来用途维持公共方法和文件系统授权路径。

**只保留轻量 Markdown 和图片预览。** 缩减后的渲染器仍保留第二套文件打开交互及其选择状态。选定的行为是原生打开，而不是更小的预览功能。

**把 workspace 文件作为可执行浏览器文档提供。** 同源提供会暴露 Harness API，sandbox 会破坏普通活动页面，第二个源则会增加监听器和公开 URL 生命周期。对于受支持的本机场景，桌面打开器已经让 `file://` 文档与 `/api` 隔离。

**在 Host 上把所有文档转换为 PDF 或图片。** 这需要平台相关 Office 软件或转换服务及临时产物生命周期，会把只读 UI 变成 Host 文档处理功能。

**使用浏览器原生 iframe 或 object 元素嵌入文件。** 浏览器 MIME 支持无法覆盖现代 Office 格式，而活动 SVG 或未来 HTML 支持仍需要独立的隔离决策。

## Verification

组装层产出文件 Web 测试通过真实客户端 carrier 点击文件标签，并验证针对 workspace 文件的一次 `host.openPath` 请求。客户端测试固定文件标签和收尾消息提及均使用属主提供的打开器。Host 与静态检查验证预览 RPC、schema、配置和生成目录均已不存在。

## Consequences

远程或无界面客户端没有在浏览器中读取产出文件的途径，且 Host 原生打开能力可能对它们不可用。重新引入预览需要一个足以抵消客户端包和 Host 授权成本的现实调用方，并重新明确渲染器与活动文档安全决策。完整移除此能力也会删除其解析器、整文件缓冲路径、大小配置、不支持格式状态和刷新生命周期。
