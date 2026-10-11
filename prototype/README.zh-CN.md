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

`broker.exe` 前台命令适合终端调试；后台启动须使用 `Start-Process -WindowStyle Hidden`。测试页用 `node scripts/fixture.mjs` 启动。服务已经监听时不要重复启动 Broker。

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

需要 Node、Windows PowerShell、Python 3.12 及 Python requirements。首次安装依赖需要访问包仓库；运行阶段不下载组件。版本由 lockfile 固定。

```powershell
npm ci
python -m pip install -r python/requirements.txt
python scripts/setup.py
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/launchers.ps1
& ./scripts/register.ps1
npm run build
```

`setup.py` 在写入凭据前限制 `.local/` ACL；已存在配置不会覆盖。新配置会生成新扩展 ID 并同步到 manifest。证书有效期为 30 天，目前没有自动轮换。`launchers.ps1` 保留已有 exe；更新启动器前，应先停止本原型对应进程，再只删除 `.local/{host,broker,mcp}.exe` 并重建。

局域网部署需要显式选择：首次生成证书前设置 `BB_LAN_IP` 为实际 RFC1918 地址；Broker 配置添加 `lan: {ip, port, cidrs}`。客户端证书和 SPKI pin 必须匹配该地址；每个远程调用身份使用单独凭据，只分发该客户端配置和公有证书，不分发 `server.key`、`host.json` 或其他角色凭据。默认没有 LAN 监听。本次验收临时使用 `192.168.3.7:18450`，测试结束后已关闭。

## 授权和网络边界

- `newGroup` 默认自动授权已认证身份控制任务页面、创建最多 10 个当前会话页面，以及在这些页面进行 HTTP(S) 导航和网站操作。工具栏可关闭自动批准；关闭后新请求需手工批准。开关当前只在后台存活期间保存，扩展重新加载恢复默认开启。标签组仅用于展示；实际权限按 client/session/page 授予。
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
