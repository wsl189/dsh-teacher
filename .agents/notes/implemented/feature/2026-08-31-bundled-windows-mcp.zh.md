# Agent Note：内置 Windows-MCP 桌面控制

状态：已实现

[English](2026-08-31-bundled-windows-mcp.md) | 中文

## 问题

Windows-MCP 可以自动操作可见 Windows 应用，但若把用户提供的 Python 仓库当作普通用户配置 MCP 服务器，就无法形成安装即用的桌面能力。用户仍需安装和维护 Python、包环境、Windows-MCP 与匹配的 MCP 配置项。桌面安装包也无法证明其中的 Python 依赖闭包、原生 wheel 或上游工具表面与已审阅版本一致。

挂载全部上游工具会授予远超可见 UI 自动化所需的权限。PowerShell、注册表、进程、剪贴板、文件系统、通知与抓取操作会与现有 DSH 能力重叠，或绕开其策略。即使保留的鼠标、键盘、截图与 UI Automation 操作也发生在 DSH 沙箱之外，不能无提示地开放。

上游 0.8.5 依赖声明还会导入 GPL 许可的 `fuzzywuzzy`，并包含它可选的 Levenshtein 加速闭包。把这些发行包放进整体采用 MIT 许可的安装器会增加不必要的发行义务，因为 MIT 许可的 TheFuzz/RapidFuzz 闭包已经提供相同 API。

## 决策

`@deepseek-ai/dsh-windows-mcp` 是位于 `packages/mcp/windows-mcp` 的 Host 组合插件。发行 Web profile 会挂载它，但保持关闭。当 `windows-mcp` 设置命名空间变为启用时，它会为 `@deepseek-ai/dsh-mcp-client` 创建真实 Loader 子项；关闭或修改运行时字段时，会先移除并 join 当前子项，再协调新的状态。运行时缺失或子项启动失败时，不会发布任何桌面工具，并会记录错误而不让 Host 启动失败。这项失败策略会保留持久化启用设置的可访问性，使用户能够关闭它，或在修复载荷后重试。

组合只会在固定 `mcp__windows__` 命名空间下发布 `App`、`Click`、`DisplayInventory`、`Move`、`MultiEdit`、`MultiSelect`、`Screenshot`、`Scroll`、`Shortcut`、`Snapshot`、`Type`、`Wait` 与 `WaitFor`。allowlist 会独立传给 Windows-MCP 的 `--tools` 参数和 MCP 桥接层新增的精确、区分大小写 `includeTools` 过滤器。通用桥接会在过滤前校验已发布名称是否重复，因此无效上游列表不能把重复项藏在所选子集之外。任何进入保留命名空间的未审阅名称都会被拒绝。

每次所选工具调用都会先把决定委托给下游 `tools/pre-execute` 策略。拒绝仍为最终决定；下游允许则转为批准请求，明确说明 Windows 桌面自动化可以读取或控制 DSH 沙箱之外的应用。只有用户通过普通 interaction 路径批准后，MCP 子进程才会执行调用。

Windows x64 桌面构建会从官方 CPython 3.14.7 AMD64 嵌入式压缩包和 Windows-MCP 0.8.5 wheel 装配 `apps/desktop/runtime/windows-mcp`。`third-party/windows-mcp/runtime.json` 记录版本、源码身份、URL、SHA-256 摘要与本地补丁摘要。`requirements.lock` 会按哈希固定完整且仅含二进制 wheel 的闭包；pip 使用 `--require-hashes`、`--only-binary=:all:` 与 `--no-deps`。构建会应用 `patches/use-thefuzz.patch`，把唯一的 `from fuzzywuzzy import process` 导入替换为 `from thefuzz import process`，并排除 `fuzzywuzzy`、`Levenshtein` 与 `python-Levenshtein`。若这些包重新出现、TheFuzz 消失，或固定补丁在未更新元数据时发生变化，第三方声明生成器会失败。

运行时构建会完成真实 FastMCP stdio initialize/list/call 冒烟，要求工具集恰好为这十三项，并成功执行无副作用的 `Wait` 调用。Electron-builder 把生成目录复制到 `resources/windows-mcp`；载荷门禁要求存在 CPython、标准库压缩包及许可证、Windows-MCP 元数据和代表性的 Python 原生模块。安装版桌面启动会忽略环境中的 `DSH_WINDOWS_MCP_*` 覆盖，并且只在 `resources/windows-mcp/python.exe` 存在时提供环境路径。源码启动保留显式开发覆盖。

「插件」设置页拥有 Windows 桌面卡片。只有 Host 报告非空内置运行时命令时，它才能启用能力；已经启用的值始终可以关闭；沙箱外批准警告持续可见。安装版 UI 不提供可编辑 Python 路径。

## 考虑过的替代方案

**要求用户自行安装 MCP 服务器。** 这会减小安装包，却不能实现安装即用，而且独立解析的 Python 环境会偏离已审阅依赖与工具集。

**原样打包上游项目。** 这会携带未使用的 GPL 依赖，并发布桌面控制用例不需要的权限。固定本地补丁加两层独立 allowlist 校验可以同时缩小发行与运行范围。

**把桌面自动化重写为原生 TypeScript 工具。** 这会重复 Windows-MCP 的 UI Automation 与截图实现、schema 表面和 Windows 专属原生集成。现有 MCP 客户端已经拥有传输、发现、注册、结果投影与重连行为。

**默认启用该能力。** 这会为每次请求加入十三项 schema，并为没有请求该能力的用户启动沙箱外自动化进程。默认关闭可以让权限和 token 成本保持显式。

## 结果

- Windows x64 桌面用户无需安装 Python 或创建 MCP 配置即可启用集成；其他构建没有可用运行时。
- 运行时缺失或损坏不能阻止 DSH 打开；启用设置仍然可见，而工具命名空间保持缺失。
- 启用会为模型请求增加十三项工具 schema，并启动一个私有 Python MCP 子进程；关闭后无需重启 DSH 即可移除两者。
- 批准是策略门禁，不是操作系统级隔离。批准后的调用会操作交互式 Windows 会话，并且可以观察或改变可见应用。
- 上游、Python、依赖、补丁或工具表面升级构成同一个审阅单元，需要重新执行 Windows 运行时构建、冒烟、载荷校验、声明更新与安装器构建。
- 安装包会因嵌入式 Python 运行时和固定 wheel 闭包增大，但 GPL 模糊匹配包保持缺失。

## 测试

通用 MCP 测试覆盖过滤器校验、精确且区分大小写的选择、发现更新，以及过滤前的重复项拒绝。Windows 组合测试会通过 Loader 启动真实 `cordis.yml`，捕获子项配置，证明只注册十三项公开名称、未审阅名称保持缺失、批准门禁阻止执行，通过设置实时关闭子项，并证明运行时缺失或失败时设置命名空间仍然可用。客户端测试覆盖布尔字段 controller、运行时不可用状态、卡片渲染、locale 所有的文案与七卡片注册顺序。桌面环境测试证明安装版只信任 `resources/windows-mcp` 下的路径，而源码覆盖保持可用。Windows workflow 会在打包前装配并冒烟真实固定运行时，桌面载荷测试则固定其必需文件。
