# Tether prototype

<p align="center"><img src="../assets/logo.png" alt="Tether" width="160"></p>

[简体中文](README.zh-CN.md) · [Project overview](../README.md) · [Internationalization](../docs/I18N.md)

This guide covers the current local prototype. The evidence boundary and remaining gaps are recorded in [VERIFICATION.md](VERIFICATION.md).

Language and contributor references: [M0 plan](PLAN.md) / [简体中文计划](PLAN.zh-CN.md), [verification](VERIFICATION.md) / [简体中文验收记录](VERIFICATION.zh-CN.md), and [internationalization guide](../docs/I18N.md) / [国际化指南](../docs/I18N.zh-CN.md).

The popup uses Chrome locale messages for English and Simplified Chinese, follows the browser language until the user chooses a language, and stores that choice locally. See the [internationalization guide](../docs/I18N.md) for the locale and translation workflow.

Agent users should read the repository's [Tether browser skill](../skills/tether-browser/SKILL.md) for the session workflow and tool contract, or the [Chinese reading copy](../skills/tether-browser/SKILL.zh-CN.md).

## What is implemented

The path is an existing Chrome/Edge browser → MV3 extension → Native Messaging → local TLS WebSocket broker → Node/Python SDK or stdio MCP. There is no browser launcher, dedicated profile, CDP TCP port, or cloud relay. By default, a client can create a task tab group; it can also explicitly take over one existing HTTP(S) tab.

The prototype integrates the public in-process CDP transport from `playwright-core 1.64.0`, the official `@modelcontextprotocol/sdk 1.32.1`, `ws`, and `zod`; Python uses `websockets` and `cryptography`. The extension and authorization state machine are prototype code. It does not copy the complete upstream extension or use private Playwright patches. `ajv` is pinned in the install, but current validation uses zod and explicit protocol checks; do not count Ajv as an integrated capability.

The 12 RPC methods are `requestSession`, `approvalStatus`, `listTabs`, `createTab`, `closeTab`, `release`, `observe`, `fill`, `click`, `navigate`, `capabilities`, and `availableTabs`. Write requests use a session-local increasing positive integer `seq`. A repeated sequence number with the same request returns the prior result; a conflicting request is rejected. A timeout is indeterminate, so SDKs do not automatically replay writes.

## Run on the configured machine

Run commands from this directory. Configuration, certificates, and credentials are under `.local/`; do not copy them into reports or commit them. The broker listens on `127.0.0.1:18443` by default. The synthetic test page is at `http://127.0.0.1:18444/`.

```powershell
npm run build
.\.local\broker.exe
```

The foreground broker command is useful for terminal debugging. For a background process, use `Start-Process -WindowStyle Hidden`. Start the fixture page with `node scripts/fixture.mjs`. Do not start a second broker while one is already listening.

Open `chrome://extensions` in Chrome, enable Developer mode, load this directory's `extension/` folder, and pin Tether. The current extension ID is `ojofdihdmmgpnaedmomclpmdkhnmbjln`. Reload the extension in the extensions page after changing its background code. Native Host is registered for the current user's Chrome and Edge, but Edge itself has not been validated. Setup did not change browser startup arguments, system root certificates, routes, or firewall rules.

Real browser tests operate only on the local synthetic page. Under the requested policy, an authenticated client is automatically approved by default to create a task group or attach to a specified existing tab; per-request approval is not required:

```powershell
node scripts/live.mjs newGroup node
node scripts/live.mjs attachExisting node
node scripts/live.mjs newGroup mcp
```

`attachExisting` locates the existing local fixture using `availableTabs`, then takes it over with `requestSession({mode:'attachExisting',tabId})`. The MCP configuration's `command` must be the absolute path to this prototype's `.local/mcp.exe`; no provider API key is needed. The launcher reads `.local/agent.json` and clears inherited proxy, Node injection, and other environment variables. The service itself does not call a model. If an agent sends tool results to an external model, that data flow is controlled by the caller; an internal model is needed for a fully internal agent deployment.

For an MCP client using an `mcpServers` configuration, replace this example path with your installation path:

```json
{
  "mcpServers": {
    "tether": {
      "command": "H:\\Documents\\Abyss\\plugins\\Tether\\prototype\\.local\\mcp.exe"
    }
  }
}
```

The internal Native Messaging identifier remains `com.freebird.browser_bridge` for compatibility with existing registrations. The public product name, toolbar icons, popup, task-group names, and MCP server identity are Tether.

Tests wait at most 10 minutes. An expired request is submitted again; an explicit rejection ends immediately. The script disconnects authorization when it exits, but does not close existing user pages. Newly created pages are retained, except an extra page explicitly created and closed during a test.

The Node SDK is exported from `dist/client.js`. For example:

```js
import { BridgeClient, loadConfig } from './dist/client.js';

const client = new BridgeClient(await loadConfig('.local/script.json'));
try {
  console.log(await client.capabilities());
} finally {
  client.close();
}
```

Keep the client instance and connection for the session, then call `close()`. `examples/client.ts` imports the source module for the TypeScript example; consumers of the built package should import `dist/client.js` as above. The Python entry point is `python/client.py`: set `BB_CLIENT_CONFIG` to `.local/python.json`, then use `BridgeClient.from_env()`, `call(method, params)`, and `close()`. The Python client currently makes synchronous sequential calls; do not share one instance across threads.

## Initialize a new machine

The preferred Windows path installs from the repository root with the Tether CLI; see the [installation guide](../docs/INSTALL.md) for agent selection, config locations, and extension loading. It supports Node.js 22+ and Python 3.10+, and keeps Broker stopped. The CLI also supports `--runtime` to reuse an existing setup.

For manual setup or recovery, run these commands from this directory. They install the prototype runtime directly and do not configure agent MCP entries:

```powershell
npm ci
python -m pip install -r python/requirements.txt
python scripts/setup.py
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/launchers.ps1
& ./scripts/register.ps1
npm run build
```

Load `extension/` as an unpacked extension in the existing browser. Fresh setup generates a local extension key/ID and updates `manifest.json`; use that machine's generated ID, not a historical README ID. Setup preserves existing configuration. The internal Native Messaging identifier remains `com.freebird.browser_bridge` for registration compatibility. These commands do not start Broker.
## Authorization and network boundaries

- `newGroup` automatically authorizes an authenticated identity to control task pages, create up to 10 pages in the current session, and navigate or interact with websites over HTTP(S). The toolbar can turn off auto-approval; new requests then require manual approval. The switch is stored only while the extension background remains alive. Reloading the extension restores the default enabled state. A tab group is organizational; actual permission is scoped to client, session, and page.
- With auto-approval enabled, an authenticated client can use `availableTabs` to read the title, URL, and ID of existing HTTP(S) tabs, then use `attachExisting` with a chosen `tabId` to take over that page automatically. Permission covers only that page, not other pages in its group; the page stays in its original position. A page cannot be held by two sessions at once. Dragging a page into a group does not grant access; leaving the authorized group revokes it. Closing is allowed only for pages created by this session.
- Revocation, client or Native disconnection, and lease expiry invalidate current permission. With auto-approval enabled, a client may request another session. To prevent subsequent automatic grants, turn auto-approval off and then revoke existing sessions. Turning it off also rejects `availableTabs`; it does not revoke already established sessions. Public RPC does not expose policy changes or a direct approval call. Unknown CDP methods, cross-page IDs, raw CDP, and global Cookie/Storage APIs are not exposed.
- The extension CSP blocks its own network connections. The bridge and SDK use only explicit loopback or RFC1918 numeric addresses, validate certificates and SPKI pins, bypass proxies, and do not follow redirects. Web page Origin requests are rejected. The Native Host role accepts loopback connections only.
- Debug errors record operation or method names, not URLs, page bodies, credentials, or raw CDP data. There is no telemetry, crash reporting, or online auto-update code.

These boundaries do not isolate malicious processes running as the same Windows user; such processes can read that user's credentials or modify installed code. Unauthorized browser extensions, system-level capture, and browser sync are outside this prototype's control. Website communication performed under user instructions is intentionally in scope.

## M0 not implemented

Automatic OOPIF attachment, automatic popup authorization, file upload/download, large-message chunking, full `ref` protocol, persistent cleanup of debugger state after crashes, signed installers, and automatic certificate rotation are not implemented. Messages larger than 512 KiB are rejected; this is not a full-page export interface. Selector interaction uses Playwright; general `evaluate` and arbitrary CDP are not exposed.

Chrome debugger restrictions limit available CDP domains. Version metadata comes from the extension's user agent; revision and `jsVersion` are unknown. See [Chrome's debugger API documentation](https://developer.chrome.com/docs/extensions/reference/api/debugger#restricted-domains).

## Verification boundaries

The recorded page-control acceptance covers Node SDK and the official MCP client in real Chrome. Python passed real-broker security and sequential-call checks, but direct page actions through the Python SDK were not separately accepted. A second LAN machine was not tested. TCP snapshots and the inspected connection restrictions do not establish a complete zero-external-traffic guarantee for the browser profile. See [VERIFICATION.md](VERIFICATION.md) for the evidence by layer.

## Checks and evidence

Brand-only verification can run while the broker stays off:

```powershell
npm run build
node --test --test-reporter=dot test/extension.test.mjs
node scripts/brand-preview.mjs
```

The preview uses an isolated headless Chrome and a mock extension runtime; it does not connect to Native Messaging or start a broker. It writes the popup image and verification report under `../assets/`. The full checks below include network servers and require the setup described above.

```powershell
npm test
python -m unittest discover -s test -p python_test.py -v
node scripts/mcp-smoke.mjs
node scripts/lan-smoke.mjs
```

`native-smoke.mjs` uses the real native executable with a simulated extension peer; run it only while the real extension is disconnected. Tests do not bypass real toolbar authorization. `network-sample.ps1` takes a small number of TCP endpoint snapshots; it is not packet capture or proof of zero external traffic. See [VERIFICATION.md](VERIFICATION.md) for the dated acceptance results and their limits.

MCP tool descriptions and setup/register/launcher status messages also support `BB_LANGUAGE=en` or `BB_LANGUAGE=zh-CN`; see the internationalization guide for configuration.
