# @deepseek-ai/dsh-ocr-mineru

[English](README.md) | 中文

本插件向 `ctx.ocr` 注册 `mineru` 提供方 id，并把上传文件发送到由部署方控制的 MinerU 同步 `/file_parse` 端点。普通提取会启用公式与表格识别并请求 Markdown。设置 `includeDiscardedText` 时，同一次请求还会获取 `middle_json`，并把 Markdown 中没有的唯一丢弃文本行放在正文之前。结构化提取则请求 MinerU `middle_json`，再归一化页面尺寸、阅读顺序行、内容类别与边界框，供源文档裁切使用。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `endpoint` | `http://127.0.0.1:8000/file_parse` | 完整 HTTP(S) MinerU 同步解析端点。 |
| `backend` | `pipeline` | 作为 multipart `backend` 传给 MinerU 的本地后端：`pipeline`、`vlm-engine` 或 `hybrid-engine`。 |
| `effort` | `high` | 作为 multipart `effort` 传给 hybrid 后端的解析质量：`medium` 或 `high`。 |
| `language` | `ch` | 作为 `lang_list` 传入的 pipeline OCR 模型语言：`ch`、`ch_server`、`korean`、`ta`、`te`、`ka`、`th`、`el`、`arabic`、`east_slavic`、`cyrillic` 或 `devanagari`。 |
| `timeoutMs` | `300000` | 完整请求截止时间。 |
| `maxFileBytes` | `20971520` | 最大解码上传字节，最高可配置为 100 MiB。 |
| `maxOutputCharacters` | `500000` | 返回给消费方的最大 Markdown 字符数。 |
| `maxResponseBytes` | `8388608` | 可接收的最大 MinerU JSON 响应字节数。 |

DSH 插件设置页通过**插件 → 插件配置 → 文档识别**展示这些字段。解析后端、混合解析质量与识别语言使用有限选项；接口地址和数值上限仍可直接输入。保存后的变更会应用到下一次识别请求。

## 结构化版面

`ocr.layout` 路径设置 `return_middle_json=true`、关闭 Markdown 输出，并把可选的从零开始且首尾均包含的页码范围转发为 `start_page_id` 与 `end_page_id`。它读取 `pdf_info`，把 MinerU 相对于所选范围的 `page_idx` 映射回源文档索引，保留每个 `page_size`，并为每个可用文本行或非文本块生成一个归一化元素。每个元素都携带内容类别、阅读顺序文本，以及与页面宽高使用相同坐标系的 `[左, 上, 右, 下]` 坐标。坐标会被限制在页面内，格式错误或空的边界框会被忽略。

该输出是几何信息，而非直接可用的领域切分结果。教师工作台使用确定性的题号规则，并裁切浏览器中保留的原 PDF；因此 MinerU 不会成为题库元数据的权威来源，图片清晰度仍由已配置的浏览器渲染倍率决定。

## 格式与失败

提供方接受 PDF、PNG、JPEG、WebP、BMP、TIFF、DOCX、PPTX 与 XLSX。空文件、格式错误、不受支持与超限请求会在网络 I/O 前被拒绝。网络故障与超时返回 `provider-unavailable`；非成功 HTTP 响应、无效 JSON 字段、响应超限和空提取结果使用稳定 OCR 失败码。

配置端点会收到完整上传文档。请将它设在数据保留与访问策略适合用户所选文档的基础设施上；默认回环地址不会把文件发往第三方。

## 模型体验

间接影响：由 `dsh-ocr` 消费方决定提取 Markdown 是否进入模型请求；本提供方自身不添加提示词或 schema。

#### KV Cache 影响

无直接失效；包含返回 Markdown 的请求由消费方拥有。

## 已知限制与延后工作

- **仅支持同步解析**：MinerU 完成前，一份文档始终占用一个 HTTP 请求；尚未开放异步任务轮询与进度。
- **不支持旧版 Office 格式**：`.doc`、`.ppt` 和 `.xls` 会被拒绝；上传前需转换为 DOCX、PPTX 或 XLSX。
- **领域使用前需复核提供方输出**：密集表格、合并单元格、扫描件和手写内容可能产生不完美的阅读顺序；因此校历导入在持久化前会展示可编辑行。
- **结构化输出依赖 `middle_json`**：如果 MinerU 部署省略或改变预期的 `pdf_info` 几何结构，将返回 `invalid-response`；坐标消费方不会回退到猜测 Markdown 版面。
