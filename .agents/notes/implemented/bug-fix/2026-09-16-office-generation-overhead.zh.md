# Agent Note: 减少聊天 Office 生成中的重复工作

Status: implemented

[English](2026-09-16-office-generation-overhead.md) | 中文

## 问题

Univer 的每次内置执行、检查或导出操作都会启动一个 Node 内容 worker。将小规模写入拆成多次工具调用，会重复启动 worker 并编译 JavaScript。查询整个 API 类还会返回模型下一步操作不需要的成员。

打包后的 worker 需要原生公式和交换模块，但上游 npm 依赖列表未包含这些模块。通过已构建的 Gateway 可复现文档写入完成前缺失公式绑定的失败；这是依赖缺失，并非导出成功但耗时过长。

## 决策

[Univer 重打包](../../../../third-party/README.zh.md#artifact-notes)补齐上游 0.3.0 锁文件中的精确原生依赖版本。每次操作仍使用独立的 worker 进程。Node 编译缓存复用已编译的 JavaScript，不在操作之间保留运行中的文档实例。worker 转发 `NODE_COMPILE_CACHE` 和 `NODE_DISABLE_COMPILE_CACHE`，缓存目录默认为 `<DSH_HOME>/cache/dsh-univer-office/node`；Node 负责代码与运行时变化后的缓存失效。

worker 同时接收运行时的 `UNIVER_LICENSE`。[许可决策](2026-09-01-univer-viewer-evaluation.zh.md)继续规定授权、校验及排除开发许可证的要求。

Univer 技能将相关且已知的 Facade 修改放入同一次执行，并合并查询精确的 API 成员或类型。Sheets 使用一次 `setValues` 写入矩形数据，并在读取结果前等待计算完成。Docs 和 Sheets 在每个完整创作批次后独立读回所有要求核验的字段。Slides 保留逐页 SVG 创作、检查、lint 和截图，仅合并 API 查询与相关 Facade 修改。工作树状态检查和最终视觉核验仍为必需步骤。

## 考虑过的替代方案

**在操作之间保留 worker。** worker 池需要额外规定文档状态、取消与清理行为。编译缓存可减少重复编译，同时保留现有的进程隔离。

**跳过读回或视觉核验。** 减少调用会掩盖内容缺失、公式错误或排版缺陷。批处理改变核验时机，不改变必须核验的字段和页面。

**默认读取完整 API 类。** 广泛列举成员仍适用于能力发现，但在已知目标操作时，精确查询成员和类型即可满足需求。

## 影响

缓存无法消除进程启动和 Univer 运行时初始化。空缓存需要先填充，后续 worker 才能复用。模型推理、网络请求、浏览器渲染与截图仍可能占据聊天可见耗时的大部分。

此次修改针对聊天中的 Office 生成。工作台导出器、设置 → 模型的配置以及 PPT Master 路由均保留现有行为。[官方版本集成决策](../architecture/2026-09-16-official-release-integration.zh.md)继续规定发行版的组成。

## 验证

已构建的 Gateway worker 可复现原生依赖缺失。两个必需的原生包补齐后，同一内置入口可写入、独立读回并导出 DOCX、XLSX 和 PPTX 内容；导出的 ZIP 成员会核对预期文本、单元格和公式。

[生成诊断](../../../../packages/bundle/web-app/tests/univer-generation.perf.ts)对比关闭缓存与初始为空、随后被重复 worker 逐步预热的缓存。两组使用相同的原生依赖。Linux Node 24.14.0 的工作负载包括 20 段落文档、含 200 个 SUM 公式的 200 × 8 表格，以及含原生文本形状的三页幻灯片。每种格式各取三个样本，涵盖写入、独立读回、导出与 ZIP 内容检查。计时排除 Gateway 冷启动、模型调用、网络请求、浏览器渲染及截图。幻灯片工作负载不衡量 SVG 创作流程或 PPT Master。

构建好包的运行时产物后，在仓库根目录编译并运行诊断。诊断解析已安装的 Cordis 与 Univer 产物，创建私有 `DSH_HOME`，移除外部环境中的原生模块和许可证覆盖值，并在释放插件后恢复环境。每次运行均从空缓存开始，只有同一次运行中的 worker 共用缓存。`--fragmented` 仅运行一个文档样本，不运行三种格式的完整集合。

```sh
pnpm exec tsdown --no-config --platform node --format esm --no-dts --out-dir packages/bundle/web-app/.dsh-build packages/bundle/web-app/tests/univer-generation.perf.ts
node packages/bundle/web-app/.dsh-build/univer-generation.perf.mjs --disable-cache
node packages/bundle/web-app/.dsh-build/univer-generation.perf.mjs
node packages/bundle/web-app/.dsh-build/univer-generation.perf.mjs --disable-cache
node packages/bundle/web-app/.dsh-build/univer-generation.perf.mjs --disable-cache --fragmented
```

2026-09-16 的测量得到下列总耗时中位数。再次关闭缓存后，工作负载的耗时接近原有水平，可作为主机预热的对照。所有生成文件均通过读回与导出内容检查。

| 工作负载 | 关闭缓存 | 开启缓存 | 再次关闭缓存 |
|---|---:|---:|---:|
| DOCX，20 段落 | 3433.94 ms | 2649.37 ms | 3428.45 ms |
| XLSX，200 × 8 单元格 | 2490.92 ms | 1725.30 ms | 2550.62 ms |
| PPTX，3 页原生文本幻灯片 | 3406.47 ms | 2654.92 ms | 3450.90 ms |

空缓存下的首个文档耗时 3066.79 ms，后续文档样本分别耗时 2649.37 ms 和 2623.79 ms。这些本地测量确认了 worker 开销的减少，不构成端到端聊天延迟承诺。

另一组合成对照在关闭缓存时逐段写入相同的 20 个段落，连同独立读回与导出共耗时 24916.26 ms、启动 22 个 worker；批量写入的中位数为 3433.94 ms，仅启动三个 worker。两组均通过相同的内容检查，并导出 4944 字节的 DOCX。此对照用于隔离调用碎片化的成本，不代表每个真实请求都能获得相同提速。
