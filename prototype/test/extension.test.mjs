import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionController } from '../extension/controller.js';
import { NativeStatus, PopupMessage, Storage, Wire } from '../extension/protocol.js';

class Event {
  listeners = [];
  addListener(fn) { this.listeners.push(fn); }
  fire(...args) { for (const fn of this.listeners) fn(...args); }
}

class FakeChrome {
  constructor() {
    this.runtime = {
      onConnect: new Event(),
      connectNative: () => { this.nativeConnections++; return this.native; },
      getURL: name => `chrome-extension://unit/${name}`,
      getBrowserInfo: async () => ({ name: 'Chrome', version: 'test' })
    };
    this.nativeConnections = 0;
    this.native = { onMessage: new Event(), onDisconnect: new Event(), messages: [], postMessage: m => this.native.messages.push(m) };
    this.action = { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} };
    this.storage = {
      data: {},
      local: {
        get: async key => (Object.hasOwn(this.storage.data, key) ? { [key]: this.storage.data[key] } : {}),
        set: async values => { Object.assign(this.storage.data, values); }
      }
    };
    this.tabs = {
      onRemoved: new Event(), onReplaced: new Event(), onUpdated: new Event(), onAttached: new Event(), onDetached: new Event(),
      data: new Map([[1, { id: 1, url: 'https://example.test/a', title: 'Example', groupId: -1 }]]), next: 2,
      query: async () => [...this.tabs.data.values()],
      get: async id => { const tab = this.tabs.data.get(id); if (!tab) throw new Error('missing'); return { ...tab }; },
      create: async () => { const id = this.tabs.next++; const tab = { id, url: 'about:blank', title: '', groupId: -1 }; this.tabs.data.set(id, tab); return { ...tab }; },
      group: async ({ tabIds, groupId }) => { const gid = groupId ?? 9; for (const id of tabIds) this.tabs.data.get(id).groupId = gid; return gid; },
      update: async (id, changes) => { const tab = this.tabs.data.get(id); Object.assign(tab, changes); return { ...tab }; },
      remove: async id => { this.tabs.data.delete(id); }
    };
    this.tabGroups = { onUpdated: new Event(), update: async id => ({ id }) };
    this.debugger = {
      calls: [], onEvent: new Event(), onDetach: new Event(), attach: async target => this.debugger.calls.push(['attach', target]),
      detach: async target => this.debugger.calls.push(['detach', target]),
      getTargets: async () => [...this.tabs.data.values()].map(t => ({ tabId: t.id, type: 'page', url: t.url })),
      sendCommand: async (target, method, params) => { this.debugger.calls.push([method, target, params]); if(method==='Target.getTargetInfo')return {targetInfo:{targetId:String(target.tabId),type:'page'}};if(method==='Browser.getVersion')return {product:'Chrome/test',userAgent:'Chrome'};return { result: { value: true } }; }
    };
  }
}

const clientA = 'client-alpha-0001';
test('native disconnect consumes lastError synchronously and exposes recovery status', async () => {
  const api = new FakeChrome();
  let reads = 0;
  Object.defineProperty(api.runtime, 'lastError', { get() { reads++; return { message: 'Native host has exited.' }; } });
  const c = new ExtensionController(api);
  c.connect();
  c.stopped = true;
  api.native.onDisconnect.fire();
  assert.equal(reads, 1);
  const messages = [];
  await c.popup({ type: PopupMessage.Status }, { url: api.runtime.getURL('popup.html') }, { postMessage: m => messages.push(m) });
  assert.equal(messages[0].code, NativeStatus.Host);
  assert.equal(messages[0].detail, 'Native host has exited.');
});

test('native diagnosis survives disconnect, pushes to popup, and clears on recovery', () => {
  const api = new FakeChrome();
  const c = new ExtensionController(api);
  const messages = [];
  c.popups.add({ postMessage: m => messages.push(m) });
  c.connect();
  api.native.onMessage.fire({ type: NativeStatus.Type, state: NativeStatus.Error, code: 'broker_unavailable' });
  c.stopped = true;
  api.native.onDisconnect.fire();
  assert.equal(c.status.code, 'broker_unavailable');
  api.native.onMessage.fire({ type: NativeStatus.Type, state: NativeStatus.Connected });
  assert.equal(messages.at(-1).state, NativeStatus.Connected);
  assert.equal(c.status.code, undefined);
  assert.equal(api.native.messages.length, 0);
});
const clientB = 'client-bravo-0002';

async function approvedExisting() {
  const api = new FakeChrome();
  const c = new ExtensionController(api, undefined, () => 'Mozilla/5.0 Chrome/145.0.0.0');
  const pending = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'attachExisting' });
  await c.approve(pending.pendingId, 1);
  return { api, c, pending, approved: await c.approvalStatus({ clientId: clientA, pendingId: pending.pendingId }) };
}

function manual(c) { c.autoApprove = false; return c; }

test('request exposes no page metadata until the user approves in the extension popup', async () => {
  const api = new FakeChrome();
  const c = manual(new ExtensionController(api));
  const p = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'attachExisting' });
  assert.deepEqual(p, { pendingId: p.pendingId, status: Wire.Pending });
  assert.equal(Object.hasOwn(p, 'pages'), false);
  assert.equal((await c.approvalStatus({ clientId: clientB, pendingId: p.pendingId })).status, Wire.Expired);
});

test('an explicit _ask request always waits for popup approval', async () => {
  const api = new FakeChrome();
  const c = new ExtensionController(api);
  const result = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'attachExisting', tabId: 1, _ask: true });
  assert.deepEqual(result, { pendingId: result.pendingId, status: Wire.Pending });
  assert.equal(c.pending.size, 1);
  assert.equal(c.sessions.size, 0);
});

test('auto approval returns the approved session without polling', async () => {
  const api = new FakeChrome();
  const c = new ExtensionController(api);
  const result = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'newGroup' });
  assert.equal(result.status, Wire.Approved);
  assert.ok(result.sessionId);
  assert.equal(result.pages.length, 1);
  assert.ok(Number.isInteger(result.groupId));
  assert.equal(c.pending.size, 0);
  assert.equal(c.sessions.size, 1);
});

test('new-group requests are automatically approved and remain revocable', async () => {
  const api = new FakeChrome();
  const c = new ExtensionController(api);
  const p = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'newGroup' });
  const result = await c.approvalStatus({ clientId: clientA, pendingId: p.pendingId });
  assert.equal(result.status, Wire.Approved);
  assert.equal(api.tabs.data.size, 2);
  const port = { postMessage() {} };
  await c.popup({ type: 'popup.revoke', sessionId: result.sessionId }, { url: api.runtime.getURL('popup.html') }, port);
  assert.equal(c.sessions.size, 0);
  assert.equal(c.pages.size, 0);
});

test('auto approval switch disables both automatic grants and tab enumeration', async () => {
  const api = new FakeChrome();
  const c = new ExtensionController(api);
  const sender = { url: api.runtime.getURL('popup.html') };
  const messages = [];
  const port = { postMessage: value => messages.push(value) };
  await c.popup({ type: 'popup.setAutoApproval', enabled: false }, sender, port);
  assert.equal(messages[0].enabled, false);
  const group = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'newGroup' });
  assert.equal((await c.approvalStatus({ clientId: clientA, pendingId: group.pendingId })).status, Wire.Pending);
  const attach = await c.dispatch(Wire.SessionRequest, { clientId: clientB, mode: 'attachExisting', tabId: 1 });
  assert.equal((await c.approvalStatus({ clientId: clientB, pendingId: attach.pendingId })).status, Wire.Pending);
  await assert.rejects(c.dispatch(Wire.AvailableTabs, { clientId: clientA }), /not_authorized/);
});

test('the popup toggle persists the auto approval preference to storage', async () => {
  const api = new FakeChrome();
  const c = new ExtensionController(api);
  const messages = [];
  const port = { postMessage: value => messages.push(value) };
  await c.popup({ type: 'popup.setAutoApproval', enabled: false }, { url: api.runtime.getURL('popup.html') }, port);
  assert.equal(api.storage.data[Storage.AutoApprove], false);
  assert.deepEqual(messages.at(-1), { type: 'popup.autoApproval', enabled: false });
});

test('a restarted controller honors the stored auto approval preference', async () => {
  const api = new FakeChrome();
  const first = new ExtensionController(api);
  await first.popup({ type: 'popup.setAutoApproval', enabled: false }, { url: api.runtime.getURL('popup.html') }, { postMessage() {} });
  const second = new ExtensionController(api);
  second.start();
  await assert.rejects(second.dispatch(Wire.AvailableTabs, { clientId: clientA }), /not_authorized/);
  const pending = await second.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'newGroup' });
  assert.equal(pending.status, Wire.Pending);
  assert.equal(second.sessions.size, 0);
  second.stop();
});

test('missing preference storage keeps auto approval enabled', async () => {
  const api = new FakeChrome();
  delete api.storage;
  const c = new ExtensionController(api);
  c.start();
  const tabs = await c.dispatch(Wire.AvailableTabs, { clientId: clientA });
  assert.equal(tabs.tabs.length, 1);
  c.stop();
});

test('authenticated clients can enumerate HTTP(S) tabs only while auto approval is enabled', async () => {
  const api = new FakeChrome();
  api.tabs.data.set(2, { id: 2, url: 'file:///private', title: 'Private', groupId: -1 });
  const c = new ExtensionController(api);
  assert.deepEqual(await c.dispatch(Wire.AvailableTabs, { clientId: clientA }), {
    tabs: [{ tabId: 1, title: 'Example', url: 'https://example.test/a', groupId: -1 }]
  });
  await assert.rejects(c.dispatch(Wire.AvailableTabs, {}), /invalid_request/);
});

test('auto approval attaches to a requested existing tab without taking ownership', async () => {
  const api = new FakeChrome();
  const c = new ExtensionController(api);
  const pending = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'attachExisting', tabId: 1 });
  const result = await c.approvalStatus({ clientId: clientA, pendingId: pending.pendingId });
  assert.equal(result.status, Wire.Approved);
  assert.equal(result.pages[0].url, 'https://example.test/a');
  assert.equal([...c.pages.values()][0].owned, false);
  await c.dispatch(Wire.Release, { clientId: clientA, sessionId: result.sessionId });
  assert.equal(api.tabs.data.has(1), true);
});

test('two clients cannot auto-attach to the same tab', async () => {
  const api = new FakeChrome();
  const c = new ExtensionController(api);
  const first = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'attachExisting', tabId: 1 });
  const second = await c.dispatch(Wire.SessionRequest, { clientId: clientB, mode: 'attachExisting', tabId: 1 });
  assert.equal((await c.approvalStatus({ clientId: clientA, pendingId: first.pendingId })).status, Wire.Approved);
  assert.equal((await c.approvalStatus({ clientId: clientB, pendingId: second.pendingId })).status, Wire.Denied);
  assert.equal(c.sessions.size, 1);
});

test('popup rejects webpage senders; approved attachment returns only the selected tab', async () => {
  const { api, c, pending } = await approvedExisting();
  assert.equal(c.sessions.size, 1);
  const unauthorizedPort = { postMessage() { assert.fail('webpage must not receive popup data'); } };
  await c.popup({ type: 'popup.pending' }, { url: 'https://attacker.test/' }, unauthorizedPort);
  await c.popup({ type: 'popup.revoke', sessionId: c.sessions.keys().next().value },
    { url: api.runtime.getURL('popup.html'), tab: { id: 1 } }, unauthorizedPort);
  await c.popup({ type: 'popup.pending' }, { url: 'chrome-extension://other/popup.html' }, unauthorizedPort);
  assert.equal((await c.approvalStatus({ clientId: clientA, pendingId: pending.pendingId })).status, Wire.Approved);
  const result = await c.approvalStatus({ clientId: clientA, pendingId: pending.pendingId });
  assert.equal(result.pages[0].url, 'https://example.test/a');
  assert.equal(api.tabs.data.size, 1);
});

test('the real popup can list and revoke an active session', async () => {
  const { api, c, approved } = await approvedExisting();
  const messages = [];
  const port = { postMessage: value => messages.push(value) };
  const sender = { url: api.runtime.getURL('popup.html') };
  await c.popup({ type: 'popup.sessions' }, sender, port);
  assert.equal(messages[0].items[0].sessionId, approved.sessionId);
  await c.popup({ type: 'popup.revoke', sessionId: approved.sessionId }, sender, port);
  assert.equal(c.sessions.size, 0);
  assert.equal(c.pages.size, 0);
});

test('grants are client and page scoped; release detaches but keeps a user-owned tab', async () => {
  const { api, c, approved } = await approvedExisting();
  const ids = { clientId: clientA, sessionId: approved.sessionId, pageId: approved.pages[0].pageId };
  await assert.rejects(c.dispatch(Wire.ListTabs, { ...ids, clientId: clientB }), /not_authorized/);
  const attached = await c.dispatch(Wire.Attach, ids);
  assert.equal(attached.tabId, 1);
  assert.equal(attached.targetInfo.targetId, '1');
  await c.dispatch(Wire.Release, { clientId: clientA, sessionId: approved.sessionId });
  assert.equal(api.tabs.data.size, 1);
  assert.ok(api.debugger.calls.some(call => call[0] === 'detach'));
  await assert.rejects(c.dispatch(Wire.Observe, ids), /not_authorized/);
});

test('concurrent approval creates one grant and one owned tab', async () => {
  const api = new FakeChrome();
  const c = manual(new ExtensionController(api));
  const pending = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'newGroup' });
  await Promise.all([c.approve(pending.pendingId), c.approve(pending.pendingId)]);
  assert.equal(api.tabs.data.size, 2);
  assert.equal(c.sessions.size, 1);
});

test('moving an approved tab to another group revokes its access', async () => {
  const { api, c, approved } = await approvedExisting();
  const ids = { clientId: clientA, sessionId: approved.sessionId };
  api.tabs.data.get(1).groupId = 9;
  await assert.rejects(c.dispatch(Wire.ListTabs, ids), /not_authorized/);
  assert.equal(c.pages.size, 0);
});

test('owned blank tabs can be listed, navigated, and closed but cannot be read', async () => {
  const api = new FakeChrome();
  const c = manual(new ExtensionController(api));
  const pending = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'newGroup' });
  await c.approve(pending.pendingId);
  const approved = await c.approvalStatus({ clientId: clientA, pendingId: pending.pendingId });
  const ids = { clientId: clientA, sessionId: approved.sessionId, pageId: approved.pages[0].pageId };
  assert.equal((await c.dispatch(Wire.ListTabs, { clientId: clientA, sessionId: ids.sessionId })).pages[0].url, 'about:blank');
  await assert.rejects(c.dispatch(Wire.Attach, ids), /not_authorized/);
  await c.dispatch(Wire.Navigate, { ...ids, seq: 1, url: 'https://safe.test/' });
  assert.equal(api.tabs.data.get(2).url, 'https://safe.test/');
  await c.dispatch(Wire.CloseTab, { ...ids, seq: 2 });
  assert.equal(api.tabs.data.has(2), false);
});

test('revocation removes page grants before waiting for debugger detach', async () => {
  const { api, c, approved } = await approvedExisting();
  const ids = { clientId: clientA, sessionId: approved.sessionId, pageId: approved.pages[0].pageId };
  await c.dispatch(Wire.Attach, ids);
  let finish;
  api.debugger.detach = async () => new Promise(resolve => { finish = resolve; });
  const revoking = c.dispatch(Wire.Release, { clientId: clientA, sessionId: ids.sessionId });
  await Promise.resolve();
  assert.equal(c.sessions.size, 0);
  assert.equal(c.pages.size, 0);
  finish();
  await revoking;
});

test('CDP rejects unreviewed and cross-target commands', async () => {
  const { c, approved } = await approvedExisting();
  const ids = { clientId: clientA, sessionId: approved.sessionId, pageId: approved.pages[0].pageId };
  await c.dispatch(Wire.Attach, ids);
  await assert.rejects(c.dispatch(Wire.Cdp, { ...ids, method: 'Network.getAllCookies' }), /unsupported_operation/);
  await assert.rejects(c.dispatch(Wire.Cdp, { ...ids, method: 'Runtime.evaluate', childSessionId: 'foreign' }), /unsupported_operation/);
  assert.deepEqual(await c.dispatch(Wire.Cdp, { ...ids, method: 'Target.setAutoAttach', params: { flatten: true } }), {});
});

test('new-group approval and createTab enforce safe URLs and the ten-tab limit', async () => {
  const api = new FakeChrome();
  const c = manual(new ExtensionController(api));
  const p = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'newGroup', url: 'https://safe.test/start' });
  await c.approve(p.pendingId);
  const result = await c.approvalStatus({ clientId: clientA, pendingId: p.pendingId });
  assert.equal(result.status, Wire.Approved);
  assert.equal(api.tabs.data.size, 2);
  const ids = { clientId: clientA, sessionId: result.sessionId };
  await assert.rejects(c.dispatch(Wire.CreateTab, { ...ids, seq: 0, url: 'file:///secret' }), /invalid_request/);
  for (let seq = 1; seq <= 9; seq++) await c.dispatch(Wire.CreateTab, { ...ids, seq, url: 'about:blank' });
  await assert.rejects(c.dispatch(Wire.CreateTab, { ...ids, seq: 9, url: 'about:blank' }), /group_full/);
});

test('native disconnect revokes every grant and lease expiry revokes a client', async () => {
  const { api, c, approved } = await approvedExisting();
  const ids = { clientId: clientA, sessionId: approved.sessionId, pageId: approved.pages[0].pageId };
  await c.dispatch(Wire.Attach, ids);
  await c.disconnected();
  assert.equal(c.sessions.size, 0);
  assert.equal(c.pages.size, 0);
  assert.ok(api.debugger.calls.some(call => call[0] === 'detach'));
});

test('native disconnect reconnects without restoring prior grants', async () => {
  const api = new FakeChrome();
  const c = new ExtensionController(api);
  c.start();
  const pending = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'attachExisting' });
  await c.approve(pending.pendingId, 1);
  api.native.onDisconnect.fire();
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(api.nativeConnections, 2);
  assert.equal(c.sessions.size, 0);
  assert.equal(c.pages.size, 0);
  c.stop();
});

test('heartbeats renew a client lease and expiry removes the grant', async () => {
  const api = new FakeChrome();
  let now = 1000;
  const c = new ExtensionController(api, () => now);
  const pending = await c.dispatch(Wire.SessionRequest, { clientId: clientA, mode: 'attachExisting' });
  await c.approve(pending.pendingId, 1);
  const approval = await c.approvalStatus({ clientId: clientA, pendingId: pending.pendingId });
  now += 10_000;
  await c.dispatch(Wire.Heartbeat, { clientId: clientA });
  now += 10_000;
  c.sweep();
  assert.equal(c.sessions.size, 1);
  now += 6_000;
  c.sweep();
  assert.equal(c.sessions.size, 0);
  await assert.rejects(c.dispatch(Wire.ListTabs, { clientId: clientA, sessionId: approval.sessionId }), /not_authorized/);
});
