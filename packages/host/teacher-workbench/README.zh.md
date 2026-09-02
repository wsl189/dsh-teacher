---
description: "Host 负责的带修订号教师数据、当前根目录试题媒体、上传来源、提醒、天气、课程表整理与文档生成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-teacher-workbench

[English](README.md) | 中文

## 概述

Web 教师工作台的宿主端持久化、普通对话工具操作、试题媒体、文档生成、天气访问与课程表整理插件。插件通过 `ctx.storageDomain` 存储一个经过 schema 校验且带修订号的文档，并暴露 `teacherWorkbench/read` 与采用比较后写入语义的 `teacherWorkbench/write` Remote 方法。配套的 `@deepseek-ai/dsh-tool-teacher-workbench` Consumer 会注册七个面向模型的工具，让普通 agent 通过与浏览器相同的权威操作读取和修改日常管理、课程表、学生名册、成绩分析与试题切割。专用试题 Remote 以原子方式保存、读取、替换、删除、分发和渲染已存储图片，不向浏览器发送服务器路径。`teacherWorkbench/weather` 通过兼容 Nominatim 的端点解析设置中的区县或城市，再从 Open-Meteo 获取预报；插件校验两次响应，并返回稳定的地点查询、服务可用性或响应错误，浏览器无需直接连接任一服务。浏览器端 MinerU 整理规则没有识别出条目时，`teacherWorkbench/normalizeTimetable` 会在当前会话下启动一个短生命周期子 agent loop，选择 `ctx.agentDefaultModel.currentToolSelection()`，开放本次运行专用的来源工具、矩阵提交工具与按行 splice 的修补工具；浏览器只能复核同一次运行中已通过校验的矩阵令牌所指向的行。 可选的 `ctx.mobileNotifications` 提供方会向 `teacherWorkbench/listNotificationTargets` 提供不含凭据的机器人列表；Remote 只返回平台、不透明机器人 id、显示名称和当前连接状态。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

版本 10 文档包含待办、备忘录、账本分类与账目、日期事项、规范化周课程表条目、备课资源、班级与学生、考试、家校通知模板与已保存草稿、可复用记录模板、教学和班主任记录、班级座次、试题库文件夹、试卷批次元数据、学生试题子目录和试题分发记录。每份座次只属于一个名册班级，座位数必须与配置的排数和列数完全一致，只能引用该班学生且不能重复安排；删除班级会删除座次，删除学生会清空该生座位。账目引用一个持久化分类，存储必填的本地日期与时间，并用非负整数分表示人民币金额；删除分类会在同一次带修订号写入中删除其账目。每个班级只属于一个目录：名册班级持有学生与考试，并供试题切割和排座位使用；普通课表班级只供今日课表、本周课表和早晚自习选择；年级课表班级只供年级课表选择。schema 会拒绝所有者缺失或跨越上述目录的账目、学生、考试、座次或课程表引用；各目录仍可用不同标识保存同名班级。每条课程表记录独占一个班级、类型、星期和节次组合；删除班级也会删除其课程安排。试题目录与分发记录引用持久化学生和源图片；删除目录、学生、班级、图片或批次时，会移除从属元数据，并尽力清理其拥有的文件。日常管理、教学和班主任数据共享同一修订号，因此跨窗口编辑使用同一套比较后写入冲突处理。浏览器端不写 Local Storage；每次接受的变更都会落到为 `teacher_workbench` domain 选定的存储后端。待办、备忘录、账目和带时间的日历事项都可以附带一份手机提醒，其中只保存所选平台与机器人、从截止时间派生的 UTC 时刻，以及一次性提前量或固定重复间隔。备忘录与账目使用独立的可选提醒截止时间，不复用修改时间或账目发生时间。Host 会在启动及每次写入后依据持久文档重新计算计时器，在截止前重试尚不可用的发送，只在提供方接受消息后推进提醒时刻，并停止投影已完成或已删除事项的提醒；没有填写提醒字段的事项不会创建计时或发送消息。

## 试题图片存储与输出

同尺寸所选页上的编号版式标记会聚类成重复横向栏，其中包括已排除为学习者试题的理论标题。某一页把后续栏留空时，即使没有纵向重叠的题外内容，下一栏起点也会限制前一栏区域；已识别的归属内容跨过该起点时则不采用这项推断界。这样，半空的拼版页会保持接近一个印刷栏宽，无需写入针对文档的装订线坐标。

视觉复核与局部重切会保留首次计算的整份 PDF 异常值过滤宽度；修订后的来源安全界不能在下一轮复核或最终持久化前让已排除的宽度重新参与。

所选页面会按提供方公布的页数与字节限制复制成有界 MinerU 请求；Web 组合包的正常请求上限为五页。一个多页版面请求失败时，Host 会把完全相同的页面集合二分并分别重试，必要时递归到单页请求。单页仍失败时操作才会终止，因为没有 OCR 就无法安全推导几何；密集批次中的提供方峰值显存故障不再立即丢弃全部所选页。

所有语义页组合并后，`segmentQuestions` 会为每道题计算一项归一化安全栏宽，以中位数表示大部分题的宽度；超过该基准 `maxQuestionWidthOutlierExcessRatio` 的题宽不参与整份 PDF 的最大值计算。边界子 agent 根据来源页预览与 OCR 元素推断文档自身的语义题目结构。有界边界子 agent 超时、因模型错误停止或始终没有提交已接受草稿时，Host 只保留具有可见学习者作答要求证据的候选并继续视觉复核，不让整份 PDF 失败。Host 另外提供窄范围结构兜底：识别出的层级章节标题、答案标题或答案／解析块都是不能成为题头的排他停止位置，只有来源引用标签而没有实际题目内容时也不能独立成题。Host 校验不透明元素引用和顺序，通过版式推导出的横向栏归属未声明元素，并把模型选择的单题 `stopBeforeElementId` 作为排他性硬停止位置：它表示首个题外元素，不能同时声明为题内内容。只有在另一道纵向重叠题头与附件的横向距离更近时，Host 才拒绝显式附件归属，因此右栏配图不会被同一高度的左栏题头挡掉。每个区域会记录由纵向重叠且不属于该题的右侧内容形成的最近安全右界；该界会向内保留配置边距但不会裁掉已归属内容，其下边即使遇到跨过题头的超大 OCR 图片框，也不得越过同一横向范围内靠后的已接受题头。相邻题内框与题外框有空隙时，边缘落在空隙中点；相邻题头框的轻微重叠不超过配置边距时，两题改用后一个题头的上边作为同一条硬切线，避免两边互相带入题头。自动归属元素与后方元素簇的间距超过页高的 `maxQuestionAutoOwnedGapRatio` 时，自动归属会在该元素簇前停止；元素簇中含有显式附件声明时除外。显式附件还会把同一横向栏续文归属到下一个章节或题头停止位置；题干位于页底、续文位于另一栏页顶时，Host 按 OCR 阅读顺序拼接多个安全来源片段，不会采样两者之间的整页矩形。包含题头的切片始终保留该题头的左坐标，即使显式归属声明伸入另一栏也不能向左拉动这个起点；向左超出的独立声明块会成为单独切片。这样能排除与末题脱离的答案、装饰和后续试卷内容，同时允许子 agent 明确保留远距离配图。不与已归属元素重叠的排除来源框会记录为白色消除区。浏览器与普通对话渲染器保留每个区域的左、上、下坐标。输出右边界始终等于固定左边界加上整份 PDF 的最大非异常归一化安全栏宽；来源采样到各区域向内收过的横向安全界即停止，剩余部分保持白色，因此等宽输出既保留 OCR 未识别的答题横线，也不会带入栏间或相邻栏像素。首次完整分组视觉复核会对比全部初步裁剪与每个核心来源页，因此某页整页漏题时也能恢复。复核元数据使用准确的 `page-x` 工具 id 标识页面，并把同页脱离切片、被消除或贴边的来源图片、采样范围超过已归属 OCR 内容的右侧条带，以及触及物理页边而可能带入页眉页脚的裁剪标记为必须显式处理的视觉关注项。合格裁剪必须说明实际最上、最下、最左和最右非白像素，核对全部必要来源图形并处理每项标记；否则复核者会记录一条裁剪级缺陷。后续重切只接收被点名题目及其局部来源页。此类裁剪级复核中，来源页上可见但未列出的题目只作为边界上下文并保持不变；Host 会拒绝所有纯页级漏题缺陷和完整分组替换。合格裁剪无需读取 OCR；任何修正被接受前，它都可以在进一步检查后替换一组误报。复核子 agent 在尚未记录缺陷时伪造最终令牌，才会由一个重置检查与提交状态的全新子 agent 接替；这些有界全新运行之后如果子 agent 仍异常结束，会把列出的裁剪作为未解决结果返回，不让整份 PDF 失败。相同的被拒工具结果达到配置上限时，Host 会停止当前子 agent。视觉复核超时、模型错误、无效输出或资源释放失败都会把当前裁剪作为未解决结果返回；已记录缺陷也保持未解决，使调用方下一轮仍只处理这些裁剪，不能通过新的整组复核抹掉观察结果。裁剪级缺陷出现时，它读取 OCR 几何并只提交被点名稳定题头的修正；Host 在保留全部相邻题头的上下文中校验补丁，只合并被引用题目的几何，保留每道未触及题目，并在唯一变化是补回附件时直接扩展原区域。`trim-right` 缺陷只能收缩被点名来源切片的采样右界；固定左边界与整份 PDF 输出宽度不变，移除的来源区域由白色补边替代。裁剪缺陷即使同时引用来源页作为视觉证据，也仍然只能局部修正。补回显式引用附件时还会移除与该附件重叠的白色消除区，并保留其他消除区。报名栏、装订线或裁切线、竖排页面标签、印刷页码、页眉页脚、二维码、出版社资源标签或可选动态演示块只有在题干明确要求使用时才属于题目；排除其图片时还必须一并排除紧邻的小标题，不能留下孤立文字。伪题裁剪只需一条声明 `remove-crop` 的裁剪级缺陷即可局部删除；来源页 id 可以作为视觉证据附带，但不是局部删除的必填项。纯页级缺陷专用于完全没有现有裁剪的整道漏题，必须用可见的 `missingQuestionHead` 标明该题；即使证据中点名了包含这些像素的相邻裁剪，它仍会触发候选完整的分组替换。同一页上的不同漏题头会保留为不同记录。Host 会拒绝未改变被点名异常裁剪的修正。每个问题最多执行两次局部重切；第二次仍未解决时保存第二次结果，不让整份 PDF 失败。

题目图片提示、强制归属判定和确定性题界降级只使用归属于学习者的核心页。答案或解析页仍作为语义停止上下文，因此仅属于解答的图不能使其他有效题界草稿失效。

局部裁剪标注页会用不透明灰色遮罩覆盖每个无关横向栏。遮罩像素不能作为内容缺失或污染的证据；同栏中未遮罩的题目仍作为只读边界上下文，相邻续页也继续可用。重切次数耗尽时，浏览器进度和普通对话结果都会报告未通过最终复核但仍已保存的分组数量。

当续题页同时包含多道新题时，局部栏位重分配会让页首选项、小问或具有可见作答要求的元素继续归属于前一页的顺序所有者。后续已接受题头、章节、答案或解析边界仍会结束续题，因此补全跨页题不会把下一道题带入裁剪。

OCR 遗漏的细答题横线、方框或其他作答标记必须由裁剪中的真实像素证明，不能根据来源题意推断。边缘缺失时只授权该裁剪的纵向局部修正。

每条现有裁剪缺陷都要声明修正应扩展或收缩上边／下边、从来源采样右边去除无关像素、改派引用内容，还是删除伪题。Host 会拒绝向未声明方向移动的边界。内容在两张相邻裁剪之间错分时，只为这两张图记录互补缺陷并修改两者几何；所有未引用裁剪保持像素不变，也不会进入下一轮局部复核。

`teacherWorkbench/saveQuestionBatch` 校验 PNG、JPEG 或 WebP 载荷，生成不透明 id，并在所有图片都写入自身存储后才提交一个有界保存分片。首个分片创建试卷批次元数据；后续分片指定该不透明批次 id，必须重复相同来源元数据与目标，并把文件与图片元数据追加到同一个试题库条目。必填目标会在三种物理位置中明确选择一种：已配置试题库根目录、从来源 PDF 名称派生的根级子目录，或一个当前根目录叶子目录。Web 切题在目录控件留空时使用来源同名子目录，明确选择时使用对应叶子目录；首次保存到扫描叶子目录时，只把该叶子及其可见祖先纳入持久化目录关系。普通对话的 `segment_pdf` 没有默认目标：当前用户请求必须明确说出试题库根目录或一个现有叶子目录的完整路径；缺少目标或模型自行猜测时，Host 会在 OCR 开始前拒绝操作。试卷批次 id 不会创建存储目录。大试卷不受单个分片合计字节上限约束，因为浏览器会依次保存各语义页组，必要时还会按图片解码字节继续拆分。`readQuestionImage`、`replaceQuestionImage`、`deleteQuestionImage` 与 `deleteQuestionBatch` 会操作最近一次当前根目录扫描选中的文件；Host 在每次修改前都会把不透明 id 解析为活动根目录下经过校验的普通文件。存在元数据的目标还会更新其持久关系，没有匹配元数据的扫描文件同样可以完整编辑，并由下一次扫描反映结果。重命名持久化试题库目录会移动其物理子树；删除目录会以可回滚方式摘除整棵物理子树，并删除其批次与相关学生副本，不会把任何图片移到上级。面向模型的图片读取工具只为支持图片输入的路由把一张已解析图片转为持久附件，并报告其原始像素尺寸；矩形消除会采样周围像素，且仅在所有矩形都通过边界校验后替换所选已存栅格图。`assignQuestions` 会在选定的当前根目录学生目录中创建独立副本；来源与目标都存在元数据时保留持久化分发关系，其他组合则直接复制并在下一次扫描中发现，因此后续编辑或删除某名学生的副本不会改变源批次或其他学生的试题。

`generateQuestionDocument` 从选定的批次图片或分发图片构建可下载的 Word 或 PowerPoint 文档。`generateUploadedQuestionDocument` 接收浏览器所选文件夹图片，但不持久化它们。`saveTemporaryQuestionSelection` 会用独立图片快照替换一名当前可见学生原有的临时选集，并在同一次原子操作中递增带修订号文档中所选分发图片的暂存次数与最近时间；其他当前根目录图片同样可以加入选集，但不会创建分发元数据。`listTemporaryQuestionSelections` 则报告所查当前根目录学生中哪些已有暂存图片。所有 Office 生成路径都优先使用来源图片的权威题号排序；缺少来源题号时从显示文件名提取题号，最后才按文件名自然排序。读取临时清单时也会重新应用同一规则，因此旧版本暂存的乱序选集会在生成时自动纠正。`generateStudentDocuments` 为当前根目录下每名符合条件的可见学生返回一份独立 Word 或 PowerPoint 产物；Word 可逐学生设置标题、姓名和日期，并明确返回跳过列表。省略来源时会遵循试题切割界面并读取临时快照；读取已分发图片必须显式使用 `source: 'assigned'`。临时来源生成成功后会移除该学生的临时选集。Word 输出保持参考系统的 A4 页边距和元数据排版，PowerPoint 输出保持每张 13.333×7.5 英寸幻灯片左上放置一张不放大的图片。图片尺寸、解码字节上限、目标引用、路径包含关系、文件名与生成输出均在 Host 校验；临时图片字节不进入持久文档，而持久化分发图片的使用统计会跨生成与重启保留。

## 配置

| 字段 | 含义 |
|---|---|
| `reminderRetryMs` | 已到时提醒的提供方缺失或拒绝发送时，再次尝试前的等待时间。 |
| `segmentsRoot` | 持久化试题库目录及其直接裁剪图片文件的根目录。 |
| `studentsRoot` | 具有可读年级／班级／学生层级的分发副本根目录。 |
| `sourcesRoot` | 对话上传源文档的私有内容寻址根目录。 |
| `generatedRoot` | agent 工具生成 Word 与 PowerPoint 文件的私有根目录。 |
| `maxSourceDocumentBytes` | 单个保留对话源文档的最大解码大小。 |
| `maxQuestionImageBytes` | 单张试题图片可接受的最大解码大小。 |
| `maxQuestionBatchBytes` | 单个自动保存分片的最大合计解码大小；Web 默认值为 96 MiB，它不是整份 PDF 的上限。 |
| `questionSegmentationBatchPages` | 每个语义分割组最多拥有的所选页数；默认值为 20 页。 |
| `questionSegmentationBatchCandidates` | 每个语义分组最多拥有的可疑题头候选数；默认值为 300，同时不拆分单个异常高密度页面。 |
| `questionSegmentationConcurrency` | 同时处理的独立题界或裁剪复核分组上限；默认值为两组。 |
| `maxQuestionWidthOutlierExcessRatio` | 单题安全栏宽超过中位数多少比例后不再参与统一最大宽度计算；默认值为 0.5（50%）。 |
| `maxQuestionSourceChunkCharacters` | 单个题界或修复上下文分块允许的最大序列化 OCR 字符数；Web 默认值为 400,000。 |
| `maxQuestionCompactBoundaryCharacters` | 单个紧凑题界请求直接携带的完整 OCR 最大字符数；更大的分组使用有界来源工具。Web 默认值为 24,000。 |
| `questionSegmentationInlineEvidence` | 是否在各自的子 agent 请求中直接发送符合条件的 OCR 来源与紧凑标注复核图表，从而省去发现工具轮次；默认值为 true。 |
| `maxQuestionCompactBoundaryOutputTokens` | 内联证据题界子 agent 的模型输出 token 上限；默认值为 32,768。 |
| `maxQuestionCompactReviewOutputTokens` | 紧凑视觉复核或文本修复子 agent 的模型输出 token 上限；默认值为 32,768。 |
| `maxQuestionBoundaryAgentRuns` | 初始边界或裁后复核阶段尚未返回已接受令牌时最多启动的全新子 agent 总次数；每阶段默认值为两次。 |
| `maxQuestionRejectedToolCalls` | Host 停止当前子 agent 并保留确定性或未验证输出前，允许出现的相同被拒工具结果上限；默认值为三次。 |
| `maxQuestionAutoOwnedGapRatio` | 自动归属元素之间允许的最大页高比例；更远的尾部元素簇必须通过显式附件声明保留。默认值为 `0.18`。 |
| `minQuestionRepeatedImagePages` | 将重复位置图片判定为页面附属元素所需的最少不同页数；默认值为三页。 |
| `questionRepeatedImagePositionToleranceRatio` | 识别重复图片附属元素时允许的最大归一化位置漂移；默认值为 `0.015`。 |
| `maxQuestionRecutAttempts` | 单张异常题图最多执行的局部重切次数；达到上限后保存最后一次结果，默认值为两次。 |
| `maxQuestionVisionImagesPerToolCall` | 单次视觉工具调用返回的来源预览或裁剪图上限；默认值为 20 张，附件提供方可以施加更低上限。 |
| `questionSegmentationAgentTimeoutMs` | 单个试题分割子 agent 的墙钟截止时间；Web 默认值为 50 秒。 |
| `geocodingEndpoint` | 兼容 Nominatim 的地点搜索端点。 |
| `geocodingCacheEntries` | 内存中最多保留的已解析地点数量。 |
| `maxTimetableSourceCharacters` | 单次课程表 agent 请求允许的最大 MinerU 字符数。 |
| `maxTimetableEntries` | 单次运行可接受的最大结构化课程表行数。 |
| `timetableAgentTimeoutMs` | 文本／OCR 课程表 agent 单次运行的墙钟截止时间。 |
| `timetableVisionAgentTimeoutMs` | 视觉课程表 agent 直接读图单次运行的墙钟截止时间。 |

试题存储字段可在 **设置 → 插件 → 插件配置 → 试题工作区存储**中通过 `teacher-workbench` 设置命名空间修改。Web 组合包默认把媒体、源文档与生成文档根目录设在 `~/.dsh/teacher-workbench/` 下。新增名册班级、学生、学生子目录或持久化试题库目录的状态写入，会在修订提交前创建完整物理层级；文档提交失败时，只删除本次操作创建且仍为空的目录。其他根目录遗留的元数据不会因无关状态写入而在当前根目录中重新创建。试题工作区会递归投影当前 `segmentsRoot` 下的每个非隐藏目录，包括空目录和只有图片的叶子目录；直接图片会作为试卷行显示在其所属文件夹内。它还会识别 `studentsRoot` 下的“年份／班级／学生”和“年份／年级／班级／学生”两种层级，只为物理路径匹配项复用持久化身份，并把每名可见学生下的全部非隐藏子目录投影为目录树节点，递归读取其中图片。当前根目录中不存在的持久化班级、学生与文件夹仍保存在文档中，但不会进入浏览结果。学生行汇总完整子树中的图片，子目录行只选择该目录。修改任一根目录都会切换界面显示的集合，不会从原根目录复制文件。当前根目录中发现的每个班级、学生、后代目录、试卷与图片，都能使用该项目已提供的新建、重命名、删除、编辑、分发、临时选择和生成功能。浏览器提交最近一次扫描得到的不透明标识，Host 在修改文件系统前重新校验其普通文件或目录路径仍位于当前根目录内。具有元数据的修改还会更新带修订号的文档；没有匹配元数据的物理内容仍属于当前根目录，并会在操作后重新发现。重命名持久化学生层级时还会提交显示名称和调整后的分发路径；文档写入失败则回滚物理移动。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 扩展点

插件提供 `ctx.teacherWorkbench`，并可选消费 `ctx.mobileNotifications`；后者的 `listTargets()` 与 `send()` 由 dsh-im 实现，不暴露凭据或私聊标识。浏览器端消费者通过 `@deepseek-ai/dsh-api-remotes` 使用生成的 Remote contribution，而不导入宿主端运行时代码。可选的同进程定时任务界面可以调用 `listScheduledReminders()`，读取从活动工作台提醒派生出的只读且不含凭据的行；该投影不会转移执行或持久化所有权。

`geocodingEndpoint` 选择兼容 Nominatim 的搜索端点，`geocodingCacheEntries` 限制内存中的地点缓存数量。缓存未命中时，地理编码请求按每秒不超过一次串行发送；重复刷新天气会复用已解析的坐标，并重新获取当前预报。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [教师工作台子系统](../../../docs/subsystems/teacher-workbench.zh.md)——生成的 Remote 表层与所有权摘要。
- [浏览器工作台](../../client/ui-teacher-workbench/README.zh.md)——交互式 UI Consumer。
- [面向模型的工作台工具](../tool-teacher-workbench/README.zh.md)——普通对话 Consumer。
- [OCR 子系统](../../../docs/subsystems/ocr.zh.md)——来源提取与页面几何信息。
- [存储子系统](../../../docs/subsystems/storage.zh.md)——持久 domain 后端。

<a id="model-experience"></a>
## 模型体验

### 普通对话工作台工具

#### 模型所见

挂载配套 Consumer 后，每个标准 Web agent 都会看到生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-teacher-workbench)中的七个 schema：`teacher_workbench_read`、`teacher_question_image_read`，以及日常管理、课程表、学生名册、成绩分析与试题切割各自的一个修改工具。板块读取工具从权威修订文档返回稳定 id；日常管理还会返回不含凭据的 `notificationTargets`。图片读取工具返回一张已存批次或分发栅格图及其来源尺寸，并拒绝未声明图片输入能力的模型路由。试题切割修改工具使用来源像素坐标旋转或裁剪图片，或以周围采样颜色消除最多 32 个矩形区域；无效或越界编辑会在替换前失败。新建日常数据前，Host 会重新读取当前 agent 轮次中的用户原文，并只按其中的字面路由词确定去向。用户原文含“备忘”或“备忘录”却调用 `save_todo`，或新建请求完全没有路由词时，写入会在持久化前失败，因此模型自行提供的分类无法覆盖用户原意。提醒修改必须选择其中完全匹配的平台和机器人 id；Host 会在提交事项前拒绝虚构 id 或已经过去的提醒时刻。修改工具会基于最新文档重试比较后写入冲突，并返回已提交修订号、简短摘要与新建 id。课程表修改把今日、本周与早晚自习映射到 `timetable` 目录，只把明确的年级视图映射到 `gradeTimetable`；工具会拒绝跨目录班级 id 与导入载荷中的重复时段，再读回受影响 id 后报告已确认视图。名册、课程表与成绩工具使用上传文档已注入的隐藏 OCR Markdown；附加图片也可由多模态模型直接读取。经对话上传的 PDF 还会携带一个不透明 `sourceId`，用于标识 Host 保留的文件字节，而不把这些字节写入会话日志或提示词。试题分割会解析该 id，取得 MinerU 几何信息，运行受限的题目边界子 agent，在 Host 渲染并保存裁剪图片，再返回试卷批次 id。`generate_folder_document` 通过 `ctx.fs` 递归读取普通本地图片目录，无需名册学生或分发关系即可按自然顺序生成一份 Word 或 PowerPoint 文件，将其写入 `generatedRoot` 并返回绝对路径。已存批次或分发目标使用 `generate_document`，按学生输出使用 `generate_student_documents`。后者在省略字段时与浏览器一致：读取临时选集、Word 标题留空且不显示姓名和日期；只有显式使用 `source: 'assigned'` 才读取全部已分发图片。

#### Token 影响

七个工具 schema 会进入每次普通 Web 模型请求。板块读取和直接修改文档只增加相应工具调用与有界 JSON 结果；成功读取已存图片还会在该结果和后续对话历史中增加一个持久图片附件。PDF 试题分割还会产生 MinerU 工作和下文所述的题目边界子 agent 调用；Office 生成不会发起另一轮模型请求。

#### KV Cache 影响

稳定的工具名称和 schema 成为普通对话前缀的一部分。上传 OCR 文本、当前工作台行与工具结果在请求后缀中变化。题目边界子 agent 的缓存仍与父对话相互独立。

### 课程表整理子 agent

#### 模型所见

一个全新的子 agent 会收到上传名称、提取开始时锁定的导入目标、当前班级／年级／类型／教师默认值、已知班级名称、本次运行专用的来源工具、矩阵提交工具、按行 splice 的修补工具与紧凑最终输出 schema。支持视觉的路由会收到栅格来源的一张整图和若干相互重叠的放大图；PDF、Office 文档及图片降级路径则通过来源工具读取紧凑 MinerU 区域。子 agent 检查来源并提交一次完整的来源语义矩阵；矩阵被拒绝后，它通过从 1 开始计数的行 splice 修补草稿，Host 则保留所有未列出的行与区块。最终输出只包含本次运行中已接受矩阵的令牌。解析器容忍语义轴或字段关键字通过左括号与首个参数相连，但语义或维度错误仍须显式修补草稿。Host 会按数据行的时间顺序展开重复的局部节次表头，使后续区段获得不同节次，而不依赖来源坐标。“班级课表”“年级课表”和“早晚自习”只改变有效记录的业务含义，不规定文档版式。上传内容中的每个字符串都是不可信数据，所有普通工具均被隐藏；结果返回浏览器复核，不会注入父会话对话。

#### Token 影响

每次尝试都会产生一次独立子 agent 运行以及来源、提交和修补工具调用。每次请求都使用所选工具模型配置的 `contextWindow` 与 `maxTokens`，课程表插件不会覆盖这两个值。栅格上传会让增强 OCR 与视觉直读并行开始，因此视觉超时或输出无效后可以立即启动文本子 agent。Web 组合包为视觉直读与文本子 agent 都设置 60 分钟墙钟截止时间。

#### KV Cache 影响

与父会话请求缓存相互独立。只有工具模型路由、固定 persona 与 schema、默认值及 MinerU 来源一致时才可能复用；来源数据变化后，提供方会按自身策略建立不同的后缀或前缀。

### 试题分割子 agent

#### 模型所见

一个全新的子 agent 会收到与版式无关的分割 skill、准确的 OCR 来源分块索引、来源页预览 id、可出错的语义提示、本次运行专用的 OCR 与图片工具、一个边界提交工具以及 `structured_output`。来源分块公开不透明元素 id、页面尺寸、元素类型、边界框和提取文本；预览展示渲染页面，但不会成为坐标来源。子 agent 检查全部分块和预览，推断来源自身的语义题目约定，并提交每道独立顶层任务，同时把小问、图形和跨页续文保留在所属题目内。每个已选题头必须产生作答要求，而不能只介绍带编号的定义、公式、方法、理论总结、例题解答或答案；带明确题干的例题仍然成题，其裁剪要在印刷答案或解析前停止。候选已全部归类的分组可以包含零道题。无关内容在下一道任务前开始时，可用单题排他性 `stopBeforeElementId` 指向首个题外元素；OCR 顺序把明确内容留在常规归属外时可使用 `additionalElementIds`；非试题元素位于其他有效区间内部时可显式排除。Host 不要求某种编号语法、连续标签或固定栏数；准确识别出的层级章节与答案标题仍是强制安全停止位置，只有引用标签的题头则必须拥有实际题目内容。它按 OCR 顺序排列有效题头，校验引用、顺序、自相矛盾的归属和非空几何，并在不接受模型坐标的前提下推导全部矩形。相邻题内框与题外框存在空隙时，纵向边缘落在空隙中点；相邻题头框轻微重叠时，两题共享后一个题头上边作为硬切线。初步渲染后，独立视觉复核子 agent 在首次完整分组复核时接收每个核心来源页，后续单题复核只接收局部来源页，并通过分开的图片流接收裁剪图。即使印刷页脚编号不同，`page-x` 标签仍是页面身份真源；从零开始的 OCR `pageIndex` 只用于坐标修改。裁剪级复核只归类列出的裁剪 id；其他可见题目保持不变，缺陷工具会拒绝 `missingQuestionHead` 和任何纯页级恢复。每张裁剪的标签都会说明末尾纯白区域属于统一宽度补边，只有裁剪图中实际可见的相邻栏文字或图形才能报告为污染。零题分组仍会接受来源页复核。每张被接受的裁剪都要记录可见的 `answerDemand`、实际最上、最下、最左和最右非白内容，以及全部必要图形或表格从来源到裁剪的核对结果。同一裁剪在大段同页间隔后拼接来源切片、消除或截断已识别来源图片、采样未归属的右侧条带，或触及可能出现页眉页脚的物理页边时，Host 会添加 `visualAttention`；合格记录必须在 `attentionEvidence` 中处理每项标记。没有独立任务或仍有未处理视觉缺陷的裁剪属于缺陷。复核者检查全部请求图片后，一次提交完整的 `verifiedCrops` 与 `findings` 分类；部分覆盖或同时出现在两个数组中的裁剪会被 Host 拒绝。干净分类无需打开 OCR；在任何修正被接受前，子 agent 都可以在进一步检查后同时替换两个数组。裁剪级缺陷会开放 OCR 来源和按稳定来源题头索引的局部修正，校验时保留全部相邻题头，返回的完整分组则让所有未提交修正的题目保持不变。带裁剪 id 的缺陷即使同时带来源页 id，也始终采用局部合并；确认伪题时，其裁剪缺陷声明 `remove-crop` 即可通过 `removedCropIds` 局部删除，来源页 id 可作为证据附带但不是必填项。纯页级缺陷只允许恢复完全没有现有裁剪的整道漏题，必须提供可见的 `missingQuestionHead`，并且是唯一能够开放候选完整替换草稿的缺陷类型；证据中提到容纳漏题像素的相邻裁剪不会把它降为局部缺陷。Host 要求每个被点名异常裁剪都发生变化，只返回发生变化或被点名的题目标识，调用方下一轮仅重新渲染该子集。通用受保护题头证据包括“引例变式 N”等组合例题变式标签、“分别求”等明确要求、解析式、解集、定义域、值域或单调区间等指定输出，以及写成“=.”的作答空位。这些信号能防止可见独立试题被模型误判为非题目，同时不引入任何文档专用坐标。

##### 题外块归属指引

```markdown
Boundary drafts distinguish retained non-head content from blocks that belong to no question. outsideBoundaryElementIds names the first semantic OCR element of each document-level title, later-paper preamble, summary, answer, or other outside block. The marker is omitted from crops and stops preceding automatic ownership until the next submitted question head, so a later paper cannot extend the preceding paper's final question. A protected recall hint can be classified as outside only through the same explicit marker after the child inspects the complete source; the deterministic fallback still uses protected hints when no Agent draft is accepted.
```

##### 裁剪边缘证据指引

```markdown
Verification evidence names the crop's actual topmost, bottommost, leftmost, and rightmost visible non-white content. A detached watermark, publisher mark, answer block, or other unrelated lower pixels make only that crop defective even when a large white gap separates them from the question. Registration fields, binding or trim lines, vertical page labels, printed page numbers, running headers or footers, a QR code, publisher resource label, or optional dynamic-demo block are unrelated unless the problem explicitly tells the learner to use them; an excluded image and its compact caption form one removable visual block.
```

##### 核心页所有权指引

```markdown
Within an overlapping semantic group, only `corePageIndexes` own question heads and require candidate or image decisions. Adjacent inspection pages remain visible as read-only continuation evidence; their detected question heads stop automatic ownership without being resubmitted or reclassified. The same ownership controls visual completeness review, so an independent problem headed on an adjacent page does not count as a missing crop in the current group.
```

#### Token 影响

边界、视觉复核与修复子 agent 要求每个模型步骤至少调用一次工具，因此纯文本分析不能耗尽完整截止时间却从未到达 Host 校验器。每次切割会为每个语义页组产生一个边界子 agent 和至少一个视觉复核子 agent，初步裁剪列表为空的分组也不例外；此外还会产生仅在需要修正时发生的有界 OCR 调用、已接受边界或复核令牌，以及最终结构化输出。初始子 agent 如果没有返回本轮工具实际接受的令牌，默认会再启动一个全新恢复子 agent，并重置来源检查与提交状态。Web 组合包让每组最多拥有 20 个所选页面和 300 个可疑候选，在可用时检查两侧各一个相邻所选页，并同时处理最多两个独立分组。跨组题目因此保留续题上下文，完成的分组仍按来源顺序合并。完整序列化分组不超过 Web 的 24,000 字符上限时，初始紧凑请求会携带每个 OCR 元素；更大的分组继续使用有界来源与页面预览工具，而不是只发送候选附近的子集。具有独立作答要求的“题 N 变式 N”“变式 N”、例题与示例标签仍作为通用回忆提示。子 agent 检查完整证据后，以 32,768 个 token 的输出上限返回按来源顺序排列的完整题目清单，其中可以包含提示未覆盖但真实存在的 OCR 损坏题头或未识别题头。Host 仍要求每个提示候选都得到题目或非题目判定，校验受保护的作答要求证据，并在纯 OCR 紧凑阶段自动按几何归属图片。后续视觉子 agent 会直接收到紧凑标注复核图表，采用相同的 32,768 token 输出上限。来源页图表保留五张可读标注页，裁剪图表则按真实高度最多紧排九道题、不生成固定高度空白。落入 20 张图片接纳上限的紧凑复核必须在一次调用中请求每个列出的图表 id，再把全部合格裁剪写入 `verifiedCrops`，并为每张图填写准确且唯一的可见 `answerDemand` 与可见题目证据；只有该清单覆盖全部请求裁剪时才可省略 `findings`。缺陷要在 `issue` 中点名可见像素、声明全部适用的 `repairIntents`，并可另加 `evidence`。每个子 agent 最多检查 50 页、5,000 个 OCR 元素和 300 道题，可提交五份元素引用有效的完整草稿，截止时间为 50 秒。出现三次相同的被拒工具结果时，Host 会停止当前子 agent。边界失败会回退到确定性的作答要求候选；未解决的视觉复核会直接保留并标记为未验证，不再重复同一次失败复核；确认零题的所选范围会正常完成且不创建空批次。只有复核者返回明确的边界修订时，单张异常题图才会最多应用两次局部重切；每次后续复核只发送被点名或几何发生变化的裁剪，第二次后仍有问题也保留第二次结果。包含未知或重复元素引用的提交仍会消耗工具步骤和墙钟时间，但不会消耗完整草稿次数。紧凑题界覆盖以外仍以所选工具模型配置的上下文与输出上限为准。

#### KV Cache 影响

与父会话请求缓存相互独立。固定 skill 和 schema 构成可复用前缀，而本次运行专用的工具名与 OCR 来源为每次切割建立不同的请求后缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **整份文档写入**：比较后写入可保持跨模块编辑的原子性；超大规模全校数据在多用户部署前应迁移为独立修订的表。
- **JSON base64 媒体传输**：浏览器读取、替换与生成下载会在内存中携带完整载荷；每图与每个保存分片的配置上限限制单次请求，但尚未开放流式传输。
- **保留的对话源文档需要生命周期策略**：上传 PDF 会按内容寻址保存在 `sourcesRoot` 下，使后续工具调用读取完全相同的来源；尚未实现自动过期与垃圾回收。
- **agent 生成的 Office 文件是 Host 路径**：普通对话生成会写入 `generatedRoot` 并报告绝对路径；尚未实现这些路径到浏览器下载的交接。
- **天气需要 Host 联网**：地点查询会发送给已配置的地理编码服务，当前天气和未来 12 小时预报由 Open-Meteo 提供；任一服务或宿主出站网络不可用时，已保存的工作台数据仍可使用。
- **试题切割依赖视觉能力与可恢复的 OCR 证据**：已配置工具路由必须接受图片。横向页面中的编号缺口可通过定向半页解析恢复缺失题组，视觉复核可以修正已识别内容附近的边界，但完全缺失的无编号题目仍没有可信元素 id 或几何信息可供恢复。

<a id="dev-note"></a>
### 开发备注

把 `segmentsRoot` 与 `studentsRoot` 视为实时权威来源：每次文件系统修改前，都要在当前设置下重新解析扫描返回的不透明身份并确认其仍位于根目录内。
