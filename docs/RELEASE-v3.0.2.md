# Tether 3.0.2

[简体中文](RELEASE-v3.0.2.zh-CN.md) · [Overview](../README.md)

This release fixes specific failures in browser automation, Broker communication, iframe operations, the dedicated sandbox, and development checks.

## Fixes

### 1. Batch assignment of snapshot refs

- **Problem:** Creating refs for a large-page snapshot caused many CDP round trips and could exceed the 128 pending-request limit.
- **Cause:** The previous implementation issued refs per element through `Promise.all` and converted element handles across execution contexts.
- **Solution:** Use `Refs.batch` to assign refs in one injected selector context. Reuse the isolated/utility world that owns the ARIA refs, and pin Playwright to `1.64.0` for adapter compatibility.
- **Impact:** Large-page snapshots require fewer per-element exchanges, and refs stay in their owning execution context. Playwright upgrades must follow the integration compatibility constraint.

### 2. Broker heartbeats when the queue is full

- **Problem:** A full queue during concurrent reads disconnected a host whose connection was still usable.
- **Cause:** Heartbeat handling treated every error as host loss; an asynchronous error could also affect a newer connection.
- **Solution:** Do not terminate the host for `queue_full`. Apply an asynchronous error only to the host connection associated with the heartbeat that produced it.
- **Impact:** Queue pressure alone no longer interrupts existing sessions, and a stale heartbeat error cannot disconnect a later connection.

### 3. Messages larger than 512 KiB

- **Problem:** An oversized message could close the WebSocket, make the extension silently drop a reply, or leave a request waiting; a CDP payload error could appear as an 8-second timeout.
- **Cause:** Failed sends did not clear pending requests; the extension and Broker did not return an explicit error tied to the RPC; Playwright retries could hide the underlying payload error.
- **Solution:** Clear the timer and pending state when sending fails. Return `payload_too_large` with the matching RPC id for oversized responses while keeping the native port and session open. `Engine.run` records the underlying error for the current call with `AsyncLocalStorage`, returning it accurately without affecting concurrent or later calls.
- **Impact:** Oversized requests return a recognizable error while the connection and session remain available. The 512 KiB limit remains; uncertain write results still return `outcome_unknown`, and writes are not replayed automatically.

### 4. iframe control location and refs

- **Problem:** Ordinary control location and refs covered only the main document, preventing stable operations on controls inside iframes.
- **Cause:** Locators lacked a frame path, Refs searched only the main document, and `DOM.getFrameOwner`, required for OOPIF mouse-coordinate conversion, was absent from the CDP allowlist.
- **Solution:** Support Locators such as `frame=iframe#vendor >> input`, frame-scoped refs, and `scopeRef` snapshot mappings. Keep element identity fixed and reject refs after replacement. Allow `DOM.getFrameOwner` within existing page authorization limits.
- **Impact:** iframe controls can be filled, clicked, and referenced. This does not change network collection scope or imply full iframe HTML or network support.

### 5. Clicking a popup tab

- **Problem:** Clicks in a background popup timed out after 8 seconds because visibility, enabled-state, or stability checks stalled.
- **Cause:** Animation frames and stability checks did not advance normally in the background tab.
- **Solution:** Call `page.bringToFront` before clicking and allow `Page.bringToFront` within the session's existing authorization. Continue to use a real mouse click.
- **Impact:** A click brings the target authorized tab to the foreground, a visible browser behavior change.

### 6. Blank tabs during new-group approval

- **Problem:** `newGroup approve` sometimes returned `denied` even though Chrome subsequently created the target tab.
- **Cause:** Approval immediately checked the URL and group after reading `pendingUrl=about:blank`; `createTab` had a wait flow, but `approve` did not.
- **Solution:** Add bounded `BlankWait`/`BlankPoll` handling, recheck pending state while waiting, then validate the actual URL and group.
- **Impact:** When tab creation is delayed, authorization checks use the resulting URL and group, reducing intermittent denials.

### 7. Extension reloads in the dedicated sandbox

- **Problem:** Reloading the extension in the dedicated sandbox could leave `DISABLE_RELOAD=4` or produce `unsupportedDeveloperExtension`, leaving the extension unready.
- **Cause:** The persistent profile cached old modules, terminating Chrome too early interrupted reload, and the profile had developer mode disabled.
- **Solution:** Detect source changes by content signature. Trigger reload through `developerPrivate.reload` on `chrome://extensions` and wait for completion. Enable developer mode and Tether in the dedicated profile, connect to CDP to handle the extension, then wait for Native ready.
- **Impact:** The dedicated sandbox completes extension reload and Native initialization while preserving the profile and data volume. This fix applies to the dedicated sandbox.

### 8. JavaScript dialogs in the sandbox

- **Problem:** Playwright checks in the sandbox dismissed JavaScript dialogs by default, competing with Tether's response handling.
- **Cause:** The check connection had no dialog listener, so Playwright used its default dismiss behavior for unhandled dialogs.
- **Solution:** Register a listener that only observes dialogs; acceptance or dismissal remains with the authorized Tether session.
- **Impact:** Real `prompt`/`confirm` dialogs in the sandbox are answered by the Tether session.

### 9. Node 22 and test environment isolation

- **Problem:** Node 22 did not support the isolation argument used by the original test command; Linux checks also failed due to user-directory differences and Windows installer layout assumptions.
- **Cause:** Test commands used an argument unavailable in Node 22, Linux `HOME` and `USERPROFILE` differed, and installer tests assumed Windows and npm directory layouts.
- **Solution:** Adjust root test arguments, isolate runtime tests serially per file and unify `HOME`, and use local test doubles for Windows installer logic.
- **Impact:** Relevant development checks run on Node 22 and Linux. This does not make the Windows installer natively supported on Linux.

### 10. Validation cleanup for the ten local business simulations

- **Problem:** Assertions ran before the DOM finished updating after synthetic business data was written; leftover HTTP connections could stall server shutdown.
- **Cause:** Assertions did not wait for explicit page confirmation, active connections were not cleared before shutdown, and close/release failures did not affect the failure result.
- **Solution:** Wait for page confirmation before asserting. Call `closeAllConnections` after assertions and count close/release failures as validation failures.
- **Impact:** Results for the ten scenarios reflect confirmed page state, and cleanup failures appear in the exit result.

### 11. Design-document references

- **Problem:** `docs:check` failed because design documentation referenced relative paths outside the repository.
- **Cause:** The documents depended on local materials outside the repository.
- **Solution:** Replace external path references with descriptions of the local materials.
- **Impact:** Design documents can be checked and read from an independent repository checkout.

## Validation

2026-11-06: build, 68 root tests, 156 runtime tests, and bilingual documentation checks passed. Grok 4.7 drove ten local business simulations through real Chromium, the extension, Native Messaging, Broker, and MCP; one complete run passed 10/10, including session cleanup. See the [replay command and scenarios](../sandbox/README.md#完整业务验证).
