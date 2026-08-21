# @deepseek-ai/dsh-host-teacher-workbench

[English](README.md) | 中文

Web 教师工作台的宿主端持久化、试题媒体、文档生成、天气访问与课程表整理插件。插件通过 `ctx.storageDomain` 存储一个经过 schema 校验且带修订号的文档，并暴露 `teacherWorkbench/read` 与采用比较后写入语义的 `teacherWorkbench/write` Remote 方法。专用试题 Remote 以原子方式保存、读取、替换、删除、分发和渲染已存储图片，不向浏览器发送服务器路径。`teacherWorkbench/weather` 通过兼容 Nominatim 的端点解析设置中的区县或城市，再从 Open-Meteo 获取预报；插件校验两次响应，并返回稳定的地点查询、服务可用性或响应错误，浏览器无需直接连接任一服务。浏览器端 MinerU 整理规则没有识别出条目时，`teacherWorkbench/normalizeTimetable` 会在当前会话下启动一个短生命周期子 agent loop，选择 `ctx.agentDefaultModel.currentToolSelection()`，开放本次运行专用的来源工具、矩阵提交工具与按行 splice 的修补工具；浏览器只能复核同一次运行中已通过校验的矩阵令牌所指向的行。

版本 7 文档包含待办、随记、账本分类与账目、日期事项、规范化周课程表条目、备课资源、班级与学生、考试、可复用记录模板、教学记录、试卷批次元数据、学生试题子目录和试题分发记录。账目引用一个持久化分类，存储必填的本地日期与时间，并用非负整数分表示人民币金额；删除分类会在同一次带修订号写入中删除其账目。每个班级只属于一个目录：名册班级持有学生与考试，并供试题切割使用；普通课表班级只供今日课表、本周课表和早晚自习选择；年级课表班级只供年级课表选择。schema 会拒绝所有者缺失或跨越上述目录的账目、学生、考试或课程表引用；各目录仍可用不同标识保存同名班级。每条课程表记录独占一个班级、类型、星期和节次组合；删除班级也会删除其课程安排。试题目录与分发记录引用持久化学生和源图片；删除目录、学生、班级、图片或批次时，会移除从属元数据，并尽力清理其拥有的文件。日常管理条目和教学数据共享同一修订号，因此跨窗口编辑使用同一套比较后写入冲突处理。浏览器端不写 Local Storage；每次接受的变更都会落到为 `teacher_workbench` domain 选定的存储后端。

## 试题图片存储与输出

`teacherWorkbench/saveQuestionBatch` 校验 PNG、JPEG 或 WebP 载荷，生成不透明 id，并在所有图片都写入原子批次目录后才提交完整试卷批次。`readQuestionImage`、`replaceQuestionImage`、`deleteQuestionImage` 与 `deleteQuestionBatch` 只依据经过校验的元数据和已配置根目录解析文件。`assignQuestions` 在经过清理的学年／班级／学生层级及所选子目录下创建独立副本，因此后续编辑或删除某名学生的副本不会改变源批次或其他学生的试题。

`generateQuestionDocument` 从选定的批次图片或分发图片构建可下载的 Word 或 PowerPoint 文档。`generateUploadedQuestionDocument` 接收浏览器所选文件夹图片，但不持久化它们。`saveTemporaryQuestionSelection` 会用独立图片快照替换一名学生原有的临时选集，`listTemporaryQuestionSelections` 则报告所查学生中哪些已有暂存图片。所有 Office 生成路径都优先使用来源图片的权威题号排序；缺少来源题号时从显示文件名提取题号，最后才按文件名自然排序。读取临时清单时也会重新应用同一规则，因此旧版本暂存的乱序选集会在生成时自动纠正。`generateStudentDocuments` 为每名符合条件的名册学生返回一份独立 Word 或 PowerPoint 产物；Word 可逐学生设置标题、姓名和日期，并明确返回跳过列表；使用临时来源时只读取这些快照，并在该学生生成成功后移除其临时选集。Word 输出保持参考系统的 A4 页边距和元数据排版，PowerPoint 输出保持每张 13.333×7.5 英寸幻灯片左上放置一张不放大的图片。图片尺寸、解码字节上限、目标引用、路径包含关系、文件名与生成输出均在 Host 校验；临时选集与持久文档相互隔离。

## 配置

| 字段 | 含义 |
|---|---|
| `segmentsRoot` | 不可变试卷批次目录与切题图片的根目录。 |
| `studentsRoot` | 具有可读年级／班级／学生层级的分发副本根目录。 |
| `maxQuestionImageBytes` | 单张试题图片可接受的最大解码大小。 |
| `maxQuestionBatchBytes` | 单个试卷批次可保存的最大合计解码大小。 |
| `geocodingEndpoint` | 兼容 Nominatim 的地点搜索端点。 |
| `geocodingCacheEntries` | 内存中最多保留的已解析地点数量。 |
| `maxTimetableSourceCharacters` | 单次课程表 agent 请求允许的最大 MinerU 字符数。 |
| `maxTimetableEntries` | 单次运行可接受的最大结构化课程表行数。 |
| `timetableAgentTimeoutMs` | 文本／OCR 课程表 agent 单次运行的墙钟截止时间。 |
| `timetableVisionAgentTimeoutMs` | 视觉课程表 agent 直接读图单次运行的墙钟截止时间。 |

前四项可在 **设置 → 插件 → 插件配置 → 试题工作区存储**中通过 `teacher-workbench` 设置命名空间修改。Web 组合包默认把根目录设为 `~/.dsh/teacher-workbench/segments` 与 `~/.dsh/teacher-workbench/students`。

## 扩展点

插件提供 `ctx.teacherWorkbench`。浏览器端消费者通过 `@deepseek-ai/dsh-api-remotes` 使用生成的 Remote contribution，而不导入宿主端运行时代码。

`geocodingEndpoint` 选择兼容 Nominatim 的搜索端点，`geocodingCacheEntries` 限制内存中的地点缓存数量。缓存未命中时，地理编码请求按每秒不超过一次串行发送；重复刷新天气会复用已解析的坐标，并重新获取当前预报。

## 模型体验

### 课程表整理子 agent

#### 模型所见

一个全新的子 agent 会收到上传名称、提取开始时锁定的导入目标、当前班级／年级／类型／教师默认值、已知班级名称、本次运行专用的来源工具、矩阵提交工具、按行 splice 的修补工具与紧凑最终输出 schema。支持视觉的路由会收到栅格来源的一张整图和若干相互重叠的放大图；PDF、Office 文档及图片降级路径则通过来源工具读取紧凑 MinerU 区域。子 agent 检查来源并提交一次完整的来源语义矩阵；矩阵被拒绝后，它通过从 1 开始计数的行 splice 修补草稿，Host 则保留所有未列出的行与区块。最终输出只包含本次运行中已接受矩阵的令牌。解析器容忍语义轴或字段关键字通过左括号与首个参数相连，但语义或维度错误仍须显式修补草稿。Host 会按数据行的时间顺序展开重复的局部节次表头，使后续区段获得不同节次，而不依赖来源坐标。“班级课表”“年级课表”和“早晚自习”只改变有效记录的业务含义，不规定文档版式。上传内容中的每个字符串都是不可信数据，所有普通工具均被隐藏；结果返回浏览器复核，不会注入父会话对话。

#### Token 影响

每次尝试都会产生一次独立子 agent 运行以及来源、提交和修补工具调用。每次请求都使用所选工具模型配置的 `contextWindow` 与 `maxTokens`，课程表插件不会覆盖这两个值。栅格上传会让增强 OCR 与视觉直读并行开始，因此视觉超时或输出无效后可以立即启动文本子 agent。Web 组合包为视觉直读分配 35 秒，为文本子 agent 分配 5 分钟，使密集提取结果可以获得更多修正轮次，同时不会延迟从失败的视觉直读切换出去。

#### KV Cache 影响

与父会话请求缓存相互独立。只有工具模型路由、固定 persona 与 schema、默认值及 MinerU 来源一致时才可能复用；来源数据变化后，提供方会按自身策略建立不同的后缀或前缀。

## 已知限制与延后工作

- **整份文档写入**：比较后写入可保持跨模块编辑的原子性；超大规模全校数据在多用户部署前应迁移为独立修订的表。
- **JSON base64 媒体传输**：浏览器读取、替换与生成下载会在内存中携带完整载荷；每图与每批次配置上限限制持久化输入，但尚未开放流式传输。
- **天气需要 Host 联网**：地点查询会发送给已配置的地理编码服务，当前天气和未来 12 小时预报由 Open-Meteo 提供；任一服务或宿主出站网络不可用时，已保存的工作台数据仍可使用。
