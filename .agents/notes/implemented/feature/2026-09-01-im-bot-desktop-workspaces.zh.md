# Agent Note: 新建 IM 机器人使用桌面工作区

Status: implemented

[English](2026-09-01-im-bot-desktop-workspaces.md) | 中文

## Problem

进程启动目录可能是仓库、安装文件夹或其他偶然的位置。将它分配给新连接的机器人，会让文件操作取决于应用的启动方式。Windows 桌面也可能位于用户主目录之外，包括 OneDrive 或其他磁盘。

## Decision

[IM 发行补丁](../../../../patches/xmanrui-dsh-im@4.11.0.patch)通过一个小型 Host 入口提供桌面默认值，并将明确的工作区设置传给未修改的上游插件。全部九个机器人平台共用这项规则；Office 保留自己的配置。[Electron](../../../../apps/desktop/src/main.ts)通过 `app.getPath('desktop')` 获取系统桌面，并通过 `DSH_DESKTOP_DIR` 提供该路径。其他 Host 启动方式使用这个绝对路径覆盖值或 `<home>/Desktop`。

显式指定的平台工作区优先于桌面默认值。上游工作区存储只初始化缺失的分配，因此已保存的机器人路径和后续用户选择保持权威。适配入口不会重写配置文件、创建桌面目录或改变应用的工作目录。

## Alternatives considered

**所有部署都使用 `<home>/Desktop`。** 该路径无法覆盖由用户或 OneDrive 重定向的 Windows 桌面。Electron 已经拥有读取系统桌面路径的能力。

**改变进程工作目录。** 这也会重定向其他应用行为。传入明确的 IM 配置能将默认值限制在机器人工作区内。

**替换已保存的工作区映射。** 已有分配表达用户选择，并且可能拥有正在进行的会话。默认值只在分配缺失时生效。

## Consequences

新建机器人的工作区不依赖启动目录，已保存的分配则跨升级保留。非 Electron Host 若迁移了桌面，必须提供 `DSH_DESKTOP_DIR` 或显式平台设置。受维护的入口使用上游配置 API；发行补丁会重建 Host 产物，使该入口与其他已审阅的兼容更改一起发布。

## Testing

[IM 入口测试](../../../../packages/bundle/web-app/tests/im-workspaces.spec.ts)覆盖全部九个平台、显式覆盖、Office 设置、主目录默认路径和无效桌面路径。[桌面环境测试](../../../../apps/desktop/tests/runtime-environment.spec.ts)覆盖系统路径传递。[完整组合的 QQ 浏览器场景](../../../../apps/web/tests/qq-workspace-picker.e2e.ts)初始化一个未分配工作区的离线机器人，保留另一个机器人的已保存工作区，为两条路径生成快照，并通过持久数据与页面刷新验证用户选择的路径，全程不连接 IM 服务。
