# 安装 Tether

[English](INSTALL.md) · [项目介绍](../README.zh-CN.md) · [原型指南](../prototype/README.zh-CN.md)

已测试行为与待验证项见[安装器验收](INSTALL-VERIFICATION.zh-CN.md)。

仓库根目录的 npm 包为私有包，尚未发布到 npm。请使用本地检出目录或下方本地 tarball 流程；目前不能通过公共仓库执行 `npx @mindcastleplayground/tether`。全新 runtime 安装支持 Windows、Node.js 22+ 和 Python 3.10+。`--runtime` 可复用已配置的原型，并跳过依赖安装和初始化。

## 从检出目录安装

在仓库根目录一条命令安装（默认自动检测 Agent）：

```powershell
npm ci
node bin/tether.mjs install
```

`--agent` 可省略，默认为 `auto`：自动检测已安装的 `codex`、`claude`、`cursor`、`opencode`、`gemini` 宿主并全部配置；也可传入逗号分隔的名称限定范围。`--scope` 默认为 `project`，`--project` 默认当前目录；`--scope user` 跨项目安装。持久化 home 默认为 `%LOCALAPPDATA%\Tether`，runtime 位于 `%LOCALAPPDATA%\Tether\runtime`。全新安装会复制原型、安装锁定版本的 Node 依赖并构建、创建隔离的 Python 环境和安装 Python requirements、生成本地凭据/证书、编译启动器，并在当前 Windows 用户的 HKCU 下同时注册 Chrome 与 Edge Native Messaging。安装成功后默认打开扩展管理页和扩展目录；`--no-open` 可关闭；找不到浏览器时只打印提示。安装器本身不会启动 Broker；MCP 服务会在需要时自动拉起（见下文）。

安装器只添加 Tether MCP 配置，并复制完整的 `skills/tether-browser/` 文件夹及不含秘密的 `installation.json` 定位文件。现有配置中的注释和其他键会保留；修改配置时会在同目录创建备份。若发现冲突的 Tether 配置项或已有技能文件，安装器会停止；没有强制覆盖选项。同一版本重复安装是幂等的。检测到旧版本 runtime 时，安装器会提示运行 `tether upgrade`：

```powershell
node bin/tether.mjs upgrade [--home PATH | --runtime PATH]
```

升级会替换 runtime 源码，保留 `.local`（凭据、证书、策略）和 `.venv`，扩展 ID 保持不变，重新执行 `npm ci`/构建和 Python 安装，且不改动 Agent 配置。

传入 `--runtime PATH` 可复用已配置的原型目录。此时跳过 runtime 复制、依赖安装、构建、Python 初始化和凭据生成；除非提供 `--no-register`，仍会注册 Native Messaging。`--no-register` 跳过 HKCU 注册。`--python PATH` 指定全新隔离环境使用的 Python，`--language en|zh-CN` 设置 MCP 描述与初始化提示语言。

使用 `--dry-run` 预览路径和配置改动计划，不修改磁盘或进程：

```powershell
node bin/tether.mjs install --agent codex --dry-run
```

`doctor` 只报告 runtime 元数据及预期文件，不检查连接，也不启动 Broker：

```powershell
node bin/tether.mjs doctor --home "$env:LOCALAPPDATA\Tether"
```

## Agent 配置位置

| Agent | 项目配置与技能 | 用户配置与技能 |
| --- | --- | --- |
| Codex | `.codex/config.toml`；`.agents/skills/tether-browser/` | `CODEX_HOME/config.toml`（或 `~/.codex/config.toml`）；`~/.agents/skills/tether-browser/` |
| Claude Code | `.mcp.json`；`.claude/skills/tether-browser/` | `~/.claude.json`；`~/.claude/skills/tether-browser/` |
| Cursor | `.cursor/mcp.json`；`.cursor/skills/tether-browser/` | 用户 home 下的相同路径 |
| OpenCode | `opencode.json` 或 `opencode.jsonc`；`.opencode/skills/tether-browser/` | `$XDG_CONFIG_HOME/opencode/` 或 `~/.config/opencode/` 下的配置和技能 |
| Gemini CLI | `.gemini/settings.json`；`.gemini/skills/tether-browser/` | 用户 home 下的相同路径 |

已安装技能会优先使用已配置的 Tether MCP 工具。必要时读取 `installation.json` 来定位 runtime；不会根据技能目录推断检出目录。安装后请重启或重新加载 Agent。项目配置包含当前机器的绝对路径；跨仓库的个人安装可选择用户范围。每个浏览器/用户只有一个 Tether Native Messaging 注册：注册另一个 runtime 会将该注册切换到新目录，因此需要加载与之匹配的扩展。

## 加载浏览器扩展

默认安装会注册 Chrome 和 Edge 的 Native Messaging，但需要用户手动加载扩展。运行以下命令打开扩展管理页和已安装扩展目录：

```powershell
node bin/tether.mjs extension --runtime "$env:LOCALAPPDATA\Tether\runtime" --browser edge --open-browser
```

启用开发者模式，选择**加载已解压的扩展程序**，再选择显示的扩展目录。这一步需要在浏览器中手动完成；Tether 不会静默安装扩展，也不会发布到浏览器商店。`--browser chrome|edge` 选择打开哪个管理页。

安装后重启/重新加载 Agent，并打开 Tether 工具栏弹窗。Broker 尚未运行时，MCP 服务会自动拉起并最多等待 10 秒；设置 `BB_BROKER_AUTOSTART=0` 可关闭自动拉起，改为手动管理。连接故障排查和有意保留的手动配置备用流程见[设置参考](../skills/tether-browser/references/setup.zh-CN.md)和[原型指南](../prototype/README.zh-CN.md)。

## 权限策略

Broker 默认由策略托管：策略文件为 `<runtime>/.local/policy.json`，文件不存在表示全放行。文件热加载，修改后立即生效。规则按 first-match 匹配：

- `version` — 必须为 `1`。
- `id` — 规则唯一标识。
- `client` — `"*"` 或客户端身份。
- `origin` — `"*"` 或 `scheme://host[:port]`；host 前导 `*.` 匹配子域和裸域。
- `actions` — `session`、`availableTabs`、`observe`、`fill`、`click`、`navigate`、`createTab`、`closeTab` 或 `"*"`。
- `effect` — `allow`、`deny` 或 `ask`；`ask` 仅适用于 `actions: ["session"]`。
- `default` — 无规则匹配时为 `allow` 或 `deny`。

```json
{
  "version": 1,
  "default": "allow",
  "rules": [
    { "id": "bank-readonly", "client": "*", "origin": "https://*.bank.com", "actions": ["fill", "click", "navigate"], "effect": "deny" },
    { "id": "confirm-session", "client": "*", "origin": "*", "actions": ["session"], "effect": "ask" }
  ]
}
```

被拒请求返回 `policy_denied`。文件损坏或非法时，除 `capabilities` 外全部拒绝，错误为 `policy_invalid`（fail-closed）；`capabilities` 返回 `policy: {default, rules, valid}`。排队的写操作在执行时按页面当前 origin 重新检查。`ask` 命中的会话请求不会自动批准，需在弹窗中人工批准。

```powershell
node bin/tether.mjs policy list
node bin/tether.mjs policy add --effect deny --actions fill,click,navigate --origin https://*.bank.com [--client C] [--id ID] [--first]
node bin/tether.mjs policy remove --id ID
node bin/tether.mjs policy default allow|deny
node bin/tether.mjs policy path
node bin/tether.mjs policy reset
```

## 本地 tarball 安装

私有包尚未发布到 npm。当不在仓库工作目录时，使用本地 tarball：

```powershell
npm ci
npm pack --pack-destination work
npx --yes --package ./work/mindcastleplayground-tether-0.1.0.tgz tether install --agent codex --project PATH --home PATH
```

tarball 包含准备全新 runtime 所需的 CLI 和原型源码。通过 `npx` 使用 GitHub 源可能需要已授权的 Git 访问；有条件时优先使用本地 tarball。

## Agent 官方文档

- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) · [Codex Skills](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp) · [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Cursor MCP](https://cursor.com/docs/context/mcp) · [Cursor Skills](https://cursor.com/docs/skills)
- [OpenCode MCP 服务](https://opencode.ai/docs/mcp-servers/) · [OpenCode Skills](https://opencode.ai/docs/skills/)
- [Gemini CLI MCP 服务](https://geminicli.com/docs/tools/mcp-server/) · [Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)
