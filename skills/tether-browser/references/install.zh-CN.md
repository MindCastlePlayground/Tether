# 安装 Skill 及其 MCP 服务

[English](install.md)

优先使用已有安装的 `installation.json` 定位文件。`tether` 服务通过 `mcpCommand` 启动；`runtime` 包含扩展、`.local` 凭据、已构建服务和独立 Python 环境。定位文件只含路径，不含令牌。Agent 的工具前缀各不相同，应发现 Tether 工具，不要假定固定前缀。

在检出仓库的根目录运行：

```powershell
npm ci
node bin/tether.mjs install --agent codex --dry-run
node bin/tether.mjs install --agent codex
```

`--agent` 可省略或设为 `auto`，自动检测并配置已安装的宿主（`codex`、`claude`、`cursor`、`opencode`、`gemini`）；也可用逗号分隔的名称限定范围。默认用户范围对所有项目生效；仅当用户只想配置某个项目时才使用 `--scope project --project PATH`。不要因为支持所有宿主就替用户全选。`--runtime PATH` 复用已配置的原型。否则 Windows 安装器会在 `%LOCALAPPDATA%\Tether\runtime` 准备持久运行目录、构建 MCP/Native Host 启动器、创建独立 Python 环境，并注册 Chrome/Edge Native Messaging。安装成功后默认打开扩展管理页和扩展目录；`--no-open` 可关闭。安装器本身不会启动 Broker；MCP 服务会在需要时自动拉起，`BB_BROKER_AUTOSTART=0` 可关闭自动拉起。检测到旧版本 runtime 时会提示运行 `tether upgrade`，升级会替换源码并保留 `.local` 和扩展 ID。已有配置项或 Skill 文件冲突时停止；保留用户改动并解决具体冲突。

根包尚未发布到 npm。在已安装 CLI 依赖的检出仓库内，`npm pack --pack-destination work` 会生成 `work/mindcastleplayground-tether-0.1.0.tgz`。npx 用法：

```powershell
npx --yes --package ./work/mindcastleplayground-tether-0.1.0.tgz tether install --agent codex --project PATH
```

将 `PATH` 替换为实际目标路径。完整双语用户指南位于 `<checkout>/docs/INSTALL.md` / `INSTALL.zh-CN.md`；复制的 Skill 不意味着仓库就在它旁边。

安装后重启/重新加载 Agent，并手动加载浏览器扩展。在检出仓库触发扩展管理页与目录：

```powershell
node bin/tether.mjs extension --runtime PATH --browser chrome --open-browser
```

此处 `PATH` 为已安装 runtime。用户启用开发者模式，点击**加载已解压的扩展程序**并选择其 `extension` 目录。命令可能启动所选浏览器，仅在用户要求配置浏览器时使用。扩展加载与 MCP 工具发现不能证明实时连接成功。仅在用户明确要求保持 Broker 停止时设置 `BB_BROKER_AUTOSTART=0`；否则 MCP 服务会在需要时自动拉起 Broker。`capabilities` 验证或手动启动见[连接设置](setup.zh-CN.md)。

使用 `--extension-dir PATH` 指定独立扩展目录，后续升级会记住此位置。`install --upgrade` 升级托管 runtime 和所选 Skill；`--force` 备份后覆盖冲突的 Tether 文件和配置，并重装 runtime。可先用 `--dry-run` 预览，完成后在浏览器重新加载扩展。
