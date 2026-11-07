# Tether 3.2.0

[简体中文](RELEASE-v3.2.0.zh-CN.md) · [Project](../README.md)

## DeepSeek Harness installer support

- **Problem:** The installer could not detect or configure dsh.
- **Cause:** Agent detection and destinations covered five clients, with only JSON and TOML configuration writers. DSH uses Cordis YAML patch lists.
- **Solution:** Add `--agent dsh`, automatic PATH/home detection, the wizard option, and a stdio `@deepseek-ai/dsh-mcp-client` insert patch. Install the browser Skill alongside it. Preserve YAML comments, custom tags and unrelated entries; conflicting Tether entries require `--force` and the existing backup flow.
- **Impact:** User installs use `$DSH_HOME/cordis.patch.yml` and `$DSH_HOME/skills/tether-browser` (default home: `~/.dsh`). Project installs use `.dsh/cordis.patch.yml` and `.dsh/skills/tether-browser`; launch with `dsh --patch .dsh/cordis.patch.yml`. Existing clients and browser behavior remain unchanged. The installer does not install dsh or authenticate it.

## Validation

Root installer tests cover isolated configuration and Skill installation, repeat installation, YAML preservation, conflicts, detection and custom homes. The current development host has no dsh executable, so launching dsh itself was not verified.

Configuration follows the [official MCP client contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md) and [profile patch loading order](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md).
