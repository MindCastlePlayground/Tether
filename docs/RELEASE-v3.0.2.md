# Tether 3.0.2

[简体中文](RELEASE-v3.0.2.zh-CN.md) · [Overview](../README.md)

Patch release with reliability fixes for browser automation. Refs batch assignment now reduces per-element round trips during snapshots. Broker heartbeats tolerate a full queue without disconnecting the host, oversized requests clear pending state, and oversized responses return `payload_too_large`. The extension also reports oversized responses while keeping the native port open.

Pin Playwright to 1.64.0 for compatibility with the current integration.

Test commands support Node 22, and Linux test fixtures isolate their home directories and Windows setup assumptions. Design references no longer link to files outside this repository.

Frame form controls now use the same frame selector syntax as uploads, with document-scoped refs that reject replaced elements. Payload errors survive the CDP adapter without affecting later requests. The dedicated sandbox waits for Chrome to finish extension reloads, enables its unpacked extension, and leaves JavaScript dialogs for Tether to answer.

## Validation

2026-11-06: build, 68 root tests, 156 runtime tests and bilingual documentation checks passed. Grok 4.7 drove all ten local business simulations through real Chromium, the extension, Native Messaging, Broker and MCP; one complete run passed 10/10, including session cleanup. See the [replay command and scenarios](../sandbox/README.md#完整业务验证).
