# @deepseek-ai/dsh-ocr-mineru

[English](README.md) | 中文

本插件向 `ctx.ocr` 注册 `mineru` 提供方 id，并把上传文件发送到由部署方控制的 MinerU 同步 `/file_parse` 端点。普通提取会启用公式与表格识别并请求 Markdown。设置 `includeDiscardedText` 时，同一次请求还会获取 `middle_json`，并把 Markdown 中没有的唯一丢弃文本行放在正文之前。消费方为栅格图片请求 `enhanceImageDetail` 时，提供方会依次提取一张增强后的完整图片与六个带坐标标签的重叠区域，再把所有轮次交给下游核对。结构化提取则请求 MinerU `middle_json`，再归一化页面尺寸、阅读顺序行、内容类别与边界框，供源文档裁切使用。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `endpoint` | `http://127.0.0.1:8000/file_parse` | 完整 HTTP(S) MinerU 同步解析端点。 |
| `backend` | `pipeline` | 作为 multipart `backend` 传给 MinerU 的本地后端：`pipeline`、`vlm-engine` 或 `hybrid-engine`。 |
| `effort` | `high` | 作为 multipart `effort` 传给 hybrid 后端的解析质量：`medium` 或 `high`。 |
| `language` | `ch` | 作为 `lang_list` 传入的 pipeline OCR 模型语言：`ch`、`ch_server`、`korean`、`ta`、`te`、`ka`、`th`、`el`、`arabic`、`east_slavic`、`cyrillic` 或 `devanagari`。 |
| `timeoutMs` | `3600000` | 完整请求截止时间。 |
| `maxFileBytes` | `20971520` | 最大解码上传字节，最高可配置为 100 MiB。 |
| `maxOutputCharacters` | `500000` | 返回给消费方的最大 Markdown 字符数。 |
| `maxResponseBytes` | `8388608` | 可接收的最大 MinerU JSON 响应字节数。 |
| `layoutBatchPages` | `4` | 消费方指定页码范围时，每次结构化版面请求最多发送的页数。 |

DSH 插件设置页通过**插件 → 插件配置 → 文档识别**展示这些字段。解析后端、混合解析质量与识别语言使用有限选项；接口地址和数值上限仍可直接输入。保存后的变更会应用到下一次识别请求。

## 结构化版面

提供方通过 `ocr.layoutLimits` 公布 `maxFileBytes` 与 `layoutBatchPages`。浏览器消费方可据此在 base64 传输前把选中的源页面复制成有界 PDF 文件，原始 PDF 大小不会直接成为一次 MinerU 请求的大小。`ocr.layout` 路径设置 `return_middle_json=true`、关闭 Markdown 输出，并把可选的从零开始且首尾均包含的页码范围转发为 `start_page_id` 与 `end_page_id`。显式范围超过 `layoutBatchPages` 时会拆成有界串行请求，再按源页码合并。它读取 `pdf_info`，把 MinerU 相对于所选范围的 `page_idx` 映射回源文档索引，保留每个 `page_size`，并为每个可用文本行或非文本块生成一个归一化元素。每个元素都携带内容类别、阅读顺序文本，以及与页面宽高使用相同坐标系的 `[左, 上, 右, 下]` 坐标。坐标会被限制在页面内，格式错误或空的边界框会被忽略。

结构化归一化会拒绝中心落在所属段落边界框之外的子行。如果清理后的 `para_blocks` 条目丢失了文字，而相同边界框的 `preproc_blocks` 条目仍有可用内容，提供方会从预处理几何信息恢复该条目。任一情况都会把该页标记为可疑；对于多页 PDF 响应，只有可疑页会以单页范围重新请求，并替换批次结果。普通页面仍使用较快的批量请求，而跨页段落合并不会再悄悄把一道题移动到相邻页。

该输出是几何信息，而非直接可用的领域切分结果。教师工作台只向受限的题目边界 agent loop 提供不透明元素 id，再由 Host 校验语义决策并把接受的 id 映射回这些坐标。因此 MinerU 与模型都不会成为题库坐标的权威来源，图片清晰度仍由已配置的浏览器渲染倍率决定。

## 格式与失败

提供方接受 PDF、PNG、JPEG、WebP、BMP、TIFF、DOCX、PPTX 与 XLSX。栅格细节增强只应用于图片媒体类型；PDF 与 Office 格式保持原生文档提取。空文件、格式错误、不受支持与超限请求会在网络 I/O 前被拒绝。网络故障与超时返回 `provider-unavailable`；非成功 HTTP 响应、无效 JSON 字段、响应超限和空提取结果使用稳定 OCR 失败码。

配置端点会收到每个请求文件的完整字节。消费方可能上传原文档或复制出的页面批次，因此请将端点设在数据保留与访问策略适合这些字节的基础设施上；默认回环地址不会把文件发往第三方。

## 模型体验

间接影响：文件系统 `dsh-ocr` 消费方把 MinerU 输出作为 `read_document` 直接提供给模型，浏览器消费方则决定上传文档的 Markdown 是否进入模型请求；本提供方自身不添加提示词或 schema。

#### KV Cache 影响

无直接失效；包含返回 Markdown 的请求由消费方拥有。

## 已知限制与延后工作

- **仅支持同步解析**：MinerU 完成前，一份文档始终占用一个 HTTP 请求；尚未开放异步任务轮询与进度。
- **细节轮次会增加图片提取工作量**：显式增强的栅格图片会发起七次串行 MinerU 请求，部署截止时间与容量必须覆盖额外工作。
- **不支持旧版 Office 格式**：`.doc`、`.ppt` 和 `.xls` 会被拒绝；上传前需转换为 DOCX、PPTX 或 XLSX。
- **领域使用前需复核提供方输出**：密集表格、合并单元格、扫描件和手写内容可能产生不完美的阅读顺序；因此校历导入在持久化前会展示可编辑行。
- **结构化输出依赖 `middle_json`**：如果 MinerU 部署省略或改变预期的 `pdf_info` 几何结构，将返回 `invalid-response`；坐标消费方不会回退到猜测 Markdown 版面。
