# Agent Note：源码与构建模块之间的工具调度器标识

Status: implemented

[English](2026-09-18-tool-scheduler-module-identity.md) | 中文

## Problem

受支持的 `pnpm dsh` 启动方式使用 tsx 的 ESM 路径映射，而 Cordis 可以在同一进程中加载构建后的插件导出。模块局部的调度器符号会让这两种导入得到不同的键。Agent 循环因此无法在 `ctx.tools` 上找到调度器，并在记录工具调用后以 `Cannot read properties of undefined (reading 'prepare')` 结束轮次。即使模型成功响应，试题切割和结构化输出子代理也无法提交结果。只使用构建模块的组合测试无法暴露此故障。

## Decision

`TOOL_RUNTIME_SCHEDULER` 使用 `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`。该键在进程内共享；每个 ToolRuntime 实例仍独立持有调度器、注册项、策略和执行状态。该符号仍是内部接口，不会绕过现有管线授权工具执行。

[源码启动决策](../architecture/2026-07-29-dsh-source-launch-tsx-esm.zh.md) 继续规定启动器的行为。聚焦的 headless 进程测试通过源码 ESM 启动器和安装版启动器执行同一条真实 shell 调用，观测工具结果和完成的最终响应，并隔离每次运行的配置目录与工作目录。使用模块局部符号时，源码用例可复现调度器缺失故障。

## Alternatives considered

**仅启动构建版本。** 这样可以避免混合模块导入，但受支持的源码命令仍然损坏，不能替代对 `pnpm dsh` 开发流程的修复。

**替换模块加载管线。** Loader 和 tsx 的职责远超这个内部服务键。全局符号可以让现有调用方互通，无需改变依赖解析或插件激活方式。

## Consequences

原生与 PTC 工具调度可以跨同一次受支持启动中的源码和构建模块导入访问注册表。这不代表不同且不兼容的包版本能够互通。工作台行为、模型分配、权限和第三方插件配置保持不变。
