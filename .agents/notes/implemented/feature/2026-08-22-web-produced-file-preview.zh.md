# Agent Note: 产出文件的产品内预览

Status: implemented

[English](2026-08-22-web-produced-file-preview.md) | 中文

## 问题

产出文件行能够说明 agent 创建或修改了什么，但查看文件仍依赖可用的原生桌面打开器。这会排除 headless 与远程 Host，打断对 transcript 的阅读，也无法为不同文档类型提供一致体验。若让浏览器直接导航到 agent 写出的文档，还会在 harness API 附近执行活动内容；除非为文档引入一种会破坏许多普通页面的隔离模型。

## 决策

**产出文件在常驻详情列中打开。**conversation 包拥有按会话互斥的选择状态并声明 `conversation.details.file`；deliverables 包注册渲染器，并让产出文件 chip 与最终回复中匹配的提及都调用 `previewFile(path)`。Tool 调用选择仍使用 `conversation.details.tool`，Tool 行的原生文件操作保持不变，每个预览也都保留**使用系统应用打开**。预览与原生打开是两项独立操作，因为它们有不同的可用性与安全要求。

**Host 返回有界数据，绝不返回可执行的 workspace URL。**`session.previewFile` 从所寻址的 Session 派生 workspace 根目录，通过 `ctx.fs` 解析根目录与请求路径，在符号链接解析后验证规范路径包含关系，并通过文件系统服务的字节上限读取完整普通文件。JSON 响应携带 Base64 与字节数。`previewFileMaxBytes` 默认为 40 MiB，设为零会禁用该端点，超大文件会失败而不返回前缀。取消信号会抵达文件系统读取。Host 不推断 MIME 类型，也不选择渲染器。

**客户端通过封闭的扩展名表选择渲染器。**PDF 使用带翻页控件的 PDF.js；PPTX 使用 Office Kit 和经过净化的 SVG；DOCX 使用 docx-preview；XLSX 与 XLSM 使用 Office Kit、工作表标签，以及最多 200 行、50 列的表格；Markdown 使用已有的净化 Markdown 渲染器；AVIF、BMP、GIF、JPEG、PNG、SVG 与 WebP 使用 Blob URL。旧式 `.ppt`、`.doc` 与 `.xls` 不受支持，因为它们是这些解析器范围外的二进制格式。不支持的文件仍可选择，界面会说明限制并保留系统应用操作。

**预览是快照，不是文件系统订阅。**选择一个受支持文件会执行一次读取；切换文件会中止已过时的请求；刷新会重新读取。渲染器失败会留在面板中并提供重试，不会关闭详情列，也不会转而执行该文件。

[原生 workspace 文件决策](2026-07-31-web-workspace-file-links.zh.md)仍然负责 Tool 行路径、**在文件夹中显示**与系统应用交接。本决策只部分取代其中不做预览的范围。

## 考虑过的替代方案

- **只保留原生打开**——能够保留应用的完整保真度，但会排除没有可见 Host 桌面的部署，也会迫使用户为浏览器可以安全读取的格式离开对话。
- **把 workspace 文件作为浏览器文档提供**——能够让 HTML 及相关资源使用原生浏览器行为，但同源提供会暴露 harness API，sandbox 提供则会破坏正常的脚本与存储行为。第二个 origin 会增加监听器和活动文档安全面。纯数据渲染器无需执行 workspace 文件即可覆盖所需文档格式。
- **在 Host 上把所有文档转换成 PDF 或图片**——可以提升一致性，并避免把解析器重量放进浏览器，但需要平台相关的 Office 软件或新的转换服务，会增加临时产物生命周期，也会把只读 UI 功能变成 Host 文档处理。
- **把每个文件嵌入 iframe 或 object 元素**——依赖浏览器 MIME 支持，而浏览器并不支持现代 Office 格式；活动 SVG 或未来的 HTML 支持也需要另行作出隔离决策。专用渲染器让支持集合保持明确。

## 后果

动态 deliverables 客户端 bundle 携带文档解析器，压缩前约为 4.5 MB。Office 保真度只是一种阅读辅助，不能替代 PowerPoint、Word 或 Excel：复杂版式、字体、公式、动画与宏可能不同或被省略。有界工作簿表格和整文件 RPC 上限限制内存增长，但获准文件仍会在浏览器中以 Base64、解码字节与解析器状态同时存在。远程的已连接客户端即使无法原生打开，也能收到预览字节；端点暴露因此遵循现有 API 载体信任策略。单元覆盖固定了扩展名路由、Base64 解码、刷新、不支持回退、文件系统包含关系、符号链接逃逸、大小限制、禁用、schema 与传输。组装层 Web 快照固定了一条产出 Markdown chip 经真实 RPC 路径打开右侧面板预览的行为。
