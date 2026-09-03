# Agent Note: Ollama 推理默认值让 Off 成为真实请求状态

Status: implemented

[English](2026-09-03-ollama-reasoning-defaults.md) | 中文

## 问题

用户在教师端严格切题流程中关闭思考时，流程会请求所选模型使用 `off` 推理档位。只有当 LLM 适配器把 Off 报告成真实模型能力，并将其映射为端点接受的值时，这项选择才会生效。手工声明的 Ollama 路由通常缺少这两项事实：模型条目省略了 `reasoningEfforts`，pi-ai 无法从任意本地或隧道 URL 推断 Ollama 方言，于是适配器会在分派前移除所选档位。最终请求与完全不点名档位的请求相同，Qwen thinking 模型便沿用提供方默认行为，输出很长的推理流，尽管切题界面显示思考已关闭。

手工修复本身正确，却只存在于单台机器：在 `settings.yaml` 中加入 `compat.thinkingFormat: openai`，标记 `supportsReasoningEffort: true`，并在每个适用模型上声明 `off: none`。每次新安装，以及缺少这些隐藏字段的现有 profile，都可能重现故障。把所有 Ollama 模型视为同一种能力同样错误。[Ollama 的 OpenAI 兼容接口](https://docs.ollama.com/api/openai-compatibility)接受 `reasoning_effort`，而其[思考能力说明](https://docs.ollama.com/capabilities/thinking)区分了具有真正关闭状态的模型与 GPT-OSS；后者只能降低推理档位，不能彻底关闭。

## 决策

当使用 `openai-completions` 时，精确的提供方路由键 `ollama` 明确选择由适配器提供 Ollama 默认值。它物化出的模型默认使用 `thinkingFormat: openai` 与 `supportsReasoningEffort: true`，不再把这个有文档依据的 OpenAI 兼容字段交给 URL 检测猜测。

模型条目省略 `reasoningEfforts` 时，适配器会取其不区分大小写的 Ollama id 最后一个路径片段，并去掉可选 tag 后进行分类：

- Qwen 3 模型提供 `{ off: none, high: high }`，但 embedding 与 reranker 变体除外。
- DeepSeek R1 与 DeepSeek v3.1 模型提供 `{ off: none, high: high }`。
- GPT-OSS 模型提供 `{ low: low, medium: medium, high: high }`，并刻意不提供 Off。
- 未知系列不推断任何推理能力。

这些是默认值，不是强制策略。显式模型值优先于路由值，路由值优先于 Ollama 默认值，`reasoningEfforts: false` 会阻止系列推断。若最终 OpenAI 兼容配置明确写着 `supportsReasoningEffort: false`，适配器不会公布隐式档位映射。路由别名仍是普通手工声明提供方，必须自报能力；只匹配端点 URL 刻意不足以启用这项约定。

这是对 [[2026-08-08-pi-ai-per-model-reasoning-declarations]] 的窄例外；对于未知网关，其「只能显式声明」的行为仍然正确。它也恢复了 [[2026-08-03-pi-ai-declared-provider-catalog]] 的不变量：只有当分派能产生与提供方默认行为可观察地不同的请求时，界面才展示 Off 控件。

## 曾考虑的替代方案

**把隐藏字段写入新安装的初始设置。** 它只能修复安装器变更后新建的 profile，会在用户数据中重复提供方知识，也会让现有安装继续损坏，直至逐一迁移其文件。

**解析 catalog 时查询 Ollama 的 `/api/show`。** 能力探测可以描述更多别名与未来系列，但 catalog 解析目前是同步且确定的。让它依赖外部可变状态，需要异步缓存、失效、超时、认证与离线行为。这仍可作为未来的发现增强，而不是已知默认值正确工作的前提。

**为每个 Ollama thinking 模型展示 Off。** GPT-OSS 无法彻底关闭推理，这会用一个更可信的标签重造原始故障。

**只对教师端切题请求做特判。** 在单个调用方强制协议字段会绕过适配器能力约定，使其他调用方行为不一致，并可能向错误的模型系列发送不支持的值。

## 后果

现有 profile 只要键名是 `ollama`，升级后便能获得真正生效的 Off，无需再补此前必需的 `compat` 与 `reasoningEfforts` 字段。新电脑仍需声明端点与模型 id，但不必重复隐藏的推理配置。为已识别、可切换模型选择 Off 时，现在会分派 `reasoning_effort: none`；选择 GPT-OSS 时，界面只显示 Ollama 真正能够兑现的档位。

这项约定刻意保持保守。提供方别名、未知系列，或 id 隐藏了系列名称的模型，仍需显式声明。Ollama 未来若改变能力词汇，需要更新代码与测试，而不会静默改变已存储 profile 的含义。`tests/catalog.spec.ts` 钉住系列识别、作用域、覆盖优先级与 GPT-OSS 排除；`tests/adapter.spec.ts` 则钉住不带逐模型推理配置时最终发出的 OpenAI 兼容请求载荷。
