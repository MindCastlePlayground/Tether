import { Broker, NativeStatus, PopupMessage } from './protocol.js';
import { Locale, Text } from './i18n.js';

class Popup {
  constructor(api = chrome, doc = document) {
    this.api = api;
    this.doc = doc;
    this.root = doc.getElementById('items');
    this.pending = [];
    this.sessions = [];
    this.autoApproval = true;
    this.brokerMode = Broker.Auto;
    this.brokerStatus = { state: Broker.StateStarting };
    this.locale = new Locale(api);
    this.view = null;
    this.status = { state: NativeStatus.Waiting };
    this.port = api.runtime.connect({ name: PopupMessage.Port });
    this.port.onMessage.addListener(msg => this.receive(msg));
  }

  async init() {
    await this.locale.load();
    this.localize();
    this.doc.getElementById('language').addEventListener('change', async event => {
      await this.locale.set(event.target.value);
      this.localize();
      if (this.view?.error) this.renderError();
      else if (this.view) this.renderTabs(this.view.id, this.view.tabs);
      else this.render();
    });
    this.start();
  }

  localize() {
    this.doc.documentElement.lang = this.locale.language;
    this.doc.title = this.locale.get(Text.Title);
    for (const node of this.doc.querySelectorAll('[data-i18n]')) node.textContent = this.locale.get(node.dataset.i18n);
    this.doc.getElementById('language').value = this.locale.choice;
  }

  start() {
    this.port.postMessage({ type: PopupMessage.Status });
    this.port.postMessage({ type: PopupMessage.Pending });
    this.port.postMessage({ type: PopupMessage.Sessions });
    this.port.postMessage({ type: PopupMessage.AutoApproval });
    this.port.postMessage({ type: PopupMessage.BrokerStatus });
  }

  receive(msg) {
    if (msg.type === PopupMessage.Status) { this.status = msg; this.render(); }
    if (msg.type === PopupMessage.Pending) { this.pending = msg.items ?? []; this.render(); }
    if (msg.type === PopupMessage.Sessions) { this.sessions = msg.items ?? []; this.render(); }
    if (msg.type === PopupMessage.AutoApproval) { this.autoApproval = msg.enabled === true; this.render(); }
    if (msg.type === PopupMessage.BrokerStatus) { this.brokerStatus = msg; this.brokerMode = msg.mode ?? this.brokerMode; this.render(); }
    if (msg.type === PopupMessage.Tabs) this.renderTabs(msg.pendingId, msg.tabs ?? []);
    if (msg.type === PopupMessage.Error) this.renderError();
  }

  render() {
    this.view = null;
    this.clear();
    const connection = this.el('section'); connection.className = 'card';
    const title = this.brokerStatus.mode === Broker.Off ? Text.BrokerStopped : this.brokerStatus.state === Broker.StateBlocked ? Text.BrokerBlocked : this.status.state === NativeStatus.Connected ? Text.NativeConnected : Text.NativeWaiting;
    connection.append(this.el('strong', this.locale.get(title)));
    if (this.status.state === NativeStatus.Error) {
      connection.append(this.el('div', this.status.code));
      connection.append(this.el('div', this.locale.get(NativeStatus.Hints[this.status.code] ?? Text.NativeHost), 'hint'));
      if (this.status.detail) connection.append(this.el('div', this.status.detail, 'hint'));
    }
    this.root.append(connection);
    const broker = this.el('section'); broker.className = 'card';
    broker.append(this.el('strong', this.locale.get(Text.Broker)));
    const stateText = this.brokerStatus.state === Broker.StateRunning ? Text.BrokerRunning :
      this.brokerStatus.state === Broker.StateStopped ? Text.BrokerStopped :
      this.brokerStatus.state === Broker.StateBackoff ? Text.BrokerBackoff :
      this.brokerStatus.state === Broker.StateBlocked ? Text.BrokerBlocked : Text.BrokerStarting;
    broker.append(this.el('div', this.locale.get(stateText)));
    if (this.brokerStatus.state === Broker.StateBackoff || this.brokerStatus.state === Broker.StateBlocked) {
      const detail = this.brokerStatus.code === Broker.PortInUse ? Text.BrokerPortBusy : Text.BrokerStartFailed;
      broker.append(this.el('div', this.locale.get(detail), 'hint'));
    }
    const controls = this.el('div');
    controls.append(this.button(this.locale.get(Text.BrokerOn), 'approve', () => this.port.postMessage({ type: PopupMessage.SetBrokerMode, mode: Broker.On })));
    controls.append(this.button(this.locale.get(Text.BrokerOff), 'deny', () => this.port.postMessage({ type: PopupMessage.SetBrokerMode, mode: Broker.Off })));
    broker.append(controls);
    const guard = this.el('label'); const auto = this.doc.createElement('input'); auto.type = 'checkbox'; auto.checked = this.brokerMode === Broker.Auto;
    auto.addEventListener('change', () => this.port.postMessage({ type: PopupMessage.SetBrokerMode, mode: auto.checked ? Broker.Auto : Broker.On }));
    guard.append(auto, this.doc.createTextNode(this.locale.get(Text.BrokerAuto))); broker.append(guard);
    this.root.append(broker);
    const settings = this.el('section'); settings.className = 'card';
    const label = this.el('label');
    const toggle = this.doc.createElement('input'); toggle.type = 'checkbox'; toggle.checked = this.autoApproval;
    toggle.addEventListener('change', () => this.port.postMessage({ type: PopupMessage.SetAutoApproval, enabled: toggle.checked }));
    label.append(toggle, this.doc.createTextNode(this.locale.get(Text.AutoApproval)));
    settings.append(label, this.el('div', this.autoApproval ? this.locale.get(Text.AutoOn) : this.locale.get(Text.AutoOff), 'hint'));
    settings.append(this.el('div', this.locale.get(Text.AutoHint), 'hint'));
    this.root.append(settings);
    this.root.append(this.el('h2', this.locale.get(Text.Pending)));
    if (!this.pending.length) this.root.append(this.el('div', this.locale.get(Text.NoPending), 'empty'));
    for (const item of this.pending) {
      const card = this.el('section'); card.className = 'card';
      card.append(this.el('strong', item.clientId));
      card.append(this.el('div', item.mode === 'newGroup' ? this.locale.get(Text.NewGroup) : this.locale.get(Text.Attach)));
      if (item.url && item.url !== 'about:blank') {
        let origin = item.url;
        try { origin = new URL(item.url).origin; } catch { /* Display raw requested URL safely as text. */ }
        card.append(this.el('div', origin, 'url'));
      }
      card.append(this.el('div', this.locale.get(Text.AccessHint), 'hint'));
      const deny = this.button(this.locale.get(Text.Deny), 'deny', () => this.port.postMessage({ type: PopupMessage.Deny, pendingId: item.pendingId }));
      const allow = this.button(item.mode === 'newGroup' ? this.locale.get(Text.Approve) : this.locale.get(Text.Choose), 'approve', () => {
        if (item.mode === 'newGroup') this.approve(item.pendingId);
        else this.port.postMessage({ type: PopupMessage.Tabs, pendingId: item.pendingId });
      });
      card.append(allow, deny); this.root.append(card);
    }
    this.root.append(this.el('h2', this.locale.get(Text.Sessions)));
    if (!this.sessions.length) this.root.append(this.el('div', this.locale.get(Text.NoSessions), 'empty'));
    for (const session of this.sessions) {
      const card = this.el('section'); card.className = 'card';
      card.append(this.el('strong', session.clientId));
      for (const page of session.pages ?? []) {
        let origin = page.url;
        try { origin = new URL(page.url).origin; } catch { /* Show blank and browser-owned URLs as text. */ }
        card.append(this.el('div', origin || 'about:blank', 'url'));
      }
      card.append(this.button(this.locale.get(Text.Revoke), 'deny', () => this.port.postMessage({ type: PopupMessage.Revoke, sessionId: session.sessionId })));
      this.root.append(card);
    }
  }

  renderTabs(id, tabs) {
    this.view = { id, tabs };
    this.clear();
    this.root.append(this.el('div', this.locale.get(Text.ChooseHint)));
    if (!tabs.length) this.root.append(this.el('div', this.locale.get(Text.NoTabs), 'empty'));
    for (const tab of tabs) {
      const button = this.el('button'); button.className = 'tab';
      button.append(this.el('strong', tab.title || tab.url), this.el('span', tab.url));
      button.addEventListener('click', () => this.approve(id, tab.tabId));
      this.root.append(button);
    }
    const cancel = this.button(this.locale.get(Text.Back), 'deny', () => this.start()); this.root.append(cancel);
  }

  approve(pendingId, tabId) { this.port.postMessage({ type: PopupMessage.Approve, pendingId, tabId }); }
  button(label, cls, fn) { const b = this.el('button', label); b.className = cls; b.addEventListener('click', fn); return b; }
  el(tag, text = '', cls = '') { const e = this.doc.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; }
  clear() { this.root.replaceChildren(); }
  renderError() { this.view = { error: true }; this.clear(); this.root.append(this.el('div', this.locale.get(Text.Error))); }
}

new Popup().init();
