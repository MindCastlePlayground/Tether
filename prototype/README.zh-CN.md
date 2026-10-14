# Tether 原型

<p align="center"><img src="../assets/logo.png" alt="Tether 标志" width="160"></p>

[English](README.md) · [项目介绍](../README.zh-CN.md) · [国际化指南](../docs/I18N.zh-CN.md)

最小原型已经实现。最终验收状态见 [VERIFICATION.zh-CN.md](VERIFICATION.zh-CN.md)；`evidence/` 分开保存模拟测试、真实协议测试和真实浏览器测试，失败记录不会算作通过。

语言与协作文档：[M0 计划](PLAN.zh-CN.md) / [English plan](PLAN.md)、[验收记录](VERIFICATION.zh-CN.md) / [English verification](VERIFICATION.md)，以及[国际化指南](../docs/I18N.zh-CN.md) / [Internationalization guide](../docs/I18N.md)。

弹窗使用 Chrome 语言消息支持英文和简体中文；用户未手动选择时跟随浏览器语言，手动选择保存在本机。语言目录和翻译流程见[国际化指南](../docs/I18N.zh-CN.md)。

Agent 使用前请阅读仓库内的 [Tether browser Skill](../skills/tether-browser/SKILL.md) 或[中文阅读版](../skills/tether-browser/SKILL.zh-CN.md)，了解会话流程和工具约定。

## 实现内容

当前链路为现有 Chrome/Edge → MV3 扩展 → Native Messaging → 本机 TLS WebSocket Broker → Node/Python SDK 或 stdio MCP。没有浏览器启动器、独立 profile、CDP TCP 端口或云端中继。默认可由客户端新建任务标签组，也可明确接管一个已有 HTTP(S) 标签。

已集成 `playwright-core 1.64.0` 的公开进程内 CDP transport、官方 `@modelcontextprotocol/sdk 1.32.1`、`ws`、`zod`；Python 使用 `websockets` 和 `cryptography`。扩展和授权状态机为本原型代码。没有复制整个上游扩展、没有私有 Playwright 补丁。`ajv` 已锁定安装，但当前验证由 zod/显式协议检查完成，不能计为已集成能力。

12 个 RPC 接口为 `requestSession`、`approvalStatus`、`listTabs`、`createTab`、`closeTab`、`release`、`observe`、`fill`、`click`、`navigate`、`capabilities`、`availableTabs`。写请求使用 session 内递增正整数 `seq`；相同序号和相同请求返回原结果，序号冲突拒绝。超时结果为不确定，SDK 不自动重放写请求。

## 当前机器运行

在本目录执行。当前配置、证书、凭据位于 `.local/`，不复制到报告、不提交。默认 Broker 只监听 `127.0.0.1:18443`，合成测试网页位于 `http://127.0.0.1:18444/`。

```powershell
npm run build
.\.local\broker.exe
```

`broker.exe` 前台命令适合终端调试；后台启动须使用 `Start-Process -WindowStyle Hidden`。Broker 尚未监听时，MCP 服务会自动拉起；`BB_BROKER_AUTOSTART=0` 可关闭自动拉起，改为手动启动。测试页用 `node scripts/fixture.mjs` 启动。服务已经监听时不要重复启动 Broker。

Chrome 打开 `chrome://extensions`，启用开发者模式，加载本目录 `extension/`，并固定 Tether。当前扩展 ID 为 `ojofdihdmmgpnaedmomclpmdkhnmbjln`。扩展后台变更后需在扩展管理页重新加载。Native Host 已注册到当前用户的 Chrome/Edge，但 Edge 本身尚未验收；未更改浏览器启动参数、系统根证书、路由或防火墙。

真实测试只操作本机合成页面。按用户偏好，已认证客户端默认自动获准新建任务组及接管指定已有标签，无需逐次批准：

```powershell
node scripts/live.mjs newGroup node
node scripts/live.mjs attachExisting node
node scripts/live.mjs newGroup mcp
```

`attachExisting` 通过 `availableTabs` 找到已有的本地合成页面，然后用 `requestSession({mode:'attachExisting',tabId})` 接管。MCP 配置中的 `command` 使用本原型目录 `.local/mcp.exe` 的绝对路径，无需服务商 API Key。启动器固定读取 `.local/agent.json`，清除继承的代理、Node 注入和其他环境变量。已实现的服务自身不调用模型。Agent 若把工具结果发送给外部模型，是调用方的数据流；要实现完整内网部署，需要另行配置内网模型。

支持 `mcpServers` 配置的客户端可使用以下示例，将路径改为实际安装路径：

```json
{
  "mcpServers": {
    "tether": {
      "command": "H:\\Documents\\Abyss\\plugins\\Tether\\prototype\\.local\\mcp.exe"
    }
  }
}
```

为兼容已有注册，内部 Native Messaging 标识保留 `com.freebird.browser_bridge`。对外产品名称、工具栏图标、弹窗、任务标签组名称及 MCP 服务身份均为 Tether。

测试最多等待 10 分钟，过期请求会重新申请，明确拒绝立即终止。脚本结束会断开授权，不会关闭用户已有页面；新建页面也保留，除测试中明确创建后关闭的附加页面。

Node SDK 从构建产物 `dist/client.js` 导入：

```js
import { BridgeClient, loadConfig } from './dist/client.js';

const client = new BridgeClient(await loadConfig('.local/script.json'));
try {
  console.log(await client.capabilities());
} finally {
  client.close();
}
```

在 session 期间保持客户端实例和连接，完成后调用 `close()`。`examples/client.ts` 是引用源码模块的 TypeScript 示例；使用构建后的 SDK 应导入 `dist/client.js`。Python 入口为 `python/client.py`：设置 `BB_CLIENT_CONFIG` 指向 `.local/python.json`，再调用 `BridgeClient.from_env()`、`call(method, params)` 和 `close()`。Python 客户端当前采用顺序同步调用，不应由多个线程共享。

## 新机器初始化

Windows 推荐通过仓库根目录的 Tether CLI 安装；Agent 选择、配置位置和加载扩展说明见[安装指南](../docs/INSTALL.zh-CN.md)。要求 Node.js 22+ 和 Python 3.10+，且 Broker 保持停止。CLI 也支持通过 `--runtime` 复用现有配置。

手动初始化或恢复时，在本目录执行以下命令。它们直接安装原型 runtime，不会配置 Agent MCP 项：

```powershell
npm ci
python -m pip install -r python/requirements.txt
python scripts/setup.py
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/launchers.ps1
& ./scripts/register.ps1
npm run build
```

在现有浏览器中将 `extension/` 作为未打包扩展加载。全新初始化会生成本机扩展密钥/ID 并更新 `manifest.json`；应使用该机器生成的 ID，而不是 README 中历史遗留的 ID。初始化会保留已有配置。为兼容注册流程，内部 Native Messaging 标识符仍为 `com.freebird.browser_bridge`。这些命令不会启动 Broker。
## 原生主机故障排查

弹窗会显示 Broker 连接状态及恢复提示；Native Messaging 断开时会读取 `runtime.lastError`。能够启动的 host 会在以退出码 1 结束前发送带长度前缀的诊断消息，stderr 只输出固定错误码。安装或加载扩展不会启动 Broker。

| 错误 | 解决步骤 |
| --- | --- |
| `broker_unavailable` | 启动已配置的 MCP 客户端并启用 `BB_BROKER_AUTOSTART`，或在已安装 runtime 目录运行 `node dist/broker.js .local/broker.json`。扩展会自动重连。 |
| `host_config_failed` / `host_origin_mismatch` | 在仓库根目录运行 `node bin/tether.mjs doctor --runtime <runtime>`。恢复配套 runtime/配置并加载其 `extension/`，核对扩展 ID 与 `.local/native-host.json`。 |
| `broker_tls_failed` | 检查系统时间、证书和 pin 是否配套。初始化证书有效期为 30 天；过期后请停止 Broker、备份 runtime，在新目录安装、更新 Agent 配置并加载新扩展。初始化会保留已有证书，重跑不会续期。 |
| `broker_auth_failed` / `broker_disconnected` | 检查 Broker 终端错误，确认运行中的 Broker 与 host 属于同一 runtime 和配置，再重启正确的 Broker。 |
| `native_host_failed` | Node 或原生启动器可能尚未启动。检查弹窗显示的浏览器错误、Node.js 可用性及已注册的可执行文件路径；恢复已安装 runtime，重跑其 `scripts/register.ps1` 后重新加载扩展。 |
| `native_frame_invalid` | 同步更新 runtime 和扩展，将消息限制在 512 KiB 以内。 |

源码更新后需重新构建已安装 runtime 并重新加载其扩展。在本目录运行诊断测试：`node --test --test-isolation=none test/host.test.mjs test/extension.test.mjs test/i18n.test.mjs`；host 测试依赖本地初始化证书，使用临时回环测试服务器，不连接运行中的 Broker。

## 授权和网络边界

- `newGroup` 默认自动授权已认证身份控制任务页面、创建最多 10 个当前会话页面，以及在这些页面进行 HTTP(S) 导航和网站操作。工具栏可关闭自动批准；关闭后新请求需手工批准。开关保存在 `chrome.storage.local`，扩展重新加载后保持不变。标签组仅用于展示；实际权限按 client/session/page 授予。
- 自动批准开启时，已认证客户端可用 `availableTabs` 读取已有 HTTP(S) 标签的标题、URL、ID，并用 `attachExisting` 指定 `tabId` 自动接管。`attachExisting` 仅把该指定页面交给会话控制，不是创建新标签组；该页面保留原位置，也不授权同组其他页面。同一页面不能被两个会话同时占用。拖入页面不会得到授权，页面离开授权时的组会撤销。只有本会话创建的页面才允许关闭。
- 撤销、客户端断连、Native 断连或租约过期会使当前授权失效；自动批准开启时，客户端仍可另行申请会话。若需阻止后续自动授权，应先关闭自动批准，再撤销已有会话。关闭开关也会拒绝 `availableTabs`，但不会撤销已经建立的会话。公开 RPC 不提供切换自动策略或直接调用批准函数的接口。未知 CDP、跨页面 ID、原始 CDP、全局 Cookie/Storage 接口均不公开。
- 扩展 CSP 禁止自身网络连接；桥接/SDK 只使用明确的回环或 RFC1918 数字地址，验证证书和 SPKI pin，不走代理、不跟随重定向。网页来源 Origin 会被拒绝。Native Host 角色只能从回环连接。
- 调试错误只记录操作/方法名，不记录 URL、正文、凭据或原始 CDP 内容。当前没有遥测、崩溃上报或在线自动更新代码。

上述边界不把“同一 Windows 用户下的恶意进程”当作可隔离对象；此类进程可以读取该用户凭据或修改安装代码。未经授权的浏览器扩展、系统抓取以及浏览器自身同步也不在本原型控制范围；按用户指令进行的网站通信属于需求范围。

## M0 未实现

OOPIF 自动连接、弹窗自动授权、文件上传下载、大消息分块、完整 ref 协议、崩溃后 debugger 残留持久化清理、安装包签名和自动证书轮换均未实现。512 KiB 以上消息会被拒绝；本原型不是大页面完整导出接口。选择器交互由 Playwright 完成，不开放通用 `evaluate` 或任意 CDP。

Chrome debugger 限制了可用 CDP domain；版本元数据来自扩展的 userAgent，revision/jsVersion 未知。参见 [Chrome 官方 debugger 文档](https://developer.chrome.com/docs/extensions/reference/api/debugger#restricted-domains)。

## 验收证据范围

真实 Chrome 页面控制验收使用 Node SDK 和官方 MCP Client。Python 已通过真实 Broker 的安全及连续调用检查，但尚未单独验收 Python SDK 直接执行页面操作。尚未用第二台局域网机器测试。TCP 快照和连接限制检查不足以证明整个浏览器 profile 完全没有外部流量。分层证据见 [VERIFICATION.md](VERIFICATION.md)。

## 检查命令和验收证据

仅验证品牌变更时，Broker 可以保持关闭：

```powershell
npm run build
node --test --test-reporter=dot test/extension.test.mjs
node scripts/brand-preview.mjs
```

预览使用隔离的无头 Chrome 和模拟扩展 runtime，不连接 Native Messaging 或启动 Broker；截图和验证报告写入 `../assets/`。以下完整检查会包含网络服务，需要先完成上述初始化。

```powershell
npm test
python -m unittest discover -s test -p python_test.py -v
node scripts/mcp-smoke.mjs
node scripts/lan-smoke.mjs
```

`native-smoke.mjs` 使用真实 native exe 和模拟扩展对端；仅在真实扩展未连接时运行。测试不绕过真实工具栏授权。`network-sample.ps1` 只做少量 TCP 端点采样，不是抓包或零外传证明。验收日期、结果和证据限制见 [VERIFICATION.md](VERIFICATION.md)。

MCP 工具说明和初始化、注册、启动器生成提示也支持 `BB_LANGUAGE=en` 或 `BB_LANGUAGE=zh-CN`；配置方法见国际化指南。
