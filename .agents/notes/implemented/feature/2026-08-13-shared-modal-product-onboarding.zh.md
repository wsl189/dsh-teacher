# Agent Note: 共用弹窗的产品引导

Status: implemented

[English](2026-08-13-shared-modal-product-onboarding.md) | 中文

## 问题

首次使用的提供方引导会先把用户带进「设置」，之后才能输入唯一必需的 API 密钥。这样一段很短的设置流程跨越两个无关界面，也让引导 UI 的归属分散在多个包中。凭据步骤需要弹窗呈现，但不能改变 Host 的设置与凭据边界。

## 决策

**既有 Models client 插件持有提供方引导。** `ui-settings-models` 在 `settings.onboarding` 中注册 `deepseek-official`。外壳只挂载第一个未完成条目，因此独立贡献的弹窗不会堆叠。不新增 client 包或插件配置行。

**引导步骤使用一个可复用弹窗组件。** `OnboardingModal` 包装既有 ui-primitives `Modal`，提供标题和内容布局，并只在可见期间持有 `#root` 的 inert 状态。Escape 和遮罩点击不会静默完成强制引导；每个步骤只暴露自己的明确操作。步骤仍在加载私有事实时返回 `null`，因此不会绘制或阻塞界面。

**凭据弹窗复用既有编辑器与写入边界。** Models 联接仍负责判断是否已有任意可用提供方。当 DeepSeek 官方引用可写但缺失时，`ProviderEditor` 以仅凭据模式渲染在共用弹窗中。它校验密钥并调用既有 `credentials.set`，不会修改提供方设置。「保存并继续」会等待写入与就绪状态刷新；「稍后配置」只完成协调器当前这一轮。

产品不会在该步骤之前展示强制性的生命周期声明。[Web 产品标识简化](../simplification/2026-08-22-simplify-web-product-identity.zh.md)移除了该声明及其确认状态，但不改变提供方就绪判定或 secret 处理。

## 曾考虑的替代方案

**为凭据步骤单独拆分 client 插件。** 不采用：Models 已持有提供方就绪状态、凭据失效通知、编辑器行为与引导文案。

**把确认或凭据逻辑移入新的 Host API。** 不采用：两个既有后端契约已经能表达所需状态与写入；新增 endpoint 只会扩大范围，不会增加用户能力。

**继续从凭据步骤跳转到 Models。** 不采用：首次使用唯一必填的是密钥，既有编辑器可以安全暴露这项写入，无需再把用户送进第二个对话框。

**保留此前占满视口的展示层。** 不采用：本次需要的是叠加在当前应用上的两个弹窗，既有 ui-primitives modal 已提供合适的 portal、遮罩与无障碍契约。

## 后果

新的 profile 仅在没有任何可用提供方时看到行内 DeepSeek 密钥弹窗。secret 仍以只写方式存入 `.credentials.yaml`，已就绪或无法修复的部署在加载判定期间不会渲染任何引导框架。Models 包同时持有提供方引导展示与提供方配置；README 和浏览器覆盖明确记录了这项职责。
