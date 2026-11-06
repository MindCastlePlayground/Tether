# Tether 3.1.0

[简体中文](RELEASE-v3.1.0.zh-CN.md) · [Overview](../README.md)

## Named tab groups

- **Problem:** Automatically created task groups had random names, making concurrent tasks hard to distinguish.
- **Cause:** `requestSession` had no group-name parameter, and the extension always generated a default name.
- **Solution:** Add `groupName` and an independent “Custom group names” switch. Use the supplied name when enabled; otherwise, or without a supplied name, use the default. Names accept 1–80 characters, reject control characters and whitespace-only values, and trim surrounding whitespace.
- **Impact:** Newly created task groups, separate groups created with `createTab` in attached sessions, and MCP/Node SDK request parameters. Existing user groups keep their names; matching names do not merge groups or expand grants. Switch changes affect subsequent group creation.

## Direct attachment to existing tabs

- **Problem:** Direct attachment to existing tabs and automatic approval of new task groups shared one switch.
- **Cause:** An `attachExisting` request with `tabId` checked only the auto-approval master switch.
- **Solution:** Add an independent “Direct tab takeover” switch. When off, requests require manual approval and `availableTabs` stops enumerating tabs to agents. When on, the auto-approval master switch and policy rules still apply; policy `ask` requires approval. Requests that need approval send notifications normally.
- **Impact:** Tab discovery, session requests, approval notifications, and extension preferences. Attachment does not navigate, move, or rename the existing tab, and release leaves it open. Changing a switch does not revoke existing grants; sessions can be revoked from the session list.

Both new switches default to on, persist locally, and restore after extension reload. The root installer, runtime, extension, and dedicated sandbox versions are aligned at `3.1.0`.

## Validation

2026-11-07: 68 root tests, 161 runtime tests, build, and bilingual documentation checks passed. Real Chromium toolbar-popup and stdio MCP verification covered name validation, the naming switch, keyboard focus and disclosure state, manual tab selection, direct attachment and page reading, the master switch, preference restoration after browser restart, and Chinese labels. The complete flow and session cleanup exited successfully. Light and dark popup layouts were checked. The dedicated sandbox was stopped after verification.
