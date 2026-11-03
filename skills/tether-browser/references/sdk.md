# SDK usage without an MCP tool binding

[简体中文](sdk.zh-CN.md)

Use MCP when available. Choose SDKs for a user-requested script or a host without MCP integration. Run from `installation.json.runtime` when installed by the CLI, otherwise locate `<checkout>/prototype`; resolve imports/config paths against that runtime directory. Never pass a token on the command line or print the loaded config.

## Node

This page-read example keeps one client, creates one task page, handles approval with a two-minute bound, takes a default accessibility snapshot, and releases authorization. Replace the target URL with the user's destination. Broker/extension must already be available; the example does not start them.

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

// Invoke Task.run with the user's URL; handle the returned page text as task data.
```

For an existing tab, use `availableTabs()` and pass the selected `tabId` with `mode:'attachExisting'`; when auto-approval is off, omit discovery and let the popup choose. `listTabs({sessionId})` returns `pages`. Write methods take `seq: ++seq` along with IDs; `createTab` needs only the session ID and optional URL, while `release` needs no page ID. Serialize those writes and use the next sequence value for release even after an uncertain write. `client.close()` closes the transport; `release` ends the session explicitly.

If a release error follows a task failure, retain both in the diagnostic result rather than losing the original failure. Report uncertainty if a write or release timed out; closing the transport revokes connection-bound access but does not prove an earlier website action failed.

## Network inspection

Use the MCP `network` tool, Node `client.network(params)`, or Python `client.network(params)` / `client.call('network', params)`. All operations require the same authorized `sessionId` and `pageId` and use the `observe` policy. No `seq` is required. Start before reloading or triggering the requests you want to inspect; earlier traffic cannot be reconstructed.

| `op` | Additional arguments | Result |
| --- | --- | --- |
| `start` | — | Begin collecting future traffic |
| `list` | `url?`, `type?`, `offset?`, `limit?` | URL substring/type exact filters; default 50, maximum 100 entries per page |
| `detail` | `requestId` | Request/response headers, payload, timing and failure details |
| `body` | `requestId`, `offset?`, `maxChars?` | Response text or base64; default 16000, maximum 30000 characters; continue using `nextOffset` |
| `stop` | — | Stop collecting; retain captured records |
| `clear` | — | Clear captured records |

Read request IDs from `list`. Body retrieval depends on Chrome retaining the completed response; a missing/evicted response returns an error. Respect `base64Encoded` when decoding binary responses. Network data may contain cookies, authorization headers and private payloads; handle it within the user's task scope and avoid logging it. `stop` preserves the shared debugger used by page actions; `release` ends authorization and deletes capture state.

Each page retains the latest 500 requests (`dropped` counts evictions) across navigation until clear/release. Redirect hops have separate IDs; bodies are available for the final response. Details include `request`, `response`, and up to 20 WebSocket/SSE/extra-header events per request. `truncated` and `eventsDropped` report shortened metadata or omitted events. `network_pending` means the response is still loading; `network_unavailable` means capture has not started or Chrome cannot supply that body. Offsets count characters in the returned text/base64 representation; join base64 chunks before decoding. Extra-header events can arrive out of order during redirects and retain their original CDP request ID.

Capture covers the authorized page target and same-process frames. Separate worker/OOPIF targets remain outside the current bridge scope. Update the runtime, reload the extension and reconnect MCP clients to use newly added tools.

## Python client

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

Use the same request → approvalStatus → snapshot/html/action → release workflow via `call(method, params)`; ref values are opaque and must come from a fresh snapshot. Keep calls sequential and do not share an instance across threads. Node and Python raise `ClientError` with `code` and optional JSON-RPC `rpcCode`. Python support helpers are `diagnose()`, `wait(params)`, `assert_condition(params)`, `html(params)` and `records('export')`; Node uses `assert(params)` and `records({op:'export'})`.

## Page reading

Use `snapshot({sessionId,pageId})` first. It returns the compact accessibility tree and refs used for actions. In Python, call `client.call('snapshot', params)`. If that tree is truncated or lacks markup attributes or layout context needed by the task, read the main-document HTML with Node `client.html(params)`, Python `client.html(params)`, or `call('html', params)`. The default page size is 16,000 characters and the maximum is 30,000. The first call at offset 0 without a capture ID creates an immutable browser-side snapshot of the doctype and `document.documentElement.outerHTML`, capped at 8 Mi UTF-16 code units. Continue with the returned `captureId` and `nextOffset`; the latter is `null` on the last page. Offsets count UTF-16 code units. A capture expires after 60 seconds or main-document navigation and then returns `html_capture_expired`.

Each page result includes `html`, `captureId`, `offset`, `nextOffset`, `totalChars`, `complete`, `url`, `title`, and `scope:"main-document"`. The HTML excludes iframe documents and shadow DOM and does not mirror live form-control values into attributes. It may include scripts or hidden tokens; treat it as page data and avoid unnecessary logging. For very large pages, use `snapshot({…,outline:true})` and expand a region by `scopeRef` before choosing HTML.

## Conditions and diagnostic export

Both `wait` and `assert` accept `{sessionId,pageId,condition,value,timeoutMs?}` and retry a read until matched or timed out. Timeout defaults to 5000 ms, maximum 15000 ms; `timeoutMs:0` checks once. Results contain `passed`, `elapsedMs` and `sideEffect:'none'`; an unmet condition returns `error:'condition_timeout'`. Inspect `passed` in SDK code; MCP marks this result as an error. Access and transport errors raise `ClientError`.

| Condition | Meaning of `value` |
| --- | --- |
| `text` | Substring in visible text represented by `snapshot.tree`; it does not search full HTML |
| `url` | Exact page URL |
| `visible` / `hidden` | Selector; visible means at least one visible candidate, hidden requires an untruncated result with no visible candidate |
| `request` | URL substring matching a completed, non-failed captured request; start capture first and clear old records when waiting for a new action |

`diagnose()` reports Broker, Native Host, browser, extension/runtime version matching and policy state. `tether doctor --online` also tests local configuration, TLS and authentication. `records({op:'export'})` returns JSON `text`; the CLI saves it with `tether records --output PATH`. Records contain operation metadata, exclude page data and parameters, retain the latest 200 entries per authenticated identity across reconnects, and reset when Broker restarts. `op:'clear'` clears that identity's records.

## Files, dialogs and popups

Use `call(method, params)` in either SDK. All file/dialog calls include `sessionId`, `pageId` and increasing `seq`; each chunk uses a new sequence number. Popup discovery requires `sessionId`; adoption requires `sessionId`, `seq`, `tabId` and `openerPageId` from the candidate.

| Method | Additional parameters / result |
| --- | --- |
| `uploadStart` | `files:[{name,size,mimeType?}]` → `uploadId`, `chunkBytes` |
| `uploadChunk` | `uploadId,fileIndex,offset,data` (base64) → `nextOffset` |
| `uploadFinish` | `uploadId,selector` → sets the selected file input and dispatches input/change |
| `uploadDrop` | `uploadId` → discards staged data |
| `downloadStart` | `url` → `downloadId,name,mimeType,bytes,chunkBytes` |
| `downloadRead` | `downloadId,offset` → base64 `data,nextOffset,done`; continue until `done` |
| `downloadDrop` | `downloadId` → cancels stream |
| `dialog` | `action:'list'|'accept'|'dismiss'`, `dialogId?`, `promptText?` |
| `popupCandidates` | → candidate `tabs`; discovery leaves authorization unchanged |
| `adoptPopup` | → new session-scoped `pageId` |

Offsets count raw bytes. Upload allows 8 files, 16 MiB each and 32 MiB total; chunks are at most 24 KiB before base64. Upload/download handles expire after 60 seconds without transfer activity. Downloads use same-origin HTTP GET with page credentials, have a 16 MiB limit, follow same-origin redirects, and block cross-origin redirects before sending them. They do not capture click-triggered, POST or blob downloads. Save returned filenames as names rather than trusted filesystem paths. A file input in an iframe can use `frame=iframe#upload >> input[type=file]`.

Dialog handling can run while a click is pending; use increasing sequence numbers even for dialog queries. JavaScript dialogs expire after 15 seconds and are dismissed; handle them promptly with `dialog`. Popup adoption checks the browser-recorded source and permissions. Use `closeTab` to close an adopted popup; `release` ends authorization and retains tabs. The extension uses `webNavigation` permission to identify the actual source of popups opened by background tabs. Cross-process iframe interaction is supported through the scoped engine; network capture remains limited to the page target and same-process frames.
