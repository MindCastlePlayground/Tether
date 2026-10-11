# 连接设置与故障排查

[English](setup.md)

使用实际检出目录中的路径。在 `<checkout>/prototype` 目录下运行这些命令；不要复制其他机器的 `.local` 凭据。修改前先检查现有配置和安装。

## 已有安装

MCP 宿主通常通过绝对路径启动 `.local/mcp.exe`。对于接受 `mcpServers` 的宿主，可按如下方式配置：

```json
{
  "mcpServers": {
    "tether": {
      "command": "C:\\path\\to\\Tether\\prototype\\.local\\mcp.exe",
      "env": { "BB_LANGUAGE": "en" }
    }
  }
}
```

替换示例路径。`BB_LANGUAGE` 支持 `en` 和 `zh-CN`；省略时使用系统区域设置。启动器会加载 `.local/agent.json`。新启动器会转发语言变量；旧启动器必须按照 `<checkout>/docs/I18N.md`（或 `I18N.zh-CN.md`）中的说明重新生成。仅启动 MCP 不会启动 Broker。

在已获准启动的前提下，检查配置的 Broker 是否已在监听（默认环回端口为 18443）。仅当实例未运行时，从原型目录在隐藏窗口中启动：

```powershell
Start-Process -FilePath (Join-Path (Get-Location) '.local\broker.exe') -WindowStyle Hidden
```

如果用户要求保持停止，请勿运行此命令。不要终止其他监听进程，也不要启动重复实例。打开/固定已安装的 Tether 扩展；Native Host 会由扩展启动。安装后或修改扩展源代码后，用户可能需要在 `chrome://extensions` 或 `edge://extensions` 中加载/重新加载扩展。连接后再次检查 `capabilities` 中的 `browserConnected`。

## 全新 Windows 安装

要求：Node.js、Windows PowerShell、Python 3.12，以及现有的 Chrome/Edge 浏览器。安装依赖需要访问软件包注册表。仅当安装属于任务范围时才执行：

```powershell
npm ci
python -m pip install -r python/requirements.txt
python scripts/setup.py
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/launchers.ps1
& ./scripts/register.ps1
npm run build
```

在现有浏览器中将 `prototype/extension/` 作为未打包扩展加载。全新安装会生成本机扩展密钥/ID 并更新 `manifest.json`；应使用该机器生成的 ID，而不是 README 中历史遗留的 ID。安装过程会保留现有配置。为兼容注册流程，内部 Native Messaging 标识符仍为 `com.freebird.browser_bridge`。

不要仅将 setup 当作健康检查来执行：它会创建私密材料，并可能在全新安装时更新清单。证书有效期为 30 天，且不会自动轮换。宿主注册信息保存在当前用户的 Windows 注册表中。现有启动器可执行文件会保留；重新生成需要先停止受影响的进程，并且只替换目标生成文件。

## 诊断故障层级

| 症状 | 检查 / 后续操作 |
| --- | --- |
| MCP 工具列表可用，但浏览器调用失败 | 工具列表是离线元数据。检查 Broker 监听状态，再检查扩展/Native Host 连接。 |
| `browserConnected:false` 或 `host_unavailable` | 检查现有浏览器、已加载/启用的扩展、正确的 Native Host 注册和本地宿主可执行文件。 |
| 连接/TLS/固定校验失败 | 检查角色配置、匹配的公有证书、地址和证书有效期。保留 TLS 和固定校验。 |
| 关闭自动批准时状态为 `pending` | 请用户在工具栏中批准；不要调用不存在的审批 RPC。 |
| `not_authorized` | 检查身份、会话生命周期、页面 ID、分组和撤销状态；仅针对预期任务重新获取授权。 |
| `debugger_busy` | 可能有另一个调试器正在控制该标签页。让用户解决冲突。 |
| `outcome_unknown` | 再次写入前检查状态；绝不能假定操作没有发生。 |

运行时默认支持环回连接；LAN 是明确指定的部署选项，不是连接故障的变通方法。不要将服务暴露到网络、修改防火墙/信任设置或在浏览器任务中擅自分发凭据。只有明确要求该部署方式时，才阅读 `<checkout>/prototype/README.md`（或 `README.zh-CN.md`）。

## Broker 保持关闭时的离线检查

```powershell
npm run build
node --test --test-isolation=none --test-reporter=dot test/i18n.test.mjs test/extension.test.mjs
node scripts/brand-preview.mjs
node scripts/i18n-smoke.mjs
```

弹窗预览会启动隔离的无头测试 Chrome，并模拟扩展运行时。i18n 冒烟检查需要现有 `.local/agent.json`，且只启动 MCP stdio 进程来枚举描述。这两者都不能算作浏览器控制的实时验收。完整的 `npm test`、`mcp-smoke.mjs`、`live.mjs` 以及 Native/LAN 检查具有其他副作用；不要将它们用作离线健康检查。
