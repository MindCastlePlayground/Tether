import { Broker, BrowserAction, CdpMethod, Failure, Limits, NativeStatus, PolicySummary, PopupMessage, SessionMode, Storage, Wire } from './protocol.js';
import { Locale, Text } from './i18n.js';

export class ExtensionController {
  constructor(api = globalThis.chrome, clock = () => Date.now(), userAgent = () => globalThis.navigator.userAgent) {
    this.api = api;
    this.clock = clock;
    this.userAgent = userAgent;
    this.port = null;
    this.pending = new Map();
    this.results = new Map();
    this.sessions = new Map();
    this.pages = new Map();
    this.attached = new Set();
    this.lease = new Map();
    this.intentionalDetach = new Set();
    this.approving = new Set();
    this.autoApprove = true;
    this.ready = null;
    this.stopped = false;
    this.timer = null;
    this.status = { state: NativeStatus.Waiting };
    this.brokerMode = Broker.Auto;
    this.brokerStatus = { mode: Broker.Auto, state: Broker.StateStarting };
    this.retryDelay = 1000;
    this.retryTimer = null;
    this.wasConnected = false;
    this.popups = new Set();
    this.notifyNew = true;
    this.notices = new Set();
    this.update = null;
    this.reloadTried = null;
    this.locale = new Locale(api);
  }

  start() {
    this.ready = this.load();
    this.api.runtime.onConnect.addListener(port => {
      if (port.name !== PopupMessage.Port) return;
      this.popups.add(port);
      port.onDisconnect.addListener(() => this.popups.delete(port));
      port.onMessage.addListener(msg => this.popup(msg, port.sender, port));
    });
    // Registering onStartup makes Chrome start this worker with the browser, including a background wake.
    this.api.runtime.onStartup?.addListener(() => this.probe());
    this.api.alarms?.onAlarm?.addListener(alarm => { if (alarm.name === Broker.Alarm) this.probe(); });
    this.api.alarms?.create?.(Broker.Alarm, { periodInMinutes: 0.5 });
    this.api.notifications?.onButtonClicked?.addListener((id, index) => this.notificationClicked(id, index));
    this.api.tabs.onRemoved.addListener(tabId => this.dropTab(tabId));
    this.api.tabs.onReplaced.addListener((added, removed) => { this.dropTab(removed); });
    this.api.tabs.onUpdated.addListener((tabId, change) => {
      if (change.url) this.checkUrl(tabId, change.url);
      if (typeof change.title === 'string') {
        const page = [...this.pages.values()].find(x => x.tabId === tabId);
        if (page && page.title !== change.title) { page.title = change.title; this.publishSessions(); }
      }
      if (Object.hasOwn(change, 'groupId')) this.checkTabGroup(tabId);
    });
    this.api.tabs.onDetached.addListener(tabId => this.dropTab(tabId));
    this.api.debugger.onEvent.addListener((source, method, params) => this.event(source, method, params, source.sessionId));
    this.api.debugger.onDetach.addListener(source => {
      if (this.intentionalDetach.has(source.tabId)) return;
      for (const p of this.pages.values()) if (p.tabId === source.tabId) this.dropTab(source.tabId);
    });
    this.connect();
    this.timer = setInterval(() => this.sweep(), 1000);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    this.disconnected();
  }

  async load() {
    await this.locale.load();
    try {
      const data = await this.api.storage.local.get(Storage.AutoApprove);
      const broker = await this.api.storage.local.get(Storage.BrokerMode);
      const notice = await this.api.storage.local.get(Storage.Notify);
      if (typeof data?.[Storage.AutoApprove] === 'boolean') this.autoApprove = data[Storage.AutoApprove];
      if ([Broker.Auto, Broker.On, Broker.Off].includes(broker?.[Storage.BrokerMode])) this.brokerMode = broker[Storage.BrokerMode];
      if (typeof notice?.[Storage.Notify] === 'boolean') this.notifyNew = notice[Storage.Notify];
    } catch { /* Keep the default when preferences are unavailable. */ }
    this.updateBadge();
  }

  async saveBrokerMode() { try { await this.api.storage.local.set({ [Storage.BrokerMode]: this.brokerMode }); } catch { /* Retain the choice in memory. */ } }

  sendBroker(action, restore = false) {
    try { this.port?.postMessage({ type: Broker.Control, action, ...(action === Broker.ModeAction ? { mode: this.brokerMode } : {}), ...(restore ? { restore: true } : {}) }); } catch { /* Port may be closing. */ }
  }

  async probe() {
    await this.ready;
    if (this.port) this.sendBroker(Broker.Probe);
  }

  async setBrokerMode(mode) {
    if (![Broker.Auto, Broker.On, Broker.Off].includes(mode)) return;
    this.brokerMode = mode;
    await this.saveBrokerMode();
    const keep = this.brokerStatus[PolicySummary.Field];
    this.brokerStatus = { mode, state: mode === Broker.Off ? Broker.StateStopped : Broker.StateStarting, ...(keep ? { [PolicySummary.Field]: keep } : {}) };
    this.sendBroker(Broker.ModeAction);
    this.publishBrokerStatus();
  }

  publishBrokerStatus() {
    for (const port of this.popups) { try { port.postMessage({ ...this.brokerStatus, type: PopupMessage.BrokerStatus }); } catch { this.popups.delete(port); } }
    this.updateBadge();
  }

  publishPending() { this.publish(PopupMessage.Pending, this.pendingItems()); this.updateBadge(); }

  publishSessions() { this.publish(PopupMessage.Sessions, this.sessionItems()); this.updateBadge(); }

  updateBadge() {
    const failed = this.status.state === NativeStatus.Error || this.brokerStatus.state === Broker.StateBlocked;
    let text = '';
    let color = BrowserAction.BadgeColor;
    if (this.pending.size) text = String(Math.min(this.pending.size, 99));
    else if (failed) { text = BrowserAction.BadgeError; color = BrowserAction.BadgeErrorColor; }
    else if (this.sessions.size) { text = BrowserAction.BadgeSession; color = BrowserAction.BadgeSessionColor; }
    try {
      this.api.action.setBadgeText({ text });
      this.api.action.setBadgeBackgroundColor({ color });
    } catch { /* Badge updates are best effort. */ }
  }

  publish(type, items) {
    for (const port of this.popups) { try { port.postMessage({ type, items }); } catch { this.popups.delete(port); } }
  }

  pendingItems() {
    return [...this.pending].map(([pendingId, x]) => ({
      pendingId, clientId: x.clientId, mode: x.mode, url: x.url, expires: x.expires
    }));
  }

  sessionItems() {
    return [...this.sessions.values()].map(s => ({
      sessionId: s.sessionId, clientId: s.clientId, mode: s.mode, started: s.started,
      pages: [...s.pages].map(id => {
        const p = this.pages.get(id);
        return p ? {
          pageId: id, url: p.url,
          ...(p.tabId !== undefined ? { tabId: p.tabId } : {}),
          ...(p.title ? { title: p.title } : {})
        } : null;
      }).filter(Boolean)
    }));
  }

  async save() {
    try { await this.api.storage.local.set({ [Storage.AutoApprove]: this.autoApprove }); } catch { /* Keep the choice in memory. */ }
  }

  connect() {
    if (this.stopped) return;
    try {
      this.port = this.api.runtime.connectNative(Wire.Host);
      void Promise.resolve(this.ready).then(() => { if (this.port) this.sendBroker(Broker.ModeAction, true); });
      let reported = false;
      this.port.onMessage.addListener(message => {
        if (message?.type === NativeStatus.Type) {
          if (message.state === NativeStatus.Connected ||
              (message.state === NativeStatus.Error && Object.hasOwn(NativeStatus.Hints, message.code))) {
            reported = message.state === NativeStatus.Error;
            if (message.state === NativeStatus.Connected) { this.wasConnected = true; this.retryDelay = 1000; }
            else if (message.state === NativeStatus.Error && this.wasConnected) { this.wasConnected = false; void this.disconnected(true); }
            this.setStatus({ state: message.state, code: message.code });
          }
          return;
        }
        if (message?.type === Broker.Status) { this.brokerStatus = message; this.publishBrokerStatus(); void this.checkBuild(message[Broker.Extension]?.[Broker.Build]); return; }
        this.receive(message);
      });
      this.port.onDisconnect.addListener(() => {
        // Chrome exposes lastError only during this callback; reading it consumes it.
        const error = this.api.runtime.lastError?.message;
        this.wasConnected = false;
        void this.disconnected();
        if (!reported) this.setStatus({ state: NativeStatus.Error, code: NativeStatus.Host, detail: error });
        this.port = null;
        if (!this.stopped) { clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.connect(), this.retryDelay); this.retryDelay = Math.min(this.retryDelay * 2, 30000); }
      });
    } catch {
      this.setStatus({ state: NativeStatus.Error, code: NativeStatus.Host });
      this.port = null; if (!this.stopped) { clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.connect(), this.retryDelay); this.retryDelay = Math.min(this.retryDelay * 2, 30000); }
    }
  }

  setStatus(status) {
    this.status = status;
    for (const port of this.popups) {
      try { port.postMessage({ type: PopupMessage.Status, ...status }); } catch { this.popups.delete(port); }
    }
    this.updateBadge();
  }

  async receive(msg) {
    try {
      if (new TextEncoder().encode(JSON.stringify(msg)).length > Limits.MaxBytes) throw new Error(Failure.Invalid);
      if (!msg || msg.jsonrpc !== Wire.Version || typeof msg.id !== 'string' ||
          typeof msg.method !== 'string' || !msg.params || typeof msg.params !== 'object') {
        throw new Error(Failure.Invalid);
      }
      const result = await this.dispatch(msg.method, msg.params);
      this.reply({ jsonrpc: Wire.Version, id: msg.id, result });
    } catch (err) {
      const message = Object.values(Failure).includes(err?.message) ? err.message : Failure.Failed;
      this.reply({ jsonrpc: Wire.Version, id: msg?.id ?? '', error: { code: -32000, message } });
    }
  }

  reply(value) {
    if (!this.port) return;
    try {
      if (new TextEncoder().encode(JSON.stringify(value)).length > Limits.MaxBytes) return;
      this.port.postMessage(value);
    } catch { /* The native port may have closed. */ }
  }

  async dispatch(method, p) {
    if (method === Wire.SessionRequest) return this.requestSession(p);
    if (method === Wire.ApprovalStatus) return this.approvalStatus(p);
    if (method === Wire.AvailableTabs) {
      this.client(p);
      await this.ready;
      if (!this.autoApprove) throw new Error(Failure.Forbidden);
      const tabs = await this.api.tabs.query({ url: ['http://*/*', 'https://*/*'] });
      return { tabs: tabs.filter(t => /^https?:\/\//i.test(t.url ?? '')).map(t => ({
        tabId: t.id, title: t.title ?? '', url: t.url ?? '', groupId: t.groupId ?? -1
      })) };
    }
    if (method === Wire.Capabilities) return { methods: [Wire.SessionRequest, Wire.ApprovalStatus, Wire.ListTabs,
      Wire.AvailableTabs, Wire.CreateTab, Wire.CloseTab, Wire.Release, Wire.Navigate] };
    if (method === Wire.Heartbeat) {
      this.client(p);
      const expires = this.clock() + Limits.LeaseMs;
      this.lease.set(p.clientId, expires);
      for (const s of this.sessions.values()) if (s.clientId === p.clientId) s.expires = expires;
      return { ok: true };
    }
    if (method === Wire.ClientLost) { this.client(p); await this.revokeClient(p.clientId); return { ok: true }; }
    const grant = this.grant(p);
    if (method === Wire.ListTabs) return this.listTabs(grant);
    if (method === Wire.Release) { await this.release(grant); return { ok: true }; }
    if (method === Wire.CreateTab) return this.createTab(grant, p);
    if (method === Wire.CloseTab) return this.closeTab(grant, p);
    if (method === Wire.Attach) return this.attach(grant, p);
    if (method === Wire.Detach) return this.detach(grant, p);
    if (method === Wire.Cdp) return this.cdp(grant, p);
    if (method === Wire.Navigate) return this.navigate(grant, p);
    throw new Error(Failure.Unsupported);
  }

  async requestSession(p) {
    this.client(p);
    await this.ready;
    if ([...this.pending.values()].some(x => x.clientId === p.clientId)) throw new Error(Failure.Busy);
    if (!['newGroup', 'attachExisting'].includes(p.mode)) throw new Error(Failure.Invalid);
    if (p.tabId !== undefined && !Number.isInteger(p.tabId)) throw new Error(Failure.Invalid);
    let url = null;
    if (p.mode === SessionMode.NewGroup) url = this.safeUrl(p.url ?? BrowserAction.NewTab, true);
    else if (typeof p.url === 'string') { try { url = this.safeUrl(p.url, false); } catch { url = null; } }
    const pendingId = this.id();
    this.pending.set(pendingId, { clientId: p.clientId, mode: p.mode, url, expires: this.clock() + Limits.PendingMs });
    this.statusSet(pendingId, p.clientId, { status: Wire.Pending });
    this.publishPending();
    await this.notify(pendingId, p);
    if (p._ask !== true && this.autoApprove && (p.mode === 'newGroup' || (p.mode === 'attachExisting' && p.tabId !== undefined))) {
      try { await this.approve(pendingId, p.tabId); }
      catch { if (this.pending.has(pendingId)) this.deny(pendingId); }
    }
    const result = this.results.get(pendingId);
    if (result?.status === Wire.Approved) return { pendingId, ...result.value, status: result.status };
    return { pendingId, status: result?.status ?? Wire.Pending };
  }

  async notify(id, p) {
    if (this.autoApprove || !this.notifyNew || !this.pending.has(id)) return;
    this.notices.add(id);
    await this.locale.load();
    if (!this.pending.has(id)) return;
    const keys = p.mode === SessionMode.NewGroup ? [Text.NotifyApprove] : [Text.NotifyOpen];
    const buttons = [...keys, Text.NotifyDeny].map(key => ({ title: this.locale.get(key) }));
    try {
      await this.api.notifications?.create?.(id, {
        type: BrowserAction.NotificationBasic,
        iconUrl: this.api.runtime.getURL(BrowserAction.NotificationIcon),
        title: this.locale.get(Text.AppName),
        message: this.locale.get(Text.NotifyBody).replace('$1', () => p.clientId),
        buttons
      });
      if (!this.pending.has(id)) this.clearNotice(id);
    } catch { /* Notifications may be unavailable. */ }
  }

  clearNotice(id) {
    this.notices.delete(id);
    try { Promise.resolve(this.api.notifications?.clear?.(id)).catch(() => {}); } catch { /* Ignore. */ }
  }

  notificationClicked(id, index) {
    const p = this.pending.get(id);
    if (!p) { this.clearNotice(id); return; }
    if (index > 0) { this.deny(id); return; }
    if (p.mode === SessionMode.NewGroup) { void this.approve(id).catch(() => {}); return; }
    void this.openPopup();
  }

  async openPopup() {
    try { await this.api.action.openPopup?.(); } catch { /* Popups cannot always be opened programmatically. */ }
  }

  async approvalStatus(p) {
    this.client(p);
    const r = this.results.get(p.pendingId);
    if (!r || r.clientId !== p.clientId) return { status: Wire.Expired };
    if (r.status === Wire.Approved) return { ...r.value, status: Wire.Approved };
    return { status: r.status };
  }

  async popup(msg, sender, port) {
    if (!sender || sender.url !== this.api.runtime.getURL('popup.html') || sender.tab) return;
    try {
      if (msg?.type === PopupMessage.Status) {
        port.postMessage({ type: PopupMessage.Status, ...this.status });
      } else if (msg?.type === PopupMessage.BrokerStatus) {
        await this.ready;
        this.brokerStatus.mode = this.brokerMode;
        port.postMessage({ ...this.brokerStatus, type: PopupMessage.BrokerStatus });
      } else if (msg?.type === PopupMessage.SetBrokerMode) {
        await this.setBrokerMode(msg.mode);
        port.postMessage({ ...this.brokerStatus, type: PopupMessage.BrokerStatus });
      } else if (msg?.type === PopupMessage.Pending) {
        port.postMessage({ type: msg.type, items: this.pendingItems() });
      } else if (msg?.type === PopupMessage.AutoApproval) {
        await this.ready;
        port.postMessage({ type: msg.type, enabled: this.autoApprove });
      } else if (msg?.type === PopupMessage.SetAutoApproval) {
        this.autoApprove = msg.enabled === true;
        await this.save();
        port.postMessage({ type: PopupMessage.AutoApproval, enabled: this.autoApprove });
        this.publishPending();
        this.publishSessions();
      } else if (msg?.type === PopupMessage.Notify) {
        await this.ready;
        port.postMessage({ type: msg.type, enabled: this.notifyNew });
      } else if (msg?.type === PopupMessage.SetNotify) {
        this.notifyNew = msg.enabled === true;
        try { await this.api.storage.local.set({ [Storage.Notify]: this.notifyNew }); } catch { /* Retain the choice in memory. */ }
        port.postMessage({ type: PopupMessage.Notify, enabled: this.notifyNew });
      } else if (msg?.type === PopupMessage.Tabs) {
        const tabs = await this.api.tabs.query({ url: ['http://*/*', 'https://*/*'] });
        port.postMessage({ type: msg.type, pendingId: msg.pendingId, tabs: tabs.map(t => ({
          tabId: t.id, title: t.title ?? '', url: t.url ?? '', groupId: t.groupId ?? -1, active: t.active === true
        })) });
      } else if (msg?.type === PopupMessage.Sessions) {
        port.postMessage({ type: msg.type, items: this.sessionItems() });
      } else if (msg?.type === PopupMessage.Revoke) {
        if (!this.sessions.has(msg.sessionId)) throw new Error(Failure.Missing);
        await this.revoke(msg.sessionId);
      } else if (msg?.type === PopupMessage.RevokeAll) {
        await Promise.all([...this.sessions.keys()].map(id => this.revoke(id)));
      } else if (msg?.type === PopupMessage.Focus) {
        if (!Number.isInteger(msg.tabId) || ![...this.pages.values()].some(p => p.tabId === msg.tabId)) throw new Error(Failure.Invalid);
        const tab = await this.api.tabs.update(msg.tabId, { active: true });
        if (tab?.windowId !== undefined && this.api.windows?.update) await this.api.windows.update(tab.windowId, { focused: true });
      } else if (msg?.type === PopupMessage.Approve) {
        await this.approve(msg.pendingId, msg.tabId);
      } else if (msg?.type === PopupMessage.Deny) {
        this.deny(msg.pendingId);
      }
    } catch (err) {
      port.postMessage({ type: PopupMessage.Error, message: Object.values(Failure).includes(err?.message) ? err.message : Failure.Failed });
    }
  }

  async approve(id, tabId) {
    if (this.approving.has(id)) return;
    const p = this.pending.get(id);
    if (!p || p.expires <= this.clock()) {
      this.pending.delete(id);
      this.statusSet(id, p?.clientId, { status: Wire.Expired });
      this.clearNotice(id);
      this.publishPending();
      throw new Error(Failure.Forbidden);
    }
    this.approving.add(id);
    let tab;
    let groupId = null;
    let owned = false;
    let createdSessionId = null;
    try {
      if (p.mode === 'newGroup') {
        tab = await this.api.tabs.create({ url: BrowserAction.NewTab, active: false });
        owned = true;
        this.validPending(id,p);
        const groups = await this.api.tabs.group({ tabIds: [tab.id] });
        groupId = groups;
        await this.api.tabGroups.update(groupId, { title: `${Limits.GroupPrefix}${this.id().slice(0, 6)}` });
        tab = await this.api.tabs.get(tab.id);
        this.validPending(id,p);
        if(tab.url !== BrowserAction.NewTab || tab.groupId !== groupId) throw new Error(Failure.Forbidden);
      } else {
        if (!Number.isInteger(tabId)) throw new Error(Failure.Failed);
        try { tab = await this.api.tabs.get(tabId); }
        catch { throw new Error(Failure.Invalid); }
        this.safeUrl(tab.url, false);
        groupId = tab.groupId ?? -1;
      }
      this.validPending(id,p);
      if([...this.pages.values()].some(x=>x.tabId===tab.id))throw new Error(Failure.Busy);
      const sessionId = this.id();
      createdSessionId = sessionId;
      const pageId = this.id();
      const now = this.clock();
      const session = { clientId: p.clientId, sessionId, mode: p.mode, groupId,
        managedGroupId: p.mode === 'newGroup' ? groupId : null,
        pages: new Set(), owned: new Set(), seq: 0, started: now, expires: now + Limits.LeaseMs };
      const page = { clientId: p.clientId, sessionId, pageId, tabId: tab.id, groupId,
        owned, url: tab.url, title: tab.title ?? '', seq: -1, attached: false };
      this.sessions.set(sessionId, session);
      this.pages.set(pageId, page);
      session.pages.add(pageId);
      if (owned) session.owned.add(pageId);
      if (p.mode === 'newGroup' && p.url !== BrowserAction.NewTab) {
        const grant = this.grant({ clientId: p.clientId, sessionId, pageId });
        await this.navigate(grant, { url: p.url, _approval: true });
      }
      this.validPending(id, p);
      this.grant({ clientId: p.clientId, sessionId, pageId });
      const finalTab = await this.api.tabs.get(tab.id);
      this.grant({ clientId: p.clientId, sessionId, pageId });
      this.validPending(id, p);
      this.checkGroup(page, finalTab);
      this.safeUrl(finalTab.url, page.owned);
      page.url = finalTab.url;
      page.title = finalTab.title ?? '';
      this.results.set(id, { clientId: p.clientId, status: Wire.Approved,
        value: { sessionId, pages: [{ pageId, url: finalTab.url }], groupId } });
      this.pending.delete(id);
      this.clearNotice(id);
      this.publishPending();
      this.publishSessions();
    } catch (err) {
      if (owned && tab?.id != null) {
        try { const current=await this.api.tabs.get(tab.id);if(current.url===BrowserAction.NewTab&&current.groupId===groupId)await this.api.tabs.remove(tab.id); } catch { /* best effort rollback */ }
      }
      if (createdSessionId) await this.revoke(createdSessionId);
      if (err?.message === Failure.Busy) { this.deny(id); return; }
      throw err?.message === Failure.Forbidden ? new Error(Failure.Failed) : err;
    } finally { this.approving.delete(id); }
  }

  deny(id) {
    const p = this.pending.get(id);
    this.pending.delete(id);
    if (p) {
      this.statusSet(id, p.clientId, { status: Wire.Denied });
      this.clearNotice(id);
      this.publishPending();
    }
  }

  statusSet(id, clientId, value) {
    if (!clientId) return;
    this.results.set(id, { clientId, ...value });
    while (this.results.size > 128) this.results.delete(this.results.keys().next().value);
  }

  client(p) {
    if (typeof p?.clientId !== 'string' || p.clientId.length < 1 || p.clientId.length > 128)
      throw new Error(Failure.Invalid);
  }

  grant(p) {
    this.client(p);
    const s = this.sessions.get(p.sessionId);
    const page = this.pages.get(p.pageId);
    if (!s || s.clientId !== p.clientId || s.expires <= this.clock() ||
        (p.pageId && (!page || page.clientId !== p.clientId || page.sessionId !== p.sessionId)))
      throw new Error(Failure.Forbidden);
    return { session: s, page };
  }

  async listTabs({ session }) {
    const tabs = [];
    for (const id of session.pages) {
      const p = this.pages.get(id);
      if (!p) continue;
      await this.checkPage(p, true);
      const t = await this.api.tabs.get(p.tabId);
      this.grant({ clientId: session.clientId, sessionId: session.sessionId, pageId: id });
      this.checkGroup(p, t);
      if (t.url === BrowserAction.NewTab && !p.owned) throw new Error(Failure.Forbidden);
      tabs.push({ pageId: id, url: t.url ?? '', title: t.title ?? '' });
    }
    return { pages: tabs };
  }

  async createTab({ session }, p) {
    if (session.pages.size >= Limits.GroupTabs) throw new Error(Failure.GroupFull);
    const url = this.safeUrl(p.url ?? BrowserAction.NewTab, true);
    this.seq(session, p.seq);
    const tab = await this.api.tabs.create({ url: BrowserAction.NewTab, active: false });
    try {
      this.grant({clientId:session.clientId,sessionId:session.sessionId});
      let groupId = session.managedGroupId;
      if (groupId == null || groupId < 0) {
        groupId = await this.api.tabs.group({ tabIds: [tab.id] });
        await this.api.tabGroups.update(groupId, { title: `${Limits.GroupPrefix}${this.id().slice(0, 6)}` });
        session.managedGroupId = groupId;
      } else await this.api.tabs.group({ tabIds: [tab.id], groupId });
      this.grant({clientId:session.clientId,sessionId:session.sessionId});
      const current=await this.api.tabs.get(tab.id);
      if(current.url!==BrowserAction.NewTab||current.groupId!==groupId)throw new Error(Failure.Forbidden);
      const pageId = this.id();
      const page = { clientId: session.clientId, sessionId: session.sessionId, pageId,
        tabId: tab.id, groupId, owned: true, url: BrowserAction.NewTab, title: current.title ?? '', seq: -1, attached: false };
      this.pages.set(pageId, page); session.pages.add(pageId); session.owned.add(pageId);
      if (url !== BrowserAction.NewTab) await this.navigate({ session, page }, { url, _approval: true });
      this.grant({ clientId: session.clientId, sessionId: session.sessionId, pageId });
      this.publishSessions();
      return { pageId, url };
    } catch (err) { try { const current=await this.api.tabs.get(tab.id);if(current.url===BrowserAction.NewTab)await this.api.tabs.remove(tab.id); } catch { /* rollback */ } throw err; }
  }

  async closeTab({ session, page }, p) {
    this.seq(session, p.seq);
    if (!page || !page.owned || !session.owned.has(page.pageId)) throw new Error(Failure.Forbidden);
    await this.checkPage(page, true);
    this.grant({ clientId: session.clientId, sessionId: session.sessionId, pageId: page.pageId });
    await this.api.tabs.remove(page.tabId);
    this.dropPage(page.pageId);
    return { sideEffect: 'applied' };
  }

  async release({ session }) { await this.revoke(session.sessionId); }

  async revoke(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    const pages = [...s.pages].map(id => this.pages.get(id)).filter(Boolean);
    for (const p of pages) this.dropPage(p.pageId, false);
    this.publishSessions();
    await Promise.all(pages.filter(p => p.attached).map(p => this.detachPage(p)));
  }

  async revokePage(pageId) {
    const page = this.pages.get(pageId);
    if (!page) return;
    this.dropPage(pageId);
    if (page.attached) await this.detachPage(page);
  }

  async revokeClient(clientId) {
    let dropped = false;
    for (const [id, p] of this.pending) if (p.clientId === clientId) { this.pending.delete(id); this.clearNotice(id); dropped = true; }
    if (dropped) this.publishPending();
    for (const [id, s] of [...this.sessions]) if (s.clientId === clientId) await this.revoke(id);
    this.lease.delete(clientId);
  }

  seq(session, seq) {
    if (!Number.isSafeInteger(seq) || seq <= session.seq) throw new Error(Failure.Invalid);
    session.seq = seq;
  }

  async attach({ session, page }) {
    await this.checkPage(page);
    if (page.attached) throw new Error(Failure.Busy);
    await this.api.debugger.attach({ tabId: page.tabId }, BrowserAction.DebuggerVersion);
    this.attached.add(page.tabId); page.attached = true;
    try {
      await this.checkPage(page);
      const {targetInfo}=await this.api.debugger.sendCommand({tabId:page.tabId},'Target.getTargetInfo');
      const version=this.version();
      return {tabId:page.tabId,targetInfo,version};
    } catch (err) { await this.detachPage(page); throw err; }
  }

  async detach({ page }) { await this.detachPage(page); return { ok: true }; }

  async detachPage(page) {
    if (!page.attached) return;
    page.attached = false;
    this.attached.delete(page.tabId);
    this.intentionalDetach.add(page.tabId);
    try { await this.api.debugger.detach({ tabId: page.tabId }); } catch { /* already detached */ }
    finally { setTimeout(() => this.intentionalDetach.delete(page.tabId), 0); }
  }

  async cdp({ page }, p) {
    await this.checkPage(page);
    if (!page.attached) throw new Error(Failure.Forbidden);
    if (p.childSessionId) throw new Error(Failure.Unsupported);
    if (p.method === 'Target.getTargetInfo') {
      const targetInfo = (await this.api.debugger.getTargets()).find(t => t.tabId === page.tabId);
      if (!targetInfo) throw new Error(Failure.Missing);
      return { targetInfo: this.targetInfo(targetInfo) };
    }
    if (p.method === 'Browser.getVersion') {
      return this.version();
    }
    if (!CdpMethod.Allowed.has(p.method) || CdpMethod.Internal.has(p.method)) throw new Error(Failure.Unsupported);
    if (p.method === CdpMethod.NoChildTargets && p.params?.flatten === false) throw new Error(Failure.Unsupported);
    if (p.method === CdpMethod.NoChildTargets) return {};
    if (p.method === 'Page.navigate') this.safeUrl(p.params?.url, page.owned);
    return this.api.debugger.sendCommand({ tabId: page.tabId }, p.method, p.params ?? {});
  }

  async navigate({ page, session }, p) {
    if (!p._approval) this.seq(session, p.seq);
    await this.checkPage(page, true);
    const url = this.safeUrl(p.url, page.owned && page.url === BrowserAction.NewTab);
    const tab = await this.api.tabs.get(page.tabId);
    this.grant({clientId:session.clientId,sessionId:session.sessionId,pageId:page.pageId});
    this.checkGroup(page, tab);
    this.safeUrl(tab.url, page.owned);
    await this.api.tabs.update(page.tabId, { url });
    this.grant({clientId:session.clientId,sessionId:session.sessionId,pageId:page.pageId});
    const current = await this.api.tabs.get(page.tabId);
    this.grant({clientId:session.clientId,sessionId:session.sessionId,pageId:page.pageId});
    this.checkGroup(page, current);
    this.safeUrl(current.url, page.owned);
    page.url = current.url;
    page.title = current.title ?? '';
    return { sideEffect: 'applied', url: current.url };
  }

  targetInfo(target) {
    return { targetId: target.id ?? String(target.tabId), type: target.type ?? 'page',
      title: target.title ?? '', url: target.url ?? '', attached: Boolean(target.attached) };
  }

  version() {
    const userAgent = this.userAgent();
    const product = userAgent.match(/(?:Headless)?Chrome\/[\d.]+/)?.[0];
    if (!product) throw new Error(Failure.Unsupported);
    return { product, userAgent, protocolVersion: BrowserAction.DebuggerVersion, revision: '', jsVersion: '', source: 'extension-user-agent' };
  }

  safeUrl(value, blank) {
    if (blank && value === BrowserAction.NewTab) return value;
    if (typeof value !== 'string') throw new Error(Failure.Invalid);
    let u;
    try { u = new URL(value); } catch { throw new Error(Failure.Invalid); }
    if (![BrowserAction.Http, BrowserAction.Https].includes(u.protocol) || u.username || u.password) throw new Error(Failure.Invalid);
    return u.href;
  }

  checkUrl(tabId, url) {
    const page = [...this.pages.values()].find(x => x.tabId === tabId);
    if (!page || page.url === url) return;
    try { this.safeUrl(url, page.owned); page.url = url; this.publishSessions(); }
    catch { this.dropTab(tabId); }
  }

  async checkTabGroup(tabId) {
    const p = [...this.pages.values()].find(x => x.tabId === tabId);
    if (!p) return;
    try { const t = await this.api.tabs.get(tabId); this.checkGroup(p, t); }
    catch { this.dropPage(p.pageId); }
  }

  event(source, method, params, childSessionId) {
    const p = [...this.pages.values()].find(x => x.tabId === source.tabId && x.attached);
    if (!p) return;
    try{this.grant({clientId:p.clientId,sessionId:p.sessionId,pageId:p.pageId});}catch{return;}
    const event = { method: Wire.Event, params: { clientId: p.clientId, sessionId: p.sessionId,
      pageId: p.pageId, method, params: params ?? {}, ...(childSessionId ? { childSessionId } : {}) } };
    if (new TextEncoder().encode(JSON.stringify(event)).length <= Limits.MaxBytes) this.reply(event);
  }

  dropTab(tabId) {
    for (const p of [...this.pages.values()]) if (p.tabId === tabId) void this.revokePage(p.pageId);
  }

  dropPage(id, broadcast = true) {
    const p = this.pages.get(id);
    if (!p) return;
    this.pages.delete(id);
    const s = this.sessions.get(p.sessionId);
    if (s) {
      s.pages.delete(id); s.owned.delete(id);
      if (![...s.pages].some(pageId => this.pages.get(pageId)?.groupId === s.managedGroupId)) s.managedGroupId = null;
    }
    if (broadcast) this.publishSessions();
  }

  // An upgrade rewrites the extension on disk; reload once per build so the new code runs.
  async checkBuild(build) {
    if (typeof build !== 'string' || !build) return;
    const manifest = this.api.runtime.getManifest?.();
    const own = manifest?.version_name ?? manifest?.version;
    this.update = own && build !== own ? build : null;
    await this.reloadIfIdle();
  }

  async reloadIfIdle() {
    const build = this.update;
    if (!build || build === this.reloadTried || this.sessions.size || this.pending.size || !this.api.runtime.reload) return;
    this.reloadTried = build;
    try {
      const seen = await this.api.storage.local.get(Storage.Reloaded);
      if (seen?.[Storage.Reloaded] === build) return;
      await this.api.storage.local.set({ [Storage.Reloaded]: build });
    } catch { return; }
    this.api.runtime.reload();
  }

  sweep() {
    if (this.update) void this.reloadIfIdle();
    const now = this.clock();
    let expired = false;
    for (const [id, p] of this.pending) if (p.expires <= now) {
      this.pending.delete(id); this.statusSet(id, p.clientId, { status: Wire.Expired }); this.clearNotice(id); expired = true;
    }
    if (expired) this.publishPending();
    for (const [id, s] of [...this.sessions]) if (s.expires <= now) this.revoke(id);
    for (const [id, at] of this.lease) if (at <= now) this.revokeClient(id);
  }

  async disconnected(keepPort = false) {
    if (!keepPort) this.port = null;
    this.approving.clear();
    await Promise.all([...this.sessions.keys()].map(id => this.revoke(id)));
    this.pending.clear(); this.lease.clear(); this.results.clear();
    for (const id of [...this.notices]) this.clearNotice(id);
    this.publishPending();
    this.publishSessions();
  }

  validPending(id,p){if(this.pending.get(id)!==p||p.expires<=this.clock())throw new Error(Failure.Forbidden);}

  async checkPage(page, allowBlank = false){
    if(!page)throw new Error(Failure.Forbidden);
    const key={clientId:page.clientId,sessionId:page.sessionId,pageId:page.pageId};
    this.grant(key);const tab=await this.api.tabs.get(page.tabId);this.grant(key);
    this.checkGroup(page, tab);
    if(tab.url===BrowserAction.NewTab&&!(allowBlank&&page.owned))throw new Error(Failure.Forbidden);
    this.safeUrl(tab.url, allowBlank && page.owned);
  }

  checkGroup(page, tab) {
    if ((tab.groupId ?? -1) !== page.groupId) {
      void this.revokePage(page.pageId);
      throw new Error(Failure.Forbidden);
    }
  }

  id() { return crypto.randomUUID(); }
}
