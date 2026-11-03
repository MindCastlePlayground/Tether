# Tether runtime guide

<p align="center"><img src="../assets/logo.png" alt="Tether" width="160"></p>

[简体中文](README.zh-CN.md) · [Project overview](../README.md) · [Installation](../docs/INSTALL.md) · [Internationalization](../docs/I18N.md) · [Verification](VERIFICATION.md)

`prototype/` is a historical directory name retained for path compatibility. It contains the current runtime source: the browser extension, Broker, Native Messaging host, MCP server, Node and Python SDKs, and setup/build scripts. The public installation path is documented in the [installation guide](../docs/INSTALL.md).

## Runtime and protocol

The data path is an existing Chrome browser → MV3 extension → Native Messaging → local TLS WebSocket Broker → Node/Python SDK or stdio MCP. The Broker defaults to loopback. A client can create a task tab group or explicitly attach to one existing HTTP(S) tab. The internal Native Messaging identifier remains `com.freebird.browser_bridge` for compatibility.

The runtime provides browser, support, and business RPC methods; use `capabilities({})` to inspect the current set. Browser methods include `requestSession`, `approvalStatus`, `listTabs`, `createTab`, `closeTab`, `release`, `snapshot`, `html`, `locate`, `fill`, `click`, `navigate`, `availableTabs`, and `network`. Support methods are `diagnose`, `wait`, `assert`, and `records`; business methods include `uploadStart`, `uploadChunk`, `uploadFinish`, `uploadDrop`, `downloadStart`, `downloadRead`, `downloadDrop`, `dialog`, `popupCandidates`, and `adoptPopup`. `snapshot` returns a compact accessibility tree with `[ref=eN]` element references; `html` reads an immutable snapshot of the complete main-document HTML in bounded pages; `locate` lists matches with verified unique selectors; `fill`/`click` accept `ref` or `selector`, resolve it to exactly one element before acting, and otherwise refuse with `sideEffect:"none"` and candidates. Policy rules treat read methods such as `snapshot`, `html`, and `locate` as `observe`. Write requests use a session-local increasing positive integer `seq`; duplicate identical requests return their prior result, while conflicting reuse is rejected. A timeout is indeterminate, so SDKs do not automatically replay writes.

Use `snapshot` as the default page read. For complete markup or structure the accessibility tree cannot show, call `html({sessionId,pageId,offset?,maxChars?,captureId?})`; pages default to 16,000 characters and are capped at 30,000. The first request starts a browser-side immutable capture of `<!doctype>` plus `document.documentElement.outerHTML`, limited to 8 Mi UTF-16 code units. Continue with the returned `captureId` and `nextOffset` until it is `null`. Captures expire after 60 seconds and are invalidated by main-frame navigation; an expired capture returns `html_capture_expired`. HTML covers only the main document, not iframe documents or shadow DOM, and it does not mirror live form-control values into attributes. Markup may contain scripts or hidden tokens, so treat it as page data and avoid logging or exposing it unnecessarily. Use `outline` for very large pages and expand a region with `scopeRef`; use HTML when the tree is truncated or omits needed attributes/layout context instead of repeating the same brief snapshot request.

The extension and authorization state machine are Tether code. Dependencies include the public in-process transport from `playwright-core`, the official MCP SDK, `ws`, and `zod`; Python uses `websockets` and `cryptography`. Protocol validation uses zod and explicit checks.

## Build and run from a checkout

Use Node.js 22+ and Python 3.10+. Run setup from this directory; configuration, certificates, credentials, and generated executables belong in the local runtime directory and should not be committed.

```powershell
npm install --package-lock=false
python -m pip install -r python/requirements.txt
python scripts/setup.py
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launchers.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register.ps1
```

The repository intentionally has no lockfile; use `npm install` (or `npm install --package-lock=false`) so npm resolves dependencies using the configured registry/mirror. Release versions use `a.b.c`: increment `a` for major features or incompatible changes, `b` for compatible features, and `c` for fixes. Major releases update all companion components and documentation. The root package is version `3.0.1`.

Load `extension/` as an unpacked extension in the existing browser. Select the directory containing `manifest.json`; each setup generates its own extension identity. To run a locally built Broker, use the generated executable in the local runtime directory. The fixture page can be started with `node scripts/fixture.mjs`.

The preferred install and agent configuration flow is the repository-root Tether CLI in the [installation guide](../docs/INSTALL.md). Loading the extension enables its default `auto` Broker management. MCP and Native Host can start the Broker for the same runtime; shared runtime mode `off` prevents MCP from starting it again. Lifecycle probes and retries are described in the [v1.0.0 release notes](../docs/RELEASE-v1.0.0.md).

## SDK use

The Node SDK is exported from `dist/client.js`:

```js
import { BridgeClient, loadConfig } from './dist/client.js';

const client = new BridgeClient(await loadConfig('<runtime>/.local/script.json'));
try {
  console.log(await client.capabilities());
} finally {
  client.close();
}
```

Keep one client instance for the session and call `close()` when finished. `examples/client.ts` demonstrates importing the source module. The Python entry point is `python/client.py`; set `BB_CLIENT_CONFIG` to the runtime's Python configuration, then use `BridgeClient.from_env()`, `call(method, params)`, and `close()`. Python calls are synchronous and sequential; do not share one client instance across threads.

For an MCP client using `mcpServers`, replace the placeholder with the absolute path to the installed launcher:

```json
{
  "mcpServers": {
    "tether": {
      "command": "<runtime>/.local/mcp.exe"
    }
  }
}
```

## Authorization and boundaries

An authenticated client receives the configured session permissions for task pages or the one explicitly selected existing tab. Page access is scoped to the client, session, and page. Several clients, such as concurrent agents, may connect with the same credential; each connection becomes its own instance (`<identity>#<id>`), policy rules still match the credential identity, and sessions are released when their connection closes. Existing pages are not closed by session cleanup; only pages created by that session may be closed. Turning off automatic approval prevents new automatic grants but does not revoke existing sessions.

Keep TLS and certificate pin checks enabled. The Native Host role accepts loopback connections only. The extension blocks its own network connections; page navigation intentionally communicates with requested websites. These controls do not establish that the whole browser profile has zero external traffic or isolate other processes running as the same user. See the dated [verification summary](VERIFICATION.md) for tested flows and limits.

## Support and business methods

`diagnose({})` reports Broker, Native Host, browser, and policy state. `wait` polls a condition and `assert` retries within the same timeout; both take `{sessionId,pageId,condition,value,timeoutMs?}`. Conditions are `text`, exact `url`, `visible`, `hidden`, and completed `request`; `text` searches for a substring in the visible text represented by `snapshot.tree`, not the full HTML. Timeout defaults to 5000 ms and is capped at 15000 ms. For example, `wait({sessionId,pageId,condition:"text",value:"Saved",timeoutMs:3000})` returns `passed` and `elapsedMs`.

`records({op:"list"|"export"|"clear"})` reads this authenticated client identity's in-memory operational metadata (maximum 200 rows). Export returns JSON text; records omit URLs, page content, selectors, and values. Entries are isolated by credential identity across connections and are cleared when Broker restarts. The CLI `tether records --runtime PATH --output PATH` exports using the configured agent identity.

File operations are page-scoped and use increasing `seq` values. Upload through `uploadStart({sessionId,pageId,seq,files:[{name,mimeType?,size}]})`, send ordered base64 chunks with `uploadChunk({sessionId,pageId,seq,uploadId,fileIndex,offset,data})`, then call `uploadFinish({sessionId,pageId,seq,uploadId,selector})` for a unique file input. Each file is limited to 16 MiB; up to 8 files and 32 MiB total are accepted. `downloadStart({sessionId,pageId,seq,url})` performs a same-origin GET in the page and `downloadRead({sessionId,pageId,seq,downloadId,offset})` returns base64 chunks; this is not arbitrary browser download capture. Downloads are limited to 16 MiB. Use `downloadDrop` or `uploadDrop` to discard a transfer.

`dialog({sessionId,pageId,seq,action:"list"})` lists pending JavaScript dialogs; use `action:"accept"|"dismiss"` with `dialogId` (and optional `promptText`). Popup discovery and adoption are explicit: first request `popupCandidates({sessionId})`, then adopt a selected candidate with `adoptPopup({sessionId,seq,openerPageId,tabId})`. Neither method grants popup access implicitly. Replay design is documented in [REPLAY-DESIGN](../docs/REPLAY-DESIGN.md); that design is not implemented.

## Troubleshooting

The popup displays Broker connection state and a recovery hint. Check that the extension and runtime use matching configuration, certificates, and pin; keep the browser extension and runtime upgraded together. See [installation verification](../docs/INSTALL-VERIFICATION.md) and [v3.0.1 release notes](../docs/RELEASE-v3.0.1.md) for version-specific results.
