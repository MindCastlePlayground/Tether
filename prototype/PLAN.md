# M0 implementation and verification

[简体中文](PLAN.zh-CN.md) · [Prototype guide](README.md)

Scope: existing Chrome/Edge only, MV3 Native Messaging extension, local TLS WebSocket broker/host, isolated workspace grants, TypeScript/Python clients and stdio MCP. No launched browser/profile; no browser download. Live checks only use local synthetic test pages. This prototype is not the complete M1.

**Current behavior update:** The implementation also exposes `availableTabs`. To attach to an existing page, a client uses it to find the intended tab and calls `requestSession({mode:'attachExisting',tabId})`. Authenticated clients are automatically approved by default; the toolbar can disable auto-approval, which makes new requests require manual approval and rejects `availableTabs`. Reloading the extension restores the default enabled state. The original approval flow below records the initial plan.

Stages: implement → local security/integration tests → register native host and load extension in existing browser → user popup approval → live tab/group/action/isolation tests → report exact evidence and remaining gates.

Ownership: main agent owns shared protocol, broker/host, installation, Playwright engine adaptation and final integration. Extension agent owns extension/ and extension tests only. Client agent owns src/client.ts, src/mcp.ts, python/, examples/client.ts and client tests only.

## Wire contract

Constants/enums in src/protocol.ts for Node; extension owns extension/protocol.js mirroring wire constants. JSON-RPC over authenticated WSS. Client config JSON: {url, token, caFile, pin}; pin is base64 SHA256 of DER SPKI. Authorization Bearer token header; no Origin accepted. Client URL numeric loopback or explicit RFC1918, TLS verification plus pin; no proxies. Request {jsonrpc:'2.0',id,method,params}; response {jsonrpc:'2.0',id,result} or error {code:-32000,message:enum}. No arbitrary CDP in public RPC.

Public methods: requestSession({mode:'newGroup'|'attachExisting',url?}), approvalStatus({pendingId}), listTabs({sessionId}), createTab({sessionId,seq,url}), closeTab({sessionId,pageId,seq}), release({sessionId,seq}), observe({sessionId,pageId}), fill({sessionId,pageId,seq,selector,value}), click({sessionId,pageId,seq,selector}), navigate({sessionId,pageId,seq,url}), capabilities({}). Requests use opaque session/page IDs. Minimal selector-based M0, not full ref protocol. SDK provides generic call(method,params) and typed convenience wrappers; no implicit retries.

Broker adds trusted clientId to each request (reject public clientId). Native Host WSS authenticates distinct host token and uses role=host fixed config; only one host connection. Host carries identical JSON-RPC to extension via Native Messaging. Broker prefixes IDs opaque UUID, extension responds same ID. Extension receives {method,params:{...userParams,clientId}}. Extension is authorization authority.

Extension requestSession creates pendingId, expires in120s; shows badge. User TOOLBAR popup connects native host, lists local pending approvals and locally enumerates http(s) tabs only for attachExisting; popup approves via internal runtime message, NEVER via native RPC. Requests return pending; approvalStatus returns {status:'pending'|'approved'|'denied'|'expired',sessionId?,pages?:[{pageId,url}],groupId?}. Popup must reject messages unless sender.url EXACT own popup.html and sender.tab absent; no webpage approval page. Native commands cannot approve. approvalStatus ownership checked.

Extension grants map clientId/sessionId/pages. newGroup approve creates blank->group->register->navigate with checks after await; group name BB-short random ID, max10. attachExisting user picks tab; keep original group/position. drag-in no grant, drag-out revokes grouped page. empty task group can recreate. closeTab own created only; release invalidates grant, detach, keeps pages/groups. native disconnect revokes all; debugger detach revokes page; prevent implicit reattach. page HTTP(S) only, own blank may navigate/close only. clientLost internal method revokes client's grants. heartbeat internal method lease15s.

Internal engine methods (not public RPC): cdpAttach({clientId,sessionId,pageId}) -> {tabId,targetInfo,version}; cdp({clientId,sessionId,pageId,method,params,childSessionId?}) -> CDP result; cdpDetach same IDs. Extension validates grants+scope and strict reviewed CDP allowlist. Event notification {method:'cdpEvent',params:{clientId,sessionId,pageId,method,params,childSessionId?}}. Upstream all-profile cookie/storage/Browser commands rejected. M0 no OOPIF child support; fail closed. Playwright public in-process transport handles observe/fill/click, with no direct evaluation fallback. Version metadata comes from extension navigator.userAgent because Chrome debugger excludes the Browser domain; revision/jsVersion are explicitly unknown. Failed CDP logs contain method names only.

Native frame max UTF8 JSON512KiB incl envelope, length-prefix LE. M0 reject oversized frames both ways; chunking deferred explicitly, no partial execution. Error enums only, no raw exceptions/URLs/body logs. Side effects return {sideEffect:'applied'|'none'|'possible',...}; uncertain writes not replayed. Per-session seq highwater plus recent exact request dedup at broker, client ownership enforced at extension. Disconnect clears grants/results.

Verification evidence must separate fake Chrome API tests, real TLS/native processes, actual Chrome extension, actual Agent MCP client, and network observations. No external telemetry/model dependencies; installed dev dependencies may be fetched now, runtime must work offline. Environment failures logged in work/prototype-failures.md.
