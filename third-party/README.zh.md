# 第三方来源产物

[English](README.md) | 中文

本目录固定 dsh-teacher 发行版使用且已经审阅的第三方插件产物。它们是项目构建输入，不再是每台机器分别安装的文件：`@deepseek-ai/dsh-web-app` 已将其声明为依赖并挂载到发行 profile，因此从源码启动或使用 Windows EXE 都不需要另行执行 `dsh plugin add`。

## 清单

| 目录 | 产物 | 版本 | 上游 | 发行版作用 |
|---|---|---:|---|---|
| `dsh-im/` | `xmanrui-dsh-im-1.0.3.tgz` | 1.0.3 | [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | 九种 IM 平台、QQ 文件发送、手机提醒与 QQ ASR 设置。 |
| `dsh-plugin-cron/` | `dsh-plugin-cron-0.1.3.tgz` | 0.1.3 | [abiaoa1314/dsh-plugin-cron](https://github.com/abiaoa1314/dsh-plugin-cron) | 持久 cron 任务、模型工具与浏览器管理页。 |

Web 组合还从 npm 固定 `@huanlin/dsh-plugin-better-sidebar-plugin-office` 0.1.2。该 AGPL-3.0 包把 DOCX、XLSX 与 PPTX 查看器注册到内置 better-sidebar 文件注册表。

## 配置与迁移

可执行代码会随仓库和 EXE 发布，本机专属状态不会进入安装包。机器人凭据、QQ 设置、cron 任务及相关数据仍保存在 `DSH_HOME`（`~/.dsh` 或 `%USERPROFILE%\.dsh`）下。机器人通过**设置 → 插件 → 连接平台**配置。在 Windows 安装版中，机器人的「选择目录」操作使用应用内 Host 目录浏览器，不依赖 Windows 系统文件夹对话框。`dsh-im/cordis.patch.yml.example` 只作为需要显式覆盖 `qq.outboundMediaRoots` 的部署参考。

迁移电脑时，在新机器安装 EXE 或克隆并构建仓库，再单独复制所需的 `DSH_HOME` 数据。不要把这三个插件重复安装到生成的用户 profile；重复配置项可能重复注册工具和侧边栏入口。

## 验证

真实发行组合的浏览器测试会断言三个客户端模块均进入模块图，并固定 Host 级 `cron_*` 与 `qq_send_local_file` 工具。语音输入测试还会把浏览器录音经同一份 QQ 配置发送到本地转写服务。QQ 工作区选择测试会打开一个预置机器人的目录操作，并固定真实 Host 后端返回的应用内目录列表快照。

## 产物说明

dsh-im 压缩包包含源码与 MIT 许可证。cron 压缩包包含编译后的 `lib/`、组合补丁、README 与 MIT 许可证。更新任一固定压缩包时，必须同时审阅其可执行依赖闭包、出处、许可证与发行组合行为。
