# Install Tether

[简体中文](INSTALL.zh-CN.md) · [Project overview](../README.md) · [Prototype guide](../prototype/README.md)

See [installer verification](INSTALL-VERIFICATION.md) for tested behavior and remaining checks.

Tether's root package is private and is not published to npm. Use a local checkout or the local tarball workflow below; `npx @mindcastleplayground/tether` is not currently available from the public registry. Fresh runtime installation is supported on Windows with Node.js 22+ and Python 3.10+. The `--runtime` option reuses an already configured prototype and skips dependency/setup work.

## Install from a checkout

From the repository root, install the CLI dependencies and choose one or more agent integrations:

```powershell
npm ci
node bin/tether.mjs install --agent codex,claude,cursor,opencode,gemini --scope project --project . --language en --browser chrome
```

`--agent` is required and accepts a comma-separated selection from `codex`, `claude`, `cursor`, `opencode`, and `gemini`. Omit `--scope` for `project` and `--project` for the current directory. The durable home defaults to `%LOCALAPPDATA%\Tether`; its runtime is `%LOCALAPPDATA%\Tether\runtime`. Fresh setup copies the prototype there, installs locked Node dependencies, builds it, creates an isolated Python environment, installs Python requirements, generates local credentials/certificates, compiles launchers, and registers Native Messaging for both Chrome and Edge under the current Windows user. It never starts Broker.

The installer adds only the Tether MCP entry and copies the complete `skills/tether-browser/` folder with a non-secret `installation.json` locator. Existing configuration comments and unrelated keys are preserved. A config change receives a same-directory backup. Existing conflicting Tether entries or skill files cause the installer to stop; there is no force, replace, or upgrade option. Repeating an install for the same version is idempotent. For a newer version, choose a new `--home` until upgrade support is available.

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

The installed skill prefers configured Tether MCP tools. If needed, it reads `installation.json` to locate the runtime; it does not infer a checkout path from the skill directory. Restart or reload the agent after installation. Project configurations contain absolute machine paths; choose user scope for a personal installation across repositories. Native Messaging has one registration per browser/user for Tether: registering another runtime switches that registration to the new directory, so load the matching extension.

## Load the browser extension

The default install registers Native Messaging for Chrome and Edge, but the extension must be loaded by the user. To open the extension manager and installed extension folder:

```powershell
node bin/tether.mjs extension --runtime "$env:LOCALAPPDATA\Tether\runtime" --browser edge --open-browser
```

Enable Developer mode, choose **Load unpacked**, and select the shown extension folder. This is a manual browser step; Tether does not silently install an extension or publish it to a browser store. `--browser chrome|edge` selects which manager opens.

After installation, restart/reload the agent and open the Tether toolbar popup. Broker remains stopped until separately started. For connection troubleshooting and the deliberate manual setup fallback, see [the setup reference](../skills/tether-browser/references/setup.md) and [prototype guide](../prototype/README.md).

## Local tarball route

The package is private and not published to npm. A local tarball is the reproducible route when the repository itself is not the working directory:

```powershell
npm ci
npm pack --pack-destination work
npx --yes --package ./work/mindcastleplayground-tether-0.1.0.tgz tether install --agent codex --project PATH --home PATH
```

The tarball contains the CLI and prototype sources needed to prepare a fresh runtime. Using a GitHub source with `npx` may require authorized Git access; prefer the local tarball when available.

## Official host documentation

- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) · [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp) · [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Cursor MCP](https://cursor.com/docs/context/mcp) · [Cursor skills](https://cursor.com/docs/skills)
- [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/) · [OpenCode skills](https://opencode.ai/docs/skills/)
- [Gemini CLI MCP servers](https://geminicli.com/docs/tools/mcp-server/) · [Gemini CLI skills](https://geminicli.com/docs/cli/skills/)
