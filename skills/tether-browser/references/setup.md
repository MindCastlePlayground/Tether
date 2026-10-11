# Connection setup and troubleshooting

[简体中文](setup.zh-CN.md)

Use `installation.json.runtime` when available, otherwise locate the actual `<checkout>/prototype`. Run runtime commands from that directory; never copy another machine's `.local` credentials. Check for existing configuration and installation before making changes.

## Existing installation

The MCP host normally launches `.local/mcp.exe` using an absolute path. For hosts that accept `mcpServers`, configure:

```json
{
  "mcpServers": {
    "tether": {
      "command": "C:\\path\\to\\Tether\\prototype\\.local\\mcp.exe",
      "env": { "BB_LANGUAGE": "en" }
    }
  }
}
```

Replace the example path. `BB_LANGUAGE` supports `en` and `zh-CN`; omitted means system locale. The launcher loads `.local/agent.json`. New launchers forward the language variable; older ones must be regenerated as described in `<checkout>/docs/I18N.md` (or `I18N.zh-CN.md`). Starting MCP alone does not start Broker.

With startup authorized, check whether the configured Broker already listens (default loopback port 18443). Start only a missing instance, hidden, from the prototype directory:

```powershell
Start-Process -FilePath (Join-Path (Get-Location) '.local\broker.exe') -WindowStyle Hidden
```

If the user asked to keep it stopped, do not run this command. Do not kill another listener or start a duplicate. Open/pin the installed Tether extension; Native Host is started by the extension. After installation or extension source changes the user may need to load/reload it on `chrome://extensions` or `edge://extensions`. Re-check `capabilities` for `browserConnected` after connecting.

## Fresh Windows installation

For supported agent setup, prefer the repository root's installer; see [agent installation](install.md). Fresh installation requires Windows, Node.js 22+, and Python 3.10+. The installer keeps Broker stopped. The manual commands below remain available for direct prototype setup or recovery; they do not configure agent MCP entries.

Requirements: Node.js, Windows PowerShell, Python 3.12, and an existing Chrome/Edge browser. Dependency installation requires registry access. When manual setup is needed:

```powershell
npm ci
python -m pip install -r python/requirements.txt
python scripts/setup.py
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/launchers.ps1
& ./scripts/register.ps1
npm run build
```

Load `prototype/extension/` as an unpacked extension in the existing browser. Fresh setup generates a local extension key/ID and updates `manifest.json`; use that machine's generated ID, not a historical README ID. Setup preserves existing configuration. The internal Native Messaging identifier remains `com.freebird.browser_bridge` for registration compatibility.

Do not execute setup merely as a health check: it creates private material and can update the manifest on fresh installs. Certificates last 30 days and have no automatic rotation. Host registration is current-user Windows registry state. Existing launcher executables are preserved; regeneration requires stopping affected processes and replacing only the intended generated executable.

## Diagnose the failing layer

| Symptom | Check / next action |
| --- | --- |
| MCP tool list works, browser calls fail | Tool listing is offline metadata. Check Broker listener, then extension/Native Host connection. |
| `browserConnected:false` or `host_unavailable` | Existing browser, extension loaded/enabled, correct Native Host registration and local host executable. |
| Connection/TLS/pin failure | Correct role config, matching public certificate, address and certificate expiry. Preserve TLS and pin checks. |
| `pending` with auto-approval off | Ask for toolbar approval; do not call a nonexistent approval RPC. |
| `not_authorized` | Check identity, session lifetime, page ID, grouping and revocation; reacquire only for the intended task. |
| `debugger_busy` | Another debugger may own the tab. Let the user resolve the conflict. |
| `outcome_unknown` | Inspect state before a new write; never assume the action did not occur. |

Runtime supports loopback by default; LAN is an explicit deployment option, not a connection workaround. Do not expose a service, change firewall/trust settings or distribute credentials as an implicit part of a browser task. Read `<checkout>/prototype/README.md` (or `README.zh-CN.md`) when that deployment is specifically requested.

## Offline checks while Broker stays off

```powershell
npm run build
node --test --test-isolation=none --test-reporter=dot test/i18n.test.mjs test/extension.test.mjs
node scripts/brand-preview.mjs
node scripts/i18n-smoke.mjs
```

The popup preview launches an isolated headless test Chrome with a mocked extension runtime. The i18n smoke check needs existing `.local/agent.json` and starts only the MCP stdio process to enumerate descriptions. Neither is live acceptance of browser control. Full `npm test`, `mcp-smoke.mjs`, `live.mjs` and native/LAN checks have different side effects; do not run them as offline health checks.
