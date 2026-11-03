# Tether 2.0.0

[简体中文](RELEASE-v2.0.0.zh-CN.md) · [Project overview](../README.md) · [Runtime guide](../prototype/README.md) · [Browser skill](../skills/tether-browser/SKILL.md)

## Versioning and install

Versions use `a.b.c`: `a` changes for major features or incompatible releases, `b` for compatible features, and `c` for fixes. Major releases update all companion components and documentation. The root package is `2.0.0` and is installed from a checkout or local tarball; it is not published to npm.

The repository intentionally omits lockfiles. Run `npm install` (or `npm install --package-lock=false`) and npm will use the registry or mirror configured on the machine. For example:

```powershell
npm install --package-lock=false
node bin/tether.mjs install
```

## New runtime tools

`diagnose({})` reports connection and policy state. `wait` polls a condition and `assert` retries within the same timeout:

```js
await client.call('wait', { sessionId, pageId, condition: 'text', value: 'Saved', timeoutMs: 3000 });
await client.call('assert', { sessionId, pageId, condition: 'url', value: 'https://example.com/done' });
```

`records({op:'list'|'export'|'clear'})` manages the authenticated identity's in-memory diagnostic metadata, capped at 200 rows. It excludes URLs, page content, selectors, and values. Connections using the same identity share its records; other identities remain isolated. Broker restart clears the journal. The CLI exports records with the configured agent identity:

```powershell
node bin/tether.mjs records --runtime "$env:LOCALAPPDATA\Tether\runtime" --output .\tether-diagnostics.json
```

Business tools add file-input upload, same-origin page GET download, JavaScript dialog handling, and explicit popup discovery/adoption. Uploads allow at most 8 files, 16 MiB each and 32 MiB total; downloads are capped at 16 MiB. Downloads are page fetches, not capture of arbitrary browser downloads. See the [runtime guide](../prototype/README.md) and [browser skill](../skills/tether-browser/SKILL.md) for parameter examples and limits. Popup access requires `popupCandidates` followed by explicit `adoptPopup` for a selected tab.

## Scope and status

Replay has a [design document](REPLAY-DESIGN.md), informed by MinimumWebAuto, covering reusable fragments, runtime inputs, actions and assertions, recording drafts, network modes, and diagnostic artifacts. This iteration delivers the design.

Verification on 2026-11-03: all 68 installer tests, 137 runtime tests, and 4 Python error-contract tests passed. The real Chromium extension, Native Messaging, Broker, and MCP chain passed: a 70 KB cross-process iframe upload, a 90 KB chunked download, JavaScript dialog handling during a click, background-tab popup discovery/adoption/explicit closure, and MCP discovery, waiting, snapshots, post-click observation, and fill redaction.

The browser integration script is `prototype/scripts/locator-e2e.mjs`; set `TETHER_QA_BUSINESS_ONLY=1` for the business subset and `TETHER_QA_CHROME` to select the browser executable. Wait for a business condition after navigation before acting. Earlier evidence remains in the dated [verification summary](../prototype/VERIFICATION.md).

This iteration updates source and documentation; existing installations and the Messenger deployment retain their installed versions. Upgrade the runtime and extension together. The extension adds `webNavigation` permission to identify the actual source of popups opened by background tabs. `release` ends authorization and retains tabs; use `closeTab` to close an adopted popup.
