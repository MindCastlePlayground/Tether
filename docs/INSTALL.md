# Install Tether

[简体中文](INSTALL.zh-CN.md) · [Project overview](../README.md) · [Prototype guide](../prototype/README.md)

See [installer verification](INSTALL-VERIFICATION.md) for tested behavior and remaining checks.

Tether's root package is private and is not published to npm. Use a local checkout or the local tarball workflow below; `npx @mindcastleplayground/tether` is not currently available from the public registry. Fresh runtime installation is supported on Windows with Node.js 22+ and Python 3.10+. The `--runtime` option reuses an already configured prototype and skips dependency/setup work.

## Install from a checkout

Double-click the root `install.bat` to open the interactive installer, or run:

```powershell
.\install.bat
```

The BAT entry checks Node.js 22+ and installs missing CLI dependencies with npm. With no arguments it keeps the window open on exit so errors remain visible. It also forwards explicit commands, for example `.\install.bat install --agent codex --dry-run` or `.\install.bat upgrade`. Relative paths and the default project directory use the caller's working directory. Dependency setup may write `node_modules` even when the forwarded command is a dry run.

With a terminal attached, running `node bin/tether.mjs` with no arguments starts an interactive install guide. It asks for the Agent selection, scope and paths, Python executable, browser, language, Native Messaging registration, browser opening, and optional preview mode; pressing Enter keeps the shown default. Scope defaults to `auto`: project scope for most agents, user scope for OpenCode. Ctrl+C or end of input cancels with exit code 130. With no terminal attached, no arguments still prints help, and explicit commands and flags remain available for scripts.

`--agent` is optional and defaults to `auto`, which detects installed `codex`, `claude`, `cursor`, `opencode`, and `gemini` hosts and configures all of them; pass a comma-separated selection to restrict it. Omit `--scope` for `project` (OpenCode defaults to user scope, `~/.config/opencode`) and `--project` for the current directory; `--scope user` installs across projects. The durable home defaults to `%LOCALAPPDATA%\Tether`; its runtime is `%LOCALAPPDATA%\Tether\runtime`. Fresh setup copies the prototype there, installs locked Node dependencies, builds it, creates an isolated Python environment, installs Python requirements, generates local credentials/certificates, compiles launchers, and registers Native Messaging for both Chrome and Edge under the current Windows user. After success it opens the extension manager page and the extension folder; `--no-open` skips that, and a missing browser only prints a notice. The installer itself never starts Broker; once loaded, the extension manages it in default `auto` mode. MCP and Native Host can start Broker for the same runtime after TLS, certificate pin, and authentication checks (see below).

The installer adds only the Tether MCP entry and copies the complete `skills/tether-browser/` folder with a non-secret `installation.json` locator. Existing configuration comments and unrelated keys are preserved. A config change receives a same-directory backup. Existing conflicting Tether entries or skill files stop normal installation; use the explicit upgrade or force options below to replace managed content. Repeating an install for the same version is idempotent. The installer itself does not start Broker. Once loaded, the extension manages it in default `auto` mode and probes every 30 seconds. MCP and Native Host can start Broker only for the same runtime after TLS, certificate pin, and authentication checks. It never kills or reuses an unrelated service and never switches ports. Broker startup failures set minimum backoff delays of 1, 2, 4, 8, and 16 seconds; probes normally run about every 30 seconds and Chrome may delay them. Five consecutive failures enter `blocked`. Native Host reconnects independently with backoff capped at 30 seconds. Shared runtime mode `off` prevents MCP from starting Broker again. To upgrade the runtime separately, run:

```powershell
node bin/tether.mjs upgrade [--home PATH | --runtime PATH]
```

### Custom extension directory, upgrades and forced replacement

`--extension-dir PATH` selects the extension folder loaded by the browser, including another drive or a path with spaces or Unicode. When omitted, the recorded location is reused; the first install defaults to `<runtime>/extension`. Subsequent `upgrade`, `extension` and `doctor` commands use that location. Reload the extension in the browser after upgrading; select the new folder in the browser when moving it.

```powershell
.\install.bat install --agent codex --home "D:\Apps\Tether" --extension-dir "E:\浏览器扩展\Tether"
.\install.bat install --agent codex --home "D:\Apps\Tether" --upgrade
.\install.bat install --agent codex --home "D:\Apps\Tether" --force
```

`install --upgrade` upgrades the managed runtime and updates the selected agents' Tether skills. `--force` reinstalls the same version and backs up conflicting Tether MCP entries, skills and extension files before replacing them. Unrelated MCP entries and local credentials are preserved. Normal installation still stops on conflicts; use `--dry-run` to inspect paths before replacing customized content. Interactive installation also offers extension directory, upgrade and forced replacement options.

The upgrade stops this runtime's running Broker and Native Host (including 0.x Brokers that lack the lifecycle endpoints), and restarts the Broker on the new code if it was running. The extension reloads itself once no session is active; an extension loaded before this release needs one manual Reload on the extensions page. Restart open agent sessions to use the new MCP. The upgrade replaces the runtime sources, preserves `.local` (credentials, certificates, policy) and `.venv`, keeps the extension ID unchanged, re-runs `npm ci`/build and the Python install, and leaves agent configuration untouched.

Use `--runtime PATH` to reuse an already configured prototype. This skips runtime copy, dependencies, build, Python setup, and credential generation; it still registers Native Messaging unless `--no-register` is supplied. `--no-register` skips HKCU registration. `--python PATH` selects the interpreter for a fresh isolated environment, and `--language en|zh-CN` sets MCP descriptions and setup messages.

Preview the planned paths and config changes without filesystem or process mutation:

```powershell
node bin/tether.mjs install --agent codex --dry-run
```

`doctor` reports runtime metadata and expected artifacts only; it does not test connectivity or start Broker:

```powershell
node bin/tether.mjs doctor --home "$env:LOCALAPPDATA\Tether"
```

## Agent configuration locations

| Agent | Project configuration and skill | User configuration and skill |
| --- | --- | --- |
| Codex | `.codex/config.toml`; `.agents/skills/tether-browser/` | `CODEX_HOME/config.toml` (or `~/.codex/config.toml`); `~/.agents/skills/tether-browser/` |
| Claude Code | `.mcp.json`; `.claude/skills/tether-browser/` | `~/.claude.json`; `~/.claude/skills/tether-browser/` |
| Cursor | `.cursor/mcp.json`; `.cursor/skills/tether-browser/` | Same paths under the user home |
| OpenCode | `opencode.json` or `opencode.jsonc`; `.opencode/skills/tether-browser/` | `$XDG_CONFIG_HOME/opencode/` or `~/.config/opencode/` configuration and skills |
| Gemini CLI | `.gemini/settings.json`; `.gemini/skills/tether-browser/` | Same paths under the user home |

OpenCode 1.2.27 and later are supported. In user scope the installer writes `opencode.jsonc` (or an existing `opencode.json`/`opencode.jsonc`) and `skills/tether-browser/` under `$XDG_CONFIG_HOME/opencode/` or `~/.config/opencode/`, the path OpenCode reads on Windows too, not `%APPDATA%`. OpenCode 1.2.27 validates `mcp.tether` strictly, so the entry contains only `type`, `command`, `environment`, and `enabled`. With OpenCode 1.2.27 installed in isolation, `opencode debug skill` listed `tether-browser` and `opencode mcp list` reported `tether connected`.

The installed skill prefers configured Tether MCP tools. If needed, it reads `installation.json` to locate the runtime; it does not infer a checkout path from the skill directory. Restart or reload the agent after installation. Project configurations contain absolute machine paths; choose user scope for a personal installation across repositories. Native Messaging has one registration per browser/user for Tether: registering another runtime switches that registration to the new directory, so load the matching extension.

## Load the browser extension

The default install registers Native Messaging for Chrome and Edge, but the extension must be loaded by the user. To open the extension manager and installed extension folder:

```powershell
node bin/tether.mjs extension --runtime "$env:LOCALAPPDATA\Tether\runtime" --browser edge --open-browser
```

Enable Developer mode, choose **Load unpacked**, and select the shown extension folder containing `manifest.json` and `【选择此目录加载Tether扩展】.txt`. Select the directory itself, not its parent or the manifest file. This is a manual browser step; Tether does not silently install an extension or publish it to a browser store. `--browser chrome|edge` selects which manager opens.

After installation, restart/reload the agent and open the Tether toolbar popup. Use the popup to enable or disable extension management. In default `auto` mode it probes every 30 seconds. Renew expired certificates with the matching pin; keep TLS verification enabled. For connection troubleshooting and the deliberate manual setup fallback, see [the setup reference](../skills/tether-browser/references/setup.md) and [prototype guide](../prototype/README.md).

## Permission policy

Broker is managed by default: the policy file is `<runtime>/.local/policy.json`, and its absence means all requests are allowed. The file is hot-reloaded, so edits take effect immediately. Rules are evaluated first-match:

- `version` — must be `1`.
- `id` — unique rule identifier.
- `client` — `"*"` or a client identity.
- `origin` — `"*"` or `scheme://host[:port]`; a leading `*.` in the host matches subdomains and the bare domain.
- `actions` — `session`, `availableTabs`, `observe`, `fill`, `click`, `navigate`, `createTab`, `closeTab`, or `"*"`.
- `effect` — `allow`, `deny`, or `ask`; `ask` is only valid with `actions: ["session"]`.
- `default` — `allow` or `deny` when no rule matches.

```json
{
  "version": 1,
  "default": "allow",
  "rules": [
    { "id": "bank-readonly", "client": "*", "origin": "https://*.bank.com", "actions": ["fill", "click", "navigate"], "effect": "deny" },
    { "id": "confirm-session", "client": "*", "origin": "*", "actions": ["session"], "effect": "ask" }
  ]
}
```

A denied request returns `policy_denied`. A corrupt or invalid file rejects everything except `capabilities` with `policy_invalid` (fail-closed); `capabilities` reports `policy: {default, rules, valid}`. A queued write is re-checked against the page's current origin when it executes. With `ask`, that session request is not auto-approved and needs manual approval in the popup.

```powershell
node bin/tether.mjs policy list
node bin/tether.mjs policy add --effect deny --actions fill,click,navigate --origin https://*.bank.com [--client C] [--id ID] [--first]
node bin/tether.mjs policy remove --id ID
node bin/tether.mjs policy default allow|deny
node bin/tether.mjs policy path
node bin/tether.mjs policy reset
```

## Local tarball route

The package is private and not published to npm. A local tarball is the reproducible route when the repository itself is not the working directory:

```powershell
npm ci
npm pack --pack-destination work
npx --yes --package ./work/mindcastleplayground-tether-1.1.0.tgz tether install --agent codex --project PATH --home PATH
```

The tarball contains the CLI and prototype sources needed to prepare a fresh runtime. Using a GitHub source with `npx` may require authorized Git access; prefer the local tarball when available.

## Official host documentation

- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) · [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp) · [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Cursor MCP](https://cursor.com/docs/context/mcp) · [Cursor skills](https://cursor.com/docs/skills)
- [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/) · [OpenCode skills](https://opencode.ai/docs/skills/)
- [Gemini CLI MCP servers](https://geminicli.com/docs/tools/mcp-server/) · [Gemini CLI skills](https://geminicli.com/docs/cli/skills/)
