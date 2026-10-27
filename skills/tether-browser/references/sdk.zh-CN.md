# 不使用 MCP 工具绑定时的 SDK 用法

[English](sdk.md)

有 MCP 时优先使用 MCP。只有在用户要求编写脚本或宿主没有 MCP 集成时才选择 SDK。由 CLI 安装时从 `installation.json.runtime` 运行，否则定位 `<checkout>/prototype`；以该 runtime 目录为基准解析导入/配置路径。不要通过命令行传递令牌，也不要打印已加载的配置。

## Node

此观察示例保持一个客户端，创建一个任务页面，在两分钟的限时内处理审批，观察页面并释放授权。将目标 URL 替换为用户的目标地址。Broker/扩展必须已经可用；示例不会启动它们。

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
      while (Date.now() < until) {
        const status = await client.approvalStatus({ pendingId: request.pendingId });
        if (status.status === 'approved') { session = status; break; }
        if (status.status !== 'pending') throw Error(`approval_${status.status}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!session) throw Error('approval_timeout');
      const pageId = session.pages[0]?.pageId;
      if (!pageId) throw Error('page_unavailable');
      return await client.observe({ sessionId: session.sessionId, pageId });
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

## Python

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

通过 `call(method, params)` 使用相同的 request → approvalStatus → observe/snapshot/action → release 流程；ref 是不透明值，例如 `tabc123e12`，必须来自新快照。snapshot 支持互斥的 `scope`/`scopeRef` 和可选 `outline`；locate 支持互斥的 `scope`/`scopeRef`。click/fill 支持可选 `observe:{scope?,scopeRef?,maxChars?}`，范围字段互斥。观察只报告事实，不确认业务成功，也不回显填写值。调用保持顺序，不要在线程间共享同一实例。Python 目前会把服务器 RPC 错误转换为 `ValueError('rpcFailed')`，因此不要声称它会暴露 Node/MCP 的精确错误原因。Python 传输/安全检查已有验收记录；直接使用 Python 执行页面操作尚未独立验收。
