# Tether 运行指南

<p align="center"><img src="../assets/logo.png" alt="Tether 标志" width="160"></p>

[English](README.md) · [项目介绍](../README.zh-CN.md) · [安装指南](../docs/INSTALL.zh-CN.md) · [国际化指南](../docs/I18N.zh-CN.md) · [验收摘要](VERIFICATION.zh-CN.md)

`prototype/` 是为兼容路径而保留的历史目录名，当前运行时源码位于此处：浏览器扩展、Broker、Native Messaging 主机、MCP 服务、Node 和 Python SDK，以及初始化/构建脚本。公开安装流程见[安装指南](../docs/INSTALL.zh-CN.md)。

## 运行时与协议

数据链路为现有 Chrome 浏览器 → MV3 扩展 → Native Messaging → 本机 TLS WebSocket Broker → Node/Python SDK 或 stdio MCP。Broker 默认仅监听回环地址。客户端可新建任务标签组，或明确接管一个已有 HTTP(S) 标签。为兼容已有注册，内部 Native Messaging 标识符仍为 `com.freebird.browser_bridge`。

运行时提供 12 个 RPC 方法：`requestSession`、`approvalStatus`、`listTabs`、`createTab`、`closeTab`、`release`、`observe`、`fill`、`click`、`navigate`、`capabilities` 和 `availableTabs`。写请求使用 session 内递增的正整数 `seq`；相同请求重复提交会返回原结果，冲突复用会被拒绝。请求超时的结果不确定，因此 SDK 不会自动重放写操作。

扩展和授权状态机由 Tether 自行实现。依赖包括 `playwright-core` 的公开进程内 transport、官方 MCP SDK、`ws` 和 `zod`；Python 使用 `websockets` 和 `cryptography`。协议校验使用 zod 与显式检查。

## 从检出目录构建和运行

要求 Node.js 22+ 和 Python 3.10+。在本目录执行初始化；配置、证书、凭据和生成的可执行文件应放在本地 runtime 目录中，不要提交。

```powershell
npm ci
python -m pip install -r python/requirements.txt
python scripts/setup.py
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launchers.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register.ps1
```

在现有浏览器中将 `extension/` 作为未打包扩展加载，并选择包含 `manifest.json` 的目录。每次初始化都会生成自己的扩展身份。运行本地构建的 Broker 时，使用本地 runtime 目录中生成的可执行文件。可用 `node scripts/fixture.mjs` 启动测试页。

推荐使用仓库根目录的 Tether CLI 安装并配置 Agent，流程见[安装指南](../docs/INSTALL.zh-CN.md)。加载扩展后会启用默认的 `auto` Broker 管理。MCP 和 Native Host 可为同一 runtime 启动 Broker；共享 runtime 模式为 `off` 时，MCP 不会再次启动。生命周期探测与重试说明见 [v1.0.0 发布说明](../docs/RELEASE-v1.0.0.zh-CN.md)。

## SDK 使用

Node SDK 从 `dist/client.js` 导入：

```js
import { BridgeClient, loadConfig } from './dist/client.js';

const client = new BridgeClient(await loadConfig('<runtime>/.local/script.json'));
try {
  console.log(await client.capabilities());
} finally {
  client.close();
}
```

在整个 session 中保持同一个客户端实例，结束后调用 `close()`。`examples/client.ts` 展示了如何导入源码模块。Python 入口为 `python/client.py`；将 `BB_CLIENT_CONFIG` 设为 runtime 的 Python 配置路径，再使用 `BridgeClient.from_env()`、`call(method, params)` 和 `close()`。Python 调用为同步顺序执行；不要让多个线程共享同一个实例。

对于使用 `mcpServers` 的 MCP 客户端，将占位符替换为已安装启动器的绝对路径：

```json
{
  "mcpServers": {
    "tether": {
      "command": "<runtime>/.local/mcp.exe"
    }
  }
}
```

## 授权与边界

已认证客户端按配置获得任务页权限，或获得对明确指定的一个现有标签页的权限。页面访问按 client、session 和 page 限定。多个客户端（如同时运行的多个 Agent）可使用同一凭据连接；每个连接成为独立实例（`<身份>#<编号>`），策略规则仍按凭据身份匹配，连接关闭时释放其 session。session 清理不会关闭已有页面；只有该 session 创建的页面可以关闭。关闭自动批准会阻止新的自动授权，但不会撤销已有 session。

保持 TLS 和证书 pin 校验开启。Native Host 角色仅接受回环连接。扩展会阻止自身发起网络连接；页面导航仍会按请求与网站通信。这些控制不代表整个浏览器 profile 完全没有外部流量，也不能隔离同一用户下的其他进程。已测试流程与限制见带日期的[验收摘要](VERIFICATION.zh-CN.md)。

## 故障排查

弹窗会显示 Broker 连接状态和恢复提示。检查扩展与 runtime 是否使用匹配的配置、证书和 pin；升级时应同时更新浏览器扩展和 runtime。各版本结果见[安装验收记录](../docs/INSTALL-VERIFICATION.zh-CN.md)和[发布说明](../docs/RELEASE-v1.0.0.zh-CN.md)。
