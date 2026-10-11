# 安装 Skill 及其 MCP 服务

[English](install.md)

优先使用已有安装的 `installation.json` 定位文件。`tether` 服务通过 `mcpCommand` 启动；`runtime` 包含扩展、`.local` 凭据、已构建服务和独立 Python 环境。定位文件只含路径，不含令牌。Agent 的工具前缀各不相同，应发现 Tether 工具，不要假定固定前缀。

在检出仓库的根目录运行：

```powershell
npm ci
node bin/tether.mjs install --agent codex --scope project --project PATH --dry-run
node bin/tether.mjs install --agent codex --scope project --project PATH
```

选择用户使用的宿主：`codex`、`claude`、`cursor`、`opencode` 或 `gemini`；逗号分隔可安装多个。项目范围只修改目标项目；`--scope user` 跨项目安装。不要因为支持所有宿主就替用户全选。`--runtime PATH` 复用已配置的原型。否则 Windows 安装器会在 `%LOCALAPPDATA%\Tether\runtime` 准备持久运行目录、构建 MCP/Native Host 启动器、创建独立 Python 环境，并注册 Chrome/Edge Native Messaging。它不会启动 Broker。已有配置项或 Skill 文件冲突时停止；保留用户改动并解决具体冲突。

根包尚未发布到 npm。在已安装 CLI 依赖的检出仓库内，`npm pack --pack-destination work` 会生成 `work/mindcastleplayground-tether-0.1.0.tgz`。npx 用法：

```powershell
npx --yes --package ./work/mindcastleplayground-tether-0.1.0.tgz tether install --agent codex --project PATH
```

将 `PATH` 替换为实际目标路径。完整双语用户指南位于 `<checkout>/docs/INSTALL.md` / `INSTALL.zh-CN.md`；复制的 Skill 不意味着仓库就在它旁边。

安装后重启/重新加载 Agent，并手动加载浏览器扩展。在检出仓库触发扩展管理页与目录：

```powershell
node bin/tether.mjs extension --runtime PATH --browser chrome --open-browser
```

此处 `PATH` 为已安装 runtime。用户启用开发者模式，点击**加载已解压的扩展程序**并选择其 `extension` 目录。命令可能启动所选浏览器，仅在用户要求配置浏览器时使用。扩展加载与 MCP 工具发现不能证明实时连接成功。遵守保持 Broker 关闭的要求；否则按照[连接设置](setup.zh-CN.md)执行单独获准的启动和 `capabilities` 验证。
