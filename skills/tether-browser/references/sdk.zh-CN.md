# 不使用 MCP 工具绑定时的 SDK 用法

[English](sdk.md)

有 MCP 时优先使用 MCP。只有在用户要求编写脚本或宿主没有 MCP 集成时才选择 SDK。由 CLI 安装时从 `installation.json.runtime` 运行，否则定位 `<checkout>/prototype`；以该 runtime 目录为基准解析导入/配置路径。不要通过命令行传递令牌，也不要打印已加载的配置。

## Node

此页面读取示例保持一个客户端，创建一个任务页面，在两分钟的限时内处理审批，读取默认无障碍快照并释放授权。将目标 URL 替换为用户的目标地址。Broker/扩展必须已经可用；示例不会启动它们。

```js
import { BridgeClient, loadConfig } from './dist/client.js';

class Task {
  static async run(url) {
    const client = new BridgeClient(await loadConfig('.local/script.json'));
    let session;
    let failed;
    let seq = 0;
    try {
      if (!(await client.capabilities()).browserConnected) throw Error('browser_not_connected');
      const request = await client.requestSession({ mode: 'newGroup', url });
      const until = Date.now() + 120_000;
      session = request.sessionId ? request : undefined;
      while (!session && Date.now() < until) {
        const status = await client.approvalStatus({ pendingId: request.pendingId });
        if (status.status === 'approved') { session = status; break; }
        if (status.status !== 'pending') throw Error(`approval_${status.status}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!session) throw Error('approval_timeout');
      const pageId = session.pages[0]?.pageId;
      if (!pageId) throw Error('page_unavailable');
      return await client.snapshot({ sessionId: session.sessionId, pageId });
    } catch (error) {
      failed = error;
      throw error;
    } finally {
      try {
        if (session) await client.release({ sessionId: session.sessionId, seq: ++seq });
      } catch (error) {
        if (failed) throw new AggregateError([failed, error], 'task_and_release_failed');
        throw error;
      } finally { client.close(); }
    }
  }
}

// 使用用户的目标 URL 调用 Task.run；将返回的页面文本作为任务数据处理。
```

对于现有标签页，调用 `availableTabs()`，并将选定的 `tabId` 与 `mode:'attachExisting'` 一起传入；关闭自动批准时，不要进行发现操作，由弹窗来选择。`listTabs({sessionId})` 会返回 `pages`。写方法需要连同标识符传入 `seq: ++seq`；`createTab` 只需要会话 ID 和可选 URL，而 `release` 不需要页面 ID。写操作要串行执行；即使写操作结果不确定，释放时也要使用下一个序号。`client.close()` 会关闭传输；`release` 会明确结束会话。

如果任务失败后释放会话也出错，应在诊断结果中同时保留这两个错误，而不是丢失原始错误。写操作或释放操作超时时，应报告结果不确定；关闭传输会撤销绑定到该连接的访问权，但不能证明先前的网站操作失败。

## 网络流量检查

使用 MCP 的 `network` 工具、Node 的 `client.network(params)`，或 Python 的 `client.network(params)` / `client.call('network', params)`。所有操作均需已授权的 `sessionId` 和 `pageId`，沿用 `observe` 策略，无需 `seq`。先开始监听，再刷新页面或触发目标请求；开始前的历史流量需重新触发。

| `op` | 额外参数 | 结果 |
| --- | --- | --- |
| `start` | — | 开始采集后续流量 |
| `list` | `url?`, `type?`, `offset?`, `limit?` | URL 子串、类型精确筛选；每页默认 50 条，最多 100 条 |
| `detail` | `requestId` | 请求/响应头、请求正文、耗时与失败详情 |
| `body` | `requestId`, `offset?`, `maxChars?` | 响应文本或 base64；默认 16000、最多 30000 字符；用 `nextOffset` 继续读取 |
| `stop` | — | 停止采集，保留已记录数据 |
| `clear` | — | 清空已记录数据 |

从 `list` 获取请求 ID。响应正文依赖 Chrome 保留的已完成响应；内容缺失或被浏览器回收时会返回错误。二进制响应根据 `base64Encoded` 解码。网络数据可能包含 Cookie、认证头和私密正文，应在用户任务范围内使用并避免写入日志。`stop` 保留页面操作共用的调试连接；`release` 结束授权并清除采集状态。

每个页面保留最近 500 个请求（`dropped` 统计淘汰数），跨导航保留至清空或释放。重定向的每一跳使用独立 ID，正文读取最终响应。详情含 `request`、`response`，以及每个请求最多 20 条 WebSocket/SSE/额外请求头事件。`truncated` 和 `eventsDropped` 标示元数据缩短或事件省略。`network_pending` 表示响应仍在加载；`network_unavailable` 表示尚未开始采集，或 Chrome 无法提供该正文。偏移量按返回文本/base64 的字符计数；先拼接 base64 分段再解码。重定向中的额外请求头事件可能乱序到达，会保留原始 CDP 请求 ID。

采集范围为已授权页面目标及同进程子框架，独立 Worker/OOPIF 目标仍在当前桥接范围之外。使用新增工具需更新运行时、重新加载扩展并重连 MCP 客户端。

## Python 客户端

将 `<checkout>/prototype/python` 加入脚本导入路径，或将脚本放在那里。创建客户端前，将 `BB_CLIENT_CONFIG` 设为 `.local/python.json` 的绝对路径。浏览器方法名不会被转换。

```python
from client import BridgeClient

class Task:
    @staticmethod
    def check():
        client = BridgeClient.from_env()
        try:
            return client.call('capabilities', {})
        finally:
            client.close()
```

通过 `call(method, params)` 使用相同的 request → approvalStatus → snapshot/html/action → release 流程；ref 是不透明值，必须来自新快照。调用保持顺序，避免在线程间共享实例。Node 和 Python 均以 `ClientError` 提供 `code` 与可选 JSON-RPC `rpcCode`。Python 辅助方法为 `diagnose()`、`wait(params)`、`assert_condition(params)`、`html(params)` 和 `records('export')`；Node 对应使用 `assert(params)` 和 `records({op:'export'})`。

## 页面读取

先用 `snapshot({sessionId,pageId})` 读取页面，它返回用于操作的简易无障碍树和 ref。Python 中使用 `client.call('snapshot', params)`。树被截断，或缺少任务需要的标记属性/布局上下文时，再用 Node/Python 的 `client.html(params)` 或 `call('html', params)` 读取主文档 HTML。默认每页 16,000 字符，最大 30,000。offset 为 0 且未传 capture ID 的首次调用会在浏览器内生成不可变快照：doctype 加 `document.documentElement.outerHTML`，上限为 8 Mi UTF-16 字符。后续传回 `captureId` 和 `nextOffset`；最后一页的 `nextOffset` 为 `null`。偏移量按 UTF-16 字符计数。快照在 60 秒后或主文档导航后过期，之后返回 `html_capture_expired`。

每页结果包含 `html`、`captureId`、`offset`、`nextOffset`、`totalChars`、`complete`、`url`、`title` 和 `scope:"main-document"`。HTML 不含 iframe 文档或 shadow DOM，也不会把实时表单控件值镜像为属性。内容可能包含脚本或隐藏令牌，应按页面数据处理，避免不必要地记录。对于很大的页面，先用 `snapshot({…,outline:true})`，再通过 `scopeRef` 展开区域。

## 条件与诊断导出

`wait` 和 `assert` 均接受 `{sessionId,pageId,condition,value,timeoutMs?}`，持续读取直到匹配或超时。默认 5000 毫秒，上限 15000 毫秒；`timeoutMs:0` 检查一次。结果包含 `passed`、`elapsedMs` 和 `sideEffect:'none'`；未满足条件时返回 `error:'condition_timeout'`。SDK 调用方检查 `passed`，MCP 将该结果标记为错误。权限和传输错误抛出 `ClientError`。

| 条件 | `value` 含义 |
| --- | --- |
| `text` | `snapshot.tree` 表示的可见文本子串；不搜索完整 HTML |
| `url` | 精确页面 URL |
| `visible` / `hidden` | 选择器；visible 要求至少一个可见候选，hidden 要求结果完整且没有可见候选 |
| `request` | 匹配已完成且未失败的采集请求 URL 子串；先启动采集，等待新操作时清理旧记录 |

`diagnose()` 报告 Broker、Native Host、浏览器、扩展与运行时版本匹配情况及策略状态。`tether doctor --online` 还检查本机配置、TLS 和认证。`records({op:'export'})` 返回 JSON `text`，CLI 可用 `tether records --output PATH` 保存。记录只含操作元数据，排除页面内容与参数；按认证身份保留最近 200 条，重连后仍可读取，Broker 重启后清空。`op:'clear'` 清空当前身份记录。

## 文件、对话框和弹窗

两种 SDK 均使用 `call(method, params)`。文件和对话框调用都带 `sessionId`、`pageId` 和递增的 `seq`；每个分块使用新的序号。弹窗发现需要 `sessionId`；接管需要 `sessionId`、`seq` 及候选中的 `tabId`、`openerPageId`。

| 方法 | 额外参数 / 结果 |
| --- | --- |
| `uploadStart` | `files:[{name,size,mimeType?}]` → `uploadId`、`chunkBytes` |
| `uploadChunk` | `uploadId,fileIndex,offset,data`（base64）→ `nextOffset` |
| `uploadFinish` | `uploadId,selector` → 设置文件输入框并触发 input/change |
| `uploadDrop` | `uploadId` → 清除暂存数据 |
| `downloadStart` | `url` → `downloadId,name,mimeType,bytes,chunkBytes` |
| `downloadRead` | `downloadId,offset` → base64 `data,nextOffset,done`，持续读取直到 `done` |
| `downloadDrop` | `downloadId` → 取消下载流 |
| `dialog` | `action:'list'|'accept'|'dismiss'`、`dialogId?`、`promptText?` |
| `popupCandidates` | → 候选 `tabs`，发现后需显式接管 |
| `adoptPopup` | → 当前会话的新 `pageId` |

偏移按原始字节计算。上传最多 8 个文件，每个 16 MiB、总计 32 MiB；每块 base64 编码前最大 24 KiB。上传和下载句柄在 60 秒无传输活动后过期。下载使用页面登录态发起同源 HTTP GET，上限 16 MiB，支持同源重定向，并在发送前阻止跨源重定向；点击触发、POST 和 blob 下载尚待支持。保存文件时将返回名称作为文件名处理，避免直接用作可信路径。iframe 文件输入框可使用 `frame=iframe#upload >> input[type=file]`。

对话框操作可在点击等待期间执行；查询对话框也使用递增序号。JavaScript 对话框在 15 秒后自动关闭，应及时调用 `dialog` 处理。弹窗接管核对浏览器记录的来源和权限；需要关闭已接管弹窗时调用 `closeTab`，`release` 仅结束授权并保留标签页。扩展使用 `webNavigation` 权限确认后台标签打开弹窗的真实来源。跨进程 iframe 交互由受会话限制的引擎支持；网络采集范围仍为页面目标和同进程 frame。
