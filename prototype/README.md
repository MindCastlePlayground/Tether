# Tether runtime guide

<p align="center"><img src="../assets/logo.png" alt="Tether" width="160"></p>

[简体中文](README.zh-CN.md) · [Project overview](../README.md) · [Installation](../docs/INSTALL.md) · [Internationalization](../docs/I18N.md) · [Verification](VERIFICATION.md)

`prototype/` is a historical directory name retained for path compatibility. It contains the current runtime source: the browser extension, Broker, Native Messaging host, MCP server, Node and Python SDKs, and setup/build scripts. The public installation path is documented in the [installation guide](../docs/INSTALL.md).

## Runtime and protocol

The data path is an existing Chrome browser → MV3 extension → Native Messaging → local TLS WebSocket Broker → Node/Python SDK or stdio MCP. The Broker defaults to loopback. A client can create a task tab group or explicitly attach to one existing HTTP(S) tab. The internal Native Messaging identifier remains `com.freebird.browser_bridge` for compatibility.

The runtime exposes 12 RPC methods: `requestSession`, `approvalStatus`, `listTabs`, `createTab`, `closeTab`, `release`, `observe`, `fill`, `click`, `navigate`, `capabilities`, and `availableTabs`. Write requests use a session-local increasing positive integer `seq`; duplicate identical requests return their prior result, while conflicting reuse is rejected. A timeout is indeterminate, so SDKs do not automatically replay writes.

The extension and authorization state machine are Tether code. Dependencies include the public in-process transport from `playwright-core`, the official MCP SDK, `ws`, and `zod`; Python uses `websockets` and `cryptography`. Protocol validation uses zod and explicit checks.

## Build and run from a checkout

Use Node.js 22+ and Python 3.10+. Run setup from this directory; configuration, certificates, credentials, and generated executables belong in the local runtime directory and should not be committed.

```powershell
npm ci
python -m pip install -r python/requirements.txt
python scripts/setup.py
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launchers.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register.ps1
```

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

## Troubleshooting

The popup displays Broker connection state and a recovery hint. Check that the extension and runtime use matching configuration, certificates, and pin; keep the browser extension and runtime upgraded together. See [installation verification](../docs/INSTALL-VERIFICATION.md) and the [release notes](../docs/RELEASE-v1.0.0.md) for version-specific results.
