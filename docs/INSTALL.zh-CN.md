# 安装 Tether

[English](INSTALL.md) · [项目介绍](../README.zh-CN.md) · [原型指南](../prototype/README.zh-CN.md)

已测试行为与待验证项见[安装器验收](INSTALL-VERIFICATION.zh-CN.md)。

仓库根目录的 npm 包为私有包，尚未发布到 npm。请使用本地检出目录或下方本地 tarball 流程；目前不能通过公共仓库执行 `npx @mindcastleplayground/tether`。全新 runtime 安装支持 Windows、Node.js 22+ 和 Python 3.10+。`--runtime` 可复用已配置的原型，并跳过依赖安装和初始化。

## 从检出目录安装

在仓库根目录安装 CLI 依赖，并选择一个或多个 Agent：

```powershell
npm ci
node bin/tether.mjs install --agent codex,claude,cursor,opencode,gemini --scope project --project . --language zh-CN --browser chrome
```

必须提供 `--agent`，值为 `codex`、`claude`、`cursor`、`opencode`、`gemini` 中一个或多个逗号分隔名称。默认 `--scope project`，`--project` 默认当前目录。持久化 home 默认为 `%LOCALAPPDATA%\Tether`，runtime 位于 `%LOCALAPPDATA%\Tether\runtime`。全新安装会复制原型、安装锁定版本的 Node 依赖并构建、创建隔离的 Python 环境和安装 Python requirements、生成本地凭据/证书、编译启动器，并在当前 Windows 用户的 HKCU 下同时注册 Chrome 与 Edge Native Messaging。它不会启动 Broker。

安装器只添加 Tether MCP 配置，并复制完整的 `skills/tether-browser/` 文件夹及不含秘密的 `installation.json` 定位文件。现有配置中的注释和其他键会保留；修改配置时会在同目录创建备份。若发现冲突的 Tether 配置项或已有技能文件，安装器会停止；没有强制覆盖或升级选项。同一版本重复安装是幂等的。升级支持完成前，安装新版本时请指定新的 `--home`。

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

安装后重启/重新加载 Agent，并打开 Tether 工具栏弹窗。Broker 会保持停止，需另行启动。连接故障排查和有意保留的手动配置备用流程见[设置参考](../skills/tether-browser/references/setup.zh-CN.md)和[原型指南](../prototype/README.zh-CN.md)。

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
