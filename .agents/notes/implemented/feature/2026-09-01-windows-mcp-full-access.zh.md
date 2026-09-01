# Agent Note: 按会话控制 Windows-MCP Full access

Status: implemented

[English](2026-09-01-windows-mcp-full-access.md) | 中文

## 问题

Full access 把 `danger-full-access` 与批准策略 `never` 组合在一起。因此，无条件请求批准的 Windows-MCP 策略会拒绝每次调用：`never` 禁止弹出批准请求，而不是授予请求。明确选择完整电脑控制的用户还需要固定服务器提供的系统工具，而仅桌面工具目录会排除这些能力。全局启用该目录不能把同等权限授予共用 Host 的受限会话。

## 决策

本记录取代[内置集成记录](2026-08-31-bundled-windows-mcp.zh.md)中仅提供桌面工具目录和无条件批准的决策。原记录继续拥有私有固定 Python 运行时、许可、载荷验证与 Loader 生命周期。[默认开启桌面控制](2026-09-01-windows-mcp-default-on.zh.md)拥有启用方式与已保存用户选择的规则；[隐藏设置卡片](../simplification/2026-09-01-hide-windows-mcp-settings-card.zh.md)拥有通用设置呈现。

内置客户端发现 Windows-MCP 0.8.5 的完整二十项工具目录。Python 的 `--tools` 列表与桥接层的 `includeTools` 过滤器共同固定该目录；未来新增或未知名称仍会被拒绝。十三项桌面工具在受限模式中仍可经批准使用。PowerShell、Registry、Process、Clipboard、FileSystem、Notification 与 Scrape 要求 Full access。

只有调用会话最新记录的 `sandbox/mode` 能授予 Full access。发行权限预设会在该日志中记录初始默认值与实时切换。批准策略 `never`、预设标签、进程环境、其他会话以及缺失的会话状态都不能授予权限。Full access 只免除 Windows-MCP 自身的额外批准；下游拒绝与批准请求仍然生效，包括 `never` 对必需批准请求的常规自动拒绝。

MCP 子项活动期间，作用域工具限制会向受限 agent（智能体）隐藏系统工具。agent 创建、模式事件与 MCP 工具发现会协调这些限制，无需重启 Python。共享工具注册表将同一作用域视图用于 schema、查找、原生执行与 PTC 分派。执行策略会在下游策略完成后独立检查已记录模式；即使其他监听器允许调用，只允许拒绝的守卫仍会拒绝未获得 Full access 的系统调用。其他工具与其他会话保持既有策略。子项成功移除后，插件才能释放策略注册。

Windows-MCP 包与桌面文档会说明完整系统授权。Windows-MCP 使用既有 Windows 进程权限运行；Full access 不会提供管理员令牌，也不能绕过 UAC 和安全桌面。模式降级会限制后续调用，但不会撤销已经开始的操作。

## 考虑过的替代方案

**把 `never` 当作批准。** 这会改变共享安全规则，并让无关策略仅因不允许应答方而授予请求。桌面插件只在会话授予 Full access 时移除自身请求。

**任意会话具有 Full access 时解锁全局工具集。** 某个用户的权限选择会影响并行运行的受限会话。逐会话限制与执行检查让授权保持局部，同时共用一个 MCP 进程。

**Full access 仍保留十三项工具目录。** 这能允许可见桌面操作，却无法提供明确请求的完整 Windows-MCP 功能。固定二十项工具目录让扩展保持有限且可审阅。

**只依赖隐藏 schema。** 模型可以复用先前公布的名称，而作用域注册能够覆盖全局工具。因此，工具发现过滤后仍需执行检查。

## 结果

- Full access 会话可以使用全部固定桌面与系统工具，无需 Windows-MCP 专属批准；受限会话保留桌面批准，且不能逐次批准系统工具。
- 权限切换会改变对应会话的工具 schema 与请求头前缀。回放会记录这些变化；Python 进程保持共享且已连接。
- 单元测试与真实 Loader 测试覆盖模式切换、缺少授权、会话隔离、下游策略、作用域覆盖、设置启用与清理。无密钥 headless 快照使用无实际桌面操作的外部服务器，在完整、受限和降级会话中执行真实 MCP stdio；独立调用记录文件证明哪些调用到达了服务器。
- Windows 打包冒烟要求全部二十项真实工具名称，并调用无副作用的 `Wait`。Linux 测试不验证 Windows UI Automation 或安装后的 AMD64 Python 运行时；Windows workflow 拥有这部分证据。
