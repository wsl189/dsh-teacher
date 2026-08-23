# 第三方插件

[English](README.md) | 中文

本目录保存 dsh-teacher 部署所需的第三方定制插件安装包。这些插件**不属于项目源码**，是独立安装到 `~/.dsh/profiles/web/`（每台机器的用户级目录）的，因此克隆项目后需要重新安装。

## 插件清单

| 目录 | 安装包 | 版本 | 来源 | 说明 |
|---|---|---|---|---|
| `dsh-im/` | `xmanrui-dsh-im-1.0.3.tgz` | 1.0.3 | 基于 [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) 的定制版（官方 npm 最新为 1.0.2） | 连接 QQ/微信/飞书/钉钉/企业微信等 9 种 IM 平台；定制新增：QQ 图片/文件发送、移动提醒推送、语音转文字 |
| `dsh-plugin-cron/` | `dsh-plugin-cron-0.1.3.tgz` | 0.1.3 | 基于 npm 官方 `dsh-plugin-cron` 0.1.3 的定制版 | cron 定时任务调度；定制修改：侧边栏交互、折叠侧栏、工作台提醒投影 |

> 两个安装包均为定制版，与官方发布内容不一致，请使用本目录内的 tgz，不要从 npm/GitHub 直接安装官方版（会缺少定制功能）。

## 安装步骤（新电脑部署）

```bash
# 1. 安装 dsh-im（IM 连接：QQ 等）
dsh plugin --profile web add third-party/dsh-im/xmanrui-dsh-im-1.0.3.tgz

# 2. 安装 cron 定时任务插件
dsh plugin --profile web add third-party/dsh-plugin-cron/dsh-plugin-cron-0.1.3.tgz

# 3. 恢复 profile 配置（QQ 可发送文件目录等）
#    把 dsh-im/cordis.patch.yml.example 的内容合并进 ~/.dsh/profiles/web/cordis.patch.yml
```

### 验证

安装后重启 web 服务，检查：

- QQ 机器人可收发消息（dsh-im）
- 定时任务侧边栏入口出现（dsh-plugin-cron）
- 教师工作台的待办/备忘/账本提醒可选手机推送平台（dsh-im mobileNotifications）
- 模型侧可用 `qq_send_local_file`、`cron_add` 等工具

## 与官方版的差异摘要

### dsh-im（官方 1.0.2 → 定制 1.0.3）

新增文件：

- `src/channels/qq/outbound-media.mjs`：`qq_send_local_file` 工具，向 QQ 会话发送图片/文件
- `plugin-src/host/mobile-notifications.mjs`：`ctx.mobileNotifications` 服务，供教师工作台推送手机提醒
- `src/channels/qq/speech-transcriber.mjs`：QQ 语音消息转文字（Whisper）

另有 40+ 文件与官方版有差异（控制器、桥接、客户端等）。

### dsh-plugin-cron（官方 0.1.3 → 定制 0.1.3）

- 侧边栏入口位置与交互调整（显示启用/运行中任务数，点击直接右侧打开）
- 折叠侧栏支持（保留时钟图标）
- 管理页「操作手册」「新增定时任务」默认收起
- 安装教师工作台时，定时任务列表只读投影其未完成手机提醒

> 注意：cron 定制版安装包内仅有编译产物 `lib/`，不含源码目录；dsh-im 定制版 tgz 内含完整 `src/` 源码。

## 配置参考

`dsh-im/cordis.patch.yml.example` 内容（可发送文件根目录按需修改）：

```yaml
- id: xmanrui-dsh-im
  config:
    qq:
      outboundMediaRoots:
        - /home/wsl/Desktop
```
