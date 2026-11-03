# Tether 3.0.0

[简体中文](RELEASE-v3.0.0.zh-CN.md) · [Overview](../README.md)

## Page-reading migration

Remove the standalone `observe` RPC, MCP tool and Node SDK method. Use `snapshot` for a simplified accessibility tree with refs, then the new `html` when complete structure or attributes are needed. This public API removal increments the major version under the `a.b.c` rule, coordinating installer, runtime, extension, sandbox source, SDKs and skills.

The `click`/`fill` option `observe:{...}` still returns a tree in `after`, and the policy action named `observe` remains. Existing permission configurations continue to apply. The text condition of `wait`/`assert` now checks `snapshot.tree`; URL matching remains exact.

## Complete HTML

`html({sessionId,pageId,maxChars?,captureId?,offset?})` first captures the main document's doctype and outerHTML. Continue using the same `captureId` and `nextOffset` until null. Pages default to 16,000 and allow up to 30,000 UTF-16 characters. Captures exceeding 8 Mi characters fail with `html_too_large`. Captures expire after 60 seconds, navigation or a replacement capture.

The complete string remains in a browser-side object and crosses the 512 KiB transport in chunks. The scope is the main document; iframe documents and shadow roots require separate support. Serialized HTML includes hidden content and script text, and live form values can differ from HTML attributes. See [SDK usage](../skills/tether-browser/references/sdk.md).

## Fewer round trips

Skills now direct agents to reuse post-action trees, wait inside the runtime, and switch to HTML when information is missing. Proposed action-plus-wait-plus-tree and reusable fragments are described in the [call-efficiency exploration](CALL-EFFICIENCY.md); this iteration delivers that proposal.

This iteration updates source and documentation. Existing installations and remote deployments require a coordinated upgrade. Restart MCP clients after upgrading to refresh the tool list.

## Verification

Build passed, along with 68 installer tests, 146 runtime tests and 4 Python SDK tests. The real Chrome extension, Native Host, Broker and MCP path read 600,919 HTML characters across 21 chunks, verifying hidden structure, the migrated tool list and capture expiry after navigation.
