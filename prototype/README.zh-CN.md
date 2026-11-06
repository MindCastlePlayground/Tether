# Tether 运行指南

<p align="center"><img src="../assets/logo.png" alt="Tether 标志" width="160"></p>

[English](README.md) · [项目介绍](../README.zh-CN.md) · [安装指南](../docs/INSTALL.zh-CN.md) · [国际化指南](../docs/I18N.zh-CN.md) · [验收摘要](VERIFICATION.zh-CN.md)

`prototype/` 是为兼容路径而保留的历史目录名，当前运行时源码位于此处：浏览器扩展、Broker、Native Messaging 主机、MCP 服务、Node 和 Python SDK，以及初始化/构建脚本。公开安装流程见[安装指南](../docs/INSTALL.zh-CN.md)。

## 运行时与协议

数据链路为现有 Chrome 浏览器 → MV3 扩展 → Native Messaging → 本机 TLS WebSocket Broker → Node/Python SDK 或 stdio MCP。Broker 默认仅监听回环地址。客户端可新建任务标签组，或明确接管一个已有 HTTP(S) 标签。为兼容已有注册，内部 Native Messaging 标识符仍为 `com.freebird.browser_bridge`。

运行时提供浏览器、支持和业务 RPC 方法；调用 `capabilities({})` 查看当前方法。浏览器方法包括 `requestSession`、`approvalStatus`、`listTabs`、`createTab`、`closeTab`、`release`、`snapshot`、`html`、`locate`、`fill`、`click`、`navigate`、`availableTabs` 和 `network`。支持方法为 `diagnose`、`wait`、`assert`、`records`；业务方法包括 `uploadStart`、`uploadChunk`、`uploadFinish`、`uploadDrop`、`downloadStart`、`downloadRead`、`downloadDrop`、`dialog`、`popupCandidates` 和 `adoptPopup`。`snapshot` 返回带 `[ref=eN]` 元素引用的简易无障碍树；`html` 分页读取不可变的完整主文档 HTML；`locate` 列出匹配元素及经校验的唯一选择器；`fill`/`click` 接受 `ref` 或 `selector`，动作前先解析为恰好一个元素，否则以 `sideEffect:"none"` 拒绝并给出候选。策略规则把 `snapshot`、`html` 和 `locate` 等读取方法归入 `observe`。写请求使用 session 内递增的正整数 `seq`；相同请求重复提交会返回原结果，冲突复用会被拒绝。请求超时的结果不确定，因此 SDK 不会自动重放写操作。

页面读取默认使用 `snapshot`。需要完整标记或无障碍树无法提供的结构时，调用 `html({sessionId,pageId,offset?,maxChars?,captureId?})`；默认每页 16,000 字符，最大 30,000。首次请求会在浏览器内生成 `<!doctype>` 与 `document.documentElement.outerHTML` 的不可变快照，最多 8 Mi UTF-16 字符。继续传入返回的 `captureId` 和 `nextOffset`，直到 `nextOffset` 为 `null`。快照 60 秒后过期，主文档导航也会使其失效；过期返回 `html_capture_expired`。HTML 只含主文档，不含 iframe 文档或 shadow DOM，也不会把实时表单控件值镜像为属性。标记可能包含脚本或隐藏令牌，应按页面数据处理，避免不必要地记录或暴露。大页面可先用 `outline`，再通过 `scopeRef` 展开区域；树被截断或缺少属性/布局上下文时用 HTML 获取实际结构，不要重复相同的简略快照调用。

扩展和授权状态机由 Tether 自行实现。依赖包括 `playwright-core` 的公开进程内 transport、官方 MCP SDK、`ws` 和 `zod`；Python 使用 `websockets` 和 `cryptography`。协议校验使用 zod 与显式检查。

## 从检出目录构建和运行

要求 Node.js 22+ 和 Python 3.10+。在本目录执行初始化；配置、证书、凭据和生成的可执行文件应放在本地 runtime 目录中，不要提交。

```powershell
npm install --package-lock=false
python -m pip install -r python/requirements.txt
python scripts/setup.py
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launchers.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register.ps1
```

仓库有意不提交 lockfile；使用 `npm install`（或 `npm install --package-lock=false`），npm 会按本机配置的 registry/镜像解析依赖。发布版本使用 `a.b.c`：大功能或破坏性更新递增 `a`，兼容功能递增 `b`，修复递增 `c`。大版本必须同步更新所有配套组件和文档。根包当前版本为 `3.1.0`。

在现有浏览器中将 `extension/` 作为未打包扩展加载，并选择包含 `manifest.json` 的目录。每次初始化都会生成自己的扩展身份。运行本地构建的 Broker 时，使用本地 runtime 目录中生成的可执行文件。可用 `node scripts/fixture.mjs` 启动测试页。

推荐使用仓库根目录的 Tether CLI 安装并配置 Agent，流程见[安装指南](../docs/INSTALL.zh-CN.md)。加载扩展后会启用默认的 `auto` Broker 管理。MCP 和 Native Host 可为同一 runtime 启动 Broker；共享 runtime 模式为 `off` 时，MCP 不会再次启动。生命周期探测与重试说明见 [v1.0.0 发布说明](../docs/RELEASE-v1.0.0.zh-CN.md)。

## 任务组命名与现有标签页

`requestSession({mode:"newGroup",url:"https://example.com",groupName:"资料检索"})` 在扩展的“智能体命名标签组”开关开启时使用指定组名。名称支持 1–80 字符，不含控制字符，首尾空白会移除；关闭命名或未传名称时沿用默认名称。同名组不会因此获得额外授权。

接管现有页面时，先调用 `availableTabs({})`，再调用 `requestSession({mode:"attachExisting",tabId})`。自动批准总开关和“直接接管标签页”均开启时才直接授权，否则在扩展中批准待处理请求。策略 `ask` 始终要求人工审批。关闭直接接管也会禁用 `availableTabs`。两个新开关默认开启并保存到本机，影响后续请求或任务组创建，已有会话的授权保持有效。

现有标签页保留 URL、组和标题，释放会话后仍然打开。`groupName` 仅用于 Tether 新建的任务组，包括接管会话稍后通过 `createTab` 创建的独立任务组。

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

## 支持与业务方法

`diagnose({})` 报告 Broker、Native Host、浏览器和策略状态。`wait` 等待条件，`assert` 在同样的超时范围内重试断言；两者参数为 `{sessionId,pageId,condition,value,timeoutMs?}`。条件包括 `text`、精确匹配的 `url`、`visible`、`hidden` 和已完成的 `request`；`text` 会在 `snapshot.tree` 表示的可见文本中查找子串，不搜索完整 HTML。超时默认 5000 毫秒，最大 15000 毫秒。例如：`wait({sessionId,pageId,condition:"text",value:"已保存",timeoutMs:3000})` 返回 `passed` 和 `elapsedMs`。

`records({op:"list"|"export"|"clear"})` 读取当前认证 client identity 的内存运行元数据，最多保留 200 条。导出返回 JSON 文本；记录不含 URL、页面正文、选择器或值。不同连接按认证身份隔离；Broker 重启后记录清空。CLI 命令 `tether records --runtime PATH --output PATH` 使用已配置 Agent 的身份导出。

文件操作限定在页面内，写请求需递增 `seq`。先用 `uploadStart({sessionId,pageId,seq,files:[{name,mimeType?,size}]})` 创建上传，再用 `uploadChunk({sessionId,pageId,seq,uploadId,fileIndex,offset,data})` 按序发送 base64 分块，最后用 `uploadFinish({sessionId,pageId,seq,uploadId,selector})` 指定唯一文件输入框。每个文件上限 16 MiB；最多 8 个文件，总计 32 MiB。`downloadStart({sessionId,pageId,seq,url})` 在页面中执行同源 GET，`downloadRead({sessionId,pageId,seq,downloadId,offset})` 返回 base64 分块；这不支持捕获任意浏览器下载。下载上限 16 MiB。用 `downloadDrop` 或 `uploadDrop` 丢弃传输内容。

`dialog({sessionId,pageId,seq,action:"list"})` 列出待处理的 JavaScript 对话框；使用 `action:"accept"|"dismiss"` 和 `dialogId` 处理（可选 `promptText`）。弹窗发现和接管均为显式操作：先调用 `popupCandidates({sessionId})`，再用 `adoptPopup({sessionId,seq,openerPageId,tabId})` 接管选中的候选。两者都不会隐式授权弹窗。回放设计见 [REPLAY-DESIGN](../docs/REPLAY-DESIGN.zh-CN.md)，目前尚未实现。

## 故障排查

弹窗会显示 Broker 连接状态和恢复提示。检查扩展与 runtime 是否使用匹配的配置、证书和 pin；升级时应同时更新浏览器扩展和 runtime。各版本结果见[安装验收记录](../docs/INSTALL-VERIFICATION.zh-CN.md)和 [v3.1.0 发布说明](../docs/RELEASE-v3.1.0.zh-CN.md)。
