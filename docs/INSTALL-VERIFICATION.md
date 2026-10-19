# Installer verification

[简体中文](INSTALL-VERIFICATION.zh-CN.md) · [Installation](INSTALL.md)

## Version 1.1.0 — 2026-10-19

- 44 installer tests passed, covering forced configuration/skill replacement, backups, concurrent edits, extension location persistence and path overlap rejection.
- Actual Windows installation of 1.0.0 followed by `install --upgrade`, repeat installation and `install --force`. All 13 original `.local` files retained their SHA-256 hashes and the extension identity remained unchanged.
- An external extension directory with Unicode and spaces was remembered. Forced replacement backed up customized content and kept an unrelated file. `doctor` and `extension` resolved the recorded path.
- The final tarball completed a fresh installation into another isolated home and external extension directory. Its standalone `upgrade` command completed against the earlier installation.
- The upgraded MCP executable started from another working directory and exposed 12 tools in each language, reporting 1.1.0 with empty stderr.
- Checks used `--no-register --no-open` and disabled Broker autostart during MCP inspection. Browser loading and live page RPC were not repeated for this installer change.

## Earlier verification

Verified on Windows with Node 24.9.0 and Python 3.12 on 2026-10-11:

- `npm test`: 14 tests covering five hosts' paths/config formats, JSONC/TOML preservation, idempotence, conflicts, backups, complete skill copying, setup-time edit detection, dry-run behavior, browser trigger plans, and registration opt-out.
- `npm pack` and local-package `npm exec` (`npx` equivalent): fresh installation into an isolated `work/` home completed locked dependency installation, TypeScript build, Python venv setup, local credentials and Windows launcher compilation.
- All five project configurations and skills were generated in isolated projects. A repeated installation reused the prepared runtime successfully.
- The installed MCP executable initialized through the official MCP client from a different working directory; both English and Simplified Chinese exposed 12 tools without stderr. No browser RPC was called.
- Package manifest inspection found no `.local`, `.venv`, `node_modules`, `work`, `dist`, or Python cache paths. Installed skill relative links resolved within its copied folder.
- No listener existed on Broker's default port 18443 after verification. The installer did not start Broker.

Fresh installation used `--no-register` to preserve the existing machine's Native Messaging registration. Registration orchestration/opt-out and browser manager paths were tested without opening a browser; actual Chrome/Edge manual loading through this installer and discovery in the five agent applications were not exercised. These checks establish artifact generation and actual MCP stdio startup, not live page control or cross-platform installation.

Local detailed logs/tarballs are ignored under `work/`; credential-bearing runtime files are not published. The root npm package has not been published to a registry.
