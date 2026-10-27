# SDK usage without an MCP tool binding

[简体中文](sdk.zh-CN.md)

Use MCP when available. Choose SDKs for a user-requested script or a host without MCP integration. Run from `installation.json.runtime` when installed by the CLI, otherwise locate `<checkout>/prototype`; resolve imports/config paths against that runtime directory. Never pass a token on the command line or print the loaded config.

## Node

This observation example keeps one client, creates one task page, handles approval with a two-minute bound, observes it, and releases authorization. Replace the target URL with the user's destination. Broker/extension must already be available; the example does not start them.

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

// Invoke Task.run with the user's URL; handle the returned page text as task data.
```

For an existing tab, use `availableTabs()` and pass the selected `tabId` with `mode:'attachExisting'`; when auto-approval is off, omit discovery and let the popup choose. `listTabs({sessionId})` returns `pages`. Write methods take `seq: ++seq` along with IDs; `createTab` needs only the session ID and optional URL, while `release` needs no page ID. Serialize those writes and use the next sequence value for release even after an uncertain write. `client.close()` closes the transport; `release` ends the session explicitly.

If a release error follows a task failure, retain both in the diagnostic result rather than losing the original failure. Report uncertainty if a write or release timed out; closing the transport revokes connection-bound access but does not prove an earlier website action failed.

## Python

Add `<checkout>/prototype/python` to your script's import path or place a script there. Set `BB_CLIENT_CONFIG` to the absolute path of `.local/python.json` before creating the client. No browser method names are translated.

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

Use the same request → approvalStatus → observe/snapshot/action → release workflow via `call(method, params)`; ref values are opaque, for example `tabc123e12`, and must come from a fresh snapshot. Snapshot accepts mutually exclusive `scope`/`scopeRef` and optional `outline`; locate accepts mutually exclusive `scope`/`scopeRef`. Click/fill accept optional `observe:{scope?,scopeRef?,maxChars?}` with mutually exclusive scope fields. Observation reports facts only and never confirms business success or echoes fill values. Keep calls sequential and do not share an instance across threads. Python currently converts server RPC errors to `ValueError('rpcFailed')`, so do not claim that it exposes the precise Node/MCP error reason. Python transport/security checks have recorded acceptance; direct Python page actions have not been independently accepted.
