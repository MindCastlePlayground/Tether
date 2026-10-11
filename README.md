<p align="center">
  <img src="assets/logo.png" alt="Tether" width="180">
</p>

<h1 align="center">Tether</h1>

<p align="center"><strong>Your browser. Connected.</strong></p>

[简体中文](README.zh-CN.md) · [Prototype guide](prototype/README.md) · [原型中文指南](prototype/README.zh-CN.md) · [Verification record](prototype/VERIFICATION.md)

Tether lets an authorized local client control explicitly granted pages in an already-running Chrome browser through a browser extension and a local TLS WebSocket broker. It does not launch a browser or require a separate browser profile.

## Features

- Node.js and Python clients, plus a stdio MCP server.
- Create a task tab group (`newGroup`) or attach to one explicitly selected existing HTTP(S) tab (`attachExisting`).
- Session-scoped page permissions, client authentication, TLS certificate and SPKI pin checks, and request sequence deduplication.
- Localhost by default; LAN listening requires explicit setup and matching per-client credentials.

## Architecture

```text
Existing Chrome → Tether MV3 extension → Native Messaging → local TLS WebSocket broker
                                                               ├─ Node.js SDK
                                                               ├─ Python SDK
                                                               └─ stdio MCP
```

## Quick start

See the [prototype guide](prototype/README.md) for prerequisites, first-time setup, browser extension loading, client configuration, and security boundaries. From `Tether/prototype`, the initial setup is:

```powershell
npm ci
python -m pip install -r python/requirements.txt
python scripts/setup.py
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/launchers.ps1
& ./scripts/register.ps1
npm run build
```

The guide also documents how to start the local broker and register Native Messaging. Keep the generated `.local/` credentials and private keys on this machine.

## Identity

The folded tether mark connects a navy stem with a teal loop. [Brand assets](assets/README.md) include the transparent master and extension icons.

<img src="assets/popup-preview.png" alt="Tether access popup rendered with a mock extension runtime" width="380">

*Popup preview uses simulated data; it does not connect to a running broker.*

## Repository layout

- `assets/` — Tether brand assets.
- `prototype/` — current extension, broker, SDKs, MCP server, setup scripts, and verification evidence.
- `prototype/README.md` — full English operating guide.
- `prototype/README.zh-CN.md` — full Simplified Chinese operating guide.

## Status

This repository contains a working prototype with recorded build, simulated, protocol, and real Chrome evidence. Read [VERIFICATION.md](prototype/VERIFICATION.md) for exactly what passed and what remains unverified. Edge, a second LAN machine, and several M0 items remain unverified or unimplemented; the evidence does not establish a complete zero-external-traffic guarantee for the browser profile.
