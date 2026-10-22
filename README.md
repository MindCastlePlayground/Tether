<p align="center">
  <img src="assets/logo.png" alt="Tether" width="180">
</p>

<h1 align="center">Tether</h1>

<p align="center"><strong>Your browser. Connected.</strong></p>

[简体中文](README.zh-CN.md) · [Install guide](docs/INSTALL.md) · [安装指南](docs/INSTALL.zh-CN.md) · [Runtime guide](prototype/README.md) · [运行指南](prototype/README.zh-CN.md) · [Verification summary](prototype/VERIFICATION.md) · [Brand assets](assets/README.md)

Tether lets an authorized local client control explicitly granted pages in an already-running Chrome browser through a browser extension and a local TLS WebSocket broker. It does not require a separate browser profile. When no browser is connected, the MCP server starts the installed Chrome/Edge in the background (`--no-startup-window`) so the extension can connect; set `BB_BROWSER_WAKE=0` to turn this off.

The extension popup supports English and Simplified Chinese through Chrome locale catalogs. It follows the browser language by default and remembers the selected language locally; see the [internationalization guide](docs/I18N.md) / [简体中文指南](docs/I18N.zh-CN.md).

## Features

- Node.js and Python clients, plus a stdio MCP server.
- Create a task tab group (`newGroup`) or attach to one explicitly selected existing HTTP(S) tab (`attachExisting`).
- Session-scoped page permissions, client authentication, TLS certificate and SPKI pin checks, and request sequence deduplication.
- Element snapshot with refs (`snapshot`), precise locator lookup (`locate`), and click/fill that resolve nested text such as `button > div > span` to exactly one element or refuse with candidates.
- Localhost by default; LAN listening requires explicit setup and matching per-client credentials.

## Architecture

```text
Existing Chrome → Tether MV3 extension → Native Messaging → local TLS WebSocket broker
                                                               ├─ Node.js SDK
                                                               ├─ Python SDK
                                                               └─ stdio MCP
```

## Quick start

Use the [installation guide](docs/INSTALL.md) for the CLI-based Windows setup and browser extension loading. The root npm package is private and not published; install from a checkout or local tarball. The historical `prototype/` directory contains the current runtime source and its [operating guide](prototype/README.md).

```powershell
npm ci
node bin/tether.mjs install
```
The installer auto-detects supported agent hosts, and a single command prepares the runtime, configures them, and opens the extension manager page and folder. The installer itself does not start Broker; once loaded, the extension manages it in default `auto` mode and probes every 30 seconds. MCP and Native Host can start Broker for the same runtime. Shared runtime mode `off` prevents MCP from starting it again. The default policy allows all requests, and `tether policy` adds fine-grained allow/deny/ask rules when wanted. Keep generated runtime credentials and private keys on this machine.

## Identity

The folded tether mark connects a navy stem with a teal loop. [Brand assets](assets/README.md) include the transparent master and extension icons.

<img src="assets/popup-preview.png" alt="Tether access popup rendered with a mock extension runtime" width="380">

*Popup preview uses simulated data; it does not connect to a running broker.*

## Repository layout

- `assets/` — Tether brand assets.
- `prototype/` — current extension, broker, SDKs, MCP server, and setup/build scripts; the historical directory name is retained for compatibility.
- `prototype/README.md` — English runtime guide.
- `prototype/README.zh-CN.md` — Simplified Chinese runtime guide.
- [Install guide](docs/INSTALL.md) / [安装指南](docs/INSTALL.zh-CN.md) — install the CLI, configure supported agents, and load the browser extension.
- [Internationalization guide](docs/I18N.md) / [国际化指南](docs/I18N.zh-CN.md) — popup locales, language preference, and translation workflow.
- [Verification summary](prototype/VERIFICATION.md) / [验收摘要](prototype/VERIFICATION.zh-CN.md).

- [Development and releases](docs/DEVELOPMENT.md) — `dev` integration and `main` release workflow.

## Agent skill

Ask an agent to read [skills/tether-browser/SKILL.md](skills/tether-browser/SKILL.md) before using Tether. It covers connection checks, session approval, page IDs, write sequencing, uncertain outcomes and cleanup, with setup and SDK references loaded only when needed. A [Simplified Chinese reading copy](skills/tether-browser/SKILL.zh-CN.md) is included.

The installer copies the full skill folder and configures MCP for supported agent hosts. See the [installation guide](docs/INSTALL.md). For manual skill installation, copy the entire `skills/tether-browser/` folder to the host's configured skill directory, then invoke `$tether-browser`.

## Status

This repository contains the current runtime source and dated build, installation, protocol, and real Chrome acceptance records. Read the [verification summary](prototype/VERIFICATION.md) for recorded results and their limits. The evidence does not establish compatibility with every browser or a zero-external-traffic guarantee for the browser profile.

MCP tool descriptions and setup/register/launcher status messages also support `BB_LANGUAGE=en` or `BB_LANGUAGE=zh-CN`; see the internationalization guide for configuration.
