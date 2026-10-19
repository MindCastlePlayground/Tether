# Tether v1.1.0

[简体中文](RELEASE-v1.1.0.zh-CN.md)

**Release date:** 2026-10-19

## Installation changes

- `--extension-dir PATH` installs the unpacked extension in a separate directory and remembers its location for upgrades and diagnostics.
- `install --upgrade` updates a managed runtime and selected agents' skills in one command.
- `--force` supports same-version reinstallation and backed-up replacement of conflicting Tether files and MCP entries.
- Interactive installation exposes these options. Runtime credentials and extension identity are preserved during upgrades.

## Upgrade

Run `install.bat install --agent codex --upgrade` with the same home/project options as the original installation. Add `--extension-dir "D:\Extensions\Tether"` to choose a separate extension folder. Use `--force` when intentionally replacing conflicts. Reload the extension in the browser after updating; choose the new folder when moving it.

See [installation instructions](INSTALL.md) and [verification](INSTALL-VERIFICATION.md).
