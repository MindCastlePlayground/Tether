# M0 Verification Record

[简体中文](VERIFICATION.zh-CN.md) · [Prototype guide](README.md)

Date: 2026-10-11. This record accompanies real-browser testing; a passing build or simulation does not establish end-to-end success. The results below are historical evidence from that date. The documentation internationalization changes add no new test evidence.

| Area | Evidence | Result |
|---|---|---|
| Build | TypeScript compilation succeeded | Passed |
| Node integration tests | `evidence/node-tests.txt`, 30/30; includes FakeChrome authorization tests, default automatic creation/attachment/toggle/revocation, real TLS, frame limits, request deduplication, and asynchronous transport replies | Passed; some tests are simulated |
| Python SDK | `evidence/python-tests.json`, 5/5; sequential calls to the real Broker, invalid credentials, certificate pin checked before HTTP bytes are sent, and proxy bypass | Passed |
| MCP | `evidence/mcp.json`; real `.local/mcp.exe` with the official MCP Client listed 12 tools and called capabilities; the live page flows below also passed | Passed |
| Native Messaging executable | `evidence/native.json`; real EXE, length-prefixed frames, round trip, EOF exit, and rejection of invalid origins; extension peer simulated | Transport passed |
| Existing Chrome extension connection | After the user loaded the extension, the real Broker returned `browserConnected: true`; no browser or profile was launched; attaching to an existing tab succeeded | Passed |
| New group / existing tab / MCP page control | `evidence/live-{newGroup,attachExisting}-{node,mcp}.json`; all 4 flows succeeded: default automatic authorization, read, fill, click and verify saved text, create/close attached page, and release | Passed in real Chrome |
| Existing page lifecycle | Both attachExisting runs preserved the original group; the same tabId remained after release | Passed |
| Authorization isolation | Real Chrome rejected another client using the session/page, rejected a second client attaching to an occupied tab, and rejected observation after release. Simulations also covered group migration, popup origin, disconnect, lease, and toolbar revocation | Core isolation passed in real Chrome; some boundaries simulated only |
| LAN endpoint | `evidence/lan.json`; local calls through `192.168.3.7:18450` succeeded; invalid source CIDR and the Native Host role over LAN were rejected | Same-machine LAN path passed; a second machine was not tested |
| No unexpected egress | `evidence/network-sample.json`; four TCP endpoint snapshots of the prototype Broker/Host/SDK showed zero non-loopback connections. Extension CSP, numeric private-network addresses, certificate pinning, and proxy/redirect restrictions were also inspected | Limited evidence passed; complete zero-egress behavior was not verified |

## Findings fixed during testing

1. The Node SDK closed the connection after each request, immediately losing authorization; it now keeps a persistent connection.
2. The TLS pin must be checked before sending Authorization; Node and Python both verified that an invalid pin sends no HTTP bytes or upgrade request.
3. Duplicate Python TLS wrapping was fixed and tested with a real round trip.
4. The Windows .NET launcher wrote a UTF-8 BOM before the stdin pipe, preventing MCP parsing. BOM-free encoding, binary stream forwarding, and flushing fixed the real EXE handshake.
5. Popup sender handling, duplicate approval, group migration, revocation timing, and disconnect/reconnect were fixed and simulation-tested.
6. Chrome debugger does not support the Browser domain. Version metadata now comes from the extension userAgent; unknown revision/jsVersion fields remain empty. Reloading the extension is required for real acceptance.
7. After a tab group was successfully created, Playwright asserted because the synchronous transport reply arrived before its internal callback was registered. Microtask-based asynchronous dispatch fixed it; regression and final live page actions passed.
8. Playwright requires `DOM.scrollIntoViewIfNeeded` before clicking; it was added to the page-scoped allowlist.
9. `noDefaults` disabled Playwright's default page-focus emulation, causing a stability timeout on background-page clicks. Explicit `Emulation.setFocusEmulationEnabled` on authorized pages fixed all four real browser flows. Browser-wide defaults were not enabled and force-click was not used to bypass checks.

Fixes 6 and 7 were rechecked with the final real-browser tests. Automatically allowing new groups and specified existing tabs was an explicit user policy update and still requires valid client credentials. Turning the switch off stops automatic approval and tab enumeration, but does not revoke existing sessions. The M0 switch was not persisted; reloading the extension restores automatic approval by default.

## Not verified

- The Python SDK passed real-Broker security and sequential-call tests; direct page actions through Python were not separately accepted. Node SDK and the official MCP Client were used for page-action acceptance.
- No second LAN machine was tested. No firewall changes or public listener were used.
- TCP snapshots are not packet capture. They do not cover brief connections, UDP, every dependency's internal paths, or browser sync/reporting. They do not support a claim of strict zero egress for the entire existing browser profile.
- Real Edge, Chrome restart/service-worker crash residue, real drag-in/drag-out, debugger contention, the complete toolbar toggle/revocation UI flow, and OOPIF were not verified. M0 does not implement automatic OOPIF attachment, file transfer, or automatic popup authorization.
- In the 2026-10-11 tests, page content was not sent to a real model; “Agent call” meant an actual MCP tool-protocol call. The model-driven tests below add later evidence. The model-side egress policy depends on the Agent deployment.

## Reruns and security

See the [prototype guide](README.md). The original automated browser scripts operate only on the local synthetic page at `http://127.0.0.1:18444/`; the later model-driven public website test is recorded below. Under the updated user policy, new groups and specified existing pages are automatically approved; test code does not call the approval function directly. Real tab enumeration is used only within the client to find the synthetic page; other page lists are not written to evidence. Approval in FakeChrome unit tests does not affect the real browser.

The `.local/` directory contains credentials and private keys and is restricted to the current local user/SYSTEM ACL. Reports and logs contain no credentials; evidence contains only synthetic data and operation status.

## OpenCode 1.2.27 live browser acceptance — 2026-10-17

An isolated official `opencode-windows-x64@1.2.27` binary reported `1.2.27`. Its configuration and XDG directories stayed under local `work/`, preserving the existing OpenCode installation and user configuration. The configured text model (`deepseek-v4-flash`) made actual Tether MCP calls through stdio, Broker, Native Messaging and the manually loaded Chrome extension. This run used Node with `dist/mcp.js`, rather than the generated MCP EXE launcher. Credentials came from local configuration/environment variables.

| Flow | Actual tool evidence | Result |
|---|---|---|
| Connection | `mcp list` reported Tether connected; after extension loading, `capabilities` returned `browserConnected: true` | Passed |
| Local page | 8 completed calls: capabilities, requestSession, observe, fill, click, observe, closeTab, release. Filling `#name` and clicking `#save` both returned `applied`; observation read back `saved: TETHER_OPENCODE_1_2_27` | Passed |
| Public website | 9 completed calls: capabilities, requestSession, observe, fill, observe, click, observe, closeTab, release. On `https://www.wikipedia.org/`, OpenCode entered `Python` in `#searchInput` and clicked `button[type=submit]`. Observation confirmed `https://zh.wikipedia.org/wiki/Python`, its article title and 16,000 characters of visible text | Passed |
| Cleanup and completion | Both runs closed their created tab, released the session with `ok: true`, and ended with `step_finish` reason `stop`; no error events | Passed |

The selectors for the public homepage were independently inspected before the model run. All reported page reads, fills and clicks were performed by OpenCode through Tether MCP. This establishes real webpage reading, input and navigation; it does not establish automatic discovery of every control. `observe` returns up to 16,000 characters of visible body text, so the article result is not a full-page extraction. This run did not cover Edge, every tool, or all authorization/lifecycle boundaries.

The sanitized event summary is [OpenCode browser evidence](evidence/opencode-1.2.27-browser.json). Raw events, local test configuration and the one-off runner remain in ignored `work/opencode-1.2.27/`. Synthetic and public page content was sent to the configured model during these runs; this is not zero-egress acceptance.
