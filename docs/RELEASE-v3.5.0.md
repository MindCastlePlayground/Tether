# Tether 3.5.0

[简体中文](RELEASE-v3.5.0.zh-CN.md) · [Project](../README.md)

## Run scripts on an authorized page

- The `execute` tool is available over MCP and through the Node and Python SDKs. Playwright mode can fill a form, click Save, wait for confirmation, and return selected fields in one call. JavaScript mode can read or update the main frame's DOM, such as extracting a column from an order table.
- Scripts use page authorization and the next write `seq`. Grant the `execute` action explicitly through `tether policy`. Rules can limit access to a client and site origin. The default timeout is eight seconds, and callers can request up to 15 seconds.
- After upgrading, reconnect MCP and reload the browser extension if needed. See [Execute scripts](../skills/tether-browser/SKILL.md#execute-scripts) for the policy command and examples for both modes.

The root installer, runtime, extension and dedicated sandbox all report `3.5.0`.
