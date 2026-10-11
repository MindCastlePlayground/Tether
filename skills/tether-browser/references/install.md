# Install the skill with its MCP server

[简体中文](install.zh-CN.md)

Use the existing installation's `installation.json` locator first. The `tether` server launches `mcpCommand`; `runtime` contains the extension, `.local` credentials, built server, and isolated Python environment. The locator contains paths, not tokens. Agent prefixes vary: discover Tether tools rather than assuming a fixed prefix.

For a checkout, run from its root:

```powershell
npm ci
node bin/tether.mjs install --agent codex --scope project --project PATH --dry-run
node bin/tether.mjs install --agent codex --scope project --project PATH
```

Choose the user's host: `codex`, `claude`, `cursor`, `opencode`, or `gemini`; comma-separated names install several. Project scope changes only that project; `--scope user` installs across projects. Never select every host merely because it is supported. `--runtime PATH` reuses a configured prototype. Otherwise the Windows installer prepares a persistent runtime under `%LOCALAPPDATA%\Tether\runtime`, builds MCP/Native Host launchers, creates an isolated Python environment, and registers Chrome/Edge Native Messaging. It never starts Broker. Existing conflicting entries or skill files stop installation; preserve user edits and resolve the specific conflict.

The root package is not published to npm. From a checkout with installed CLI dependencies, `npm pack --pack-destination work` produces `work/mindcastleplayground-tether-0.1.0.tgz`. The npx route is:

```powershell
npx --yes --package ./work/mindcastleplayground-tether-0.1.0.tgz tether install --agent codex --project PATH
```

Use a real target path in place of `PATH`. The complete bilingual user guide is `<checkout>/docs/INSTALL.md` / `INSTALL.zh-CN.md`; a copied skill does not imply the checkout is next to it.

After installation, restart/reload the agent and complete manual browser loading. To trigger the installed browser's extension manager and folder from the checkout:

```powershell
node bin/tether.mjs extension --runtime PATH --browser chrome --open-browser
```

Here `PATH` is the installed runtime. The user enables Developer mode, chooses **Load unpacked**, and selects its `extension` directory. This command may launch the selected browser; use it only during requested browser setup. Browser loading and MCP tool discovery do not establish live connectivity. Preserve any request to keep Broker stopped, otherwise follow [connection setup](setup.md) for separately authorized startup and `capabilities` verification.
