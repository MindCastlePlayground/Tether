import { PopupMessage } from './protocol.js';

class Popup {
  constructor(api = chrome, doc = document) {
    this.api = api;
    this.doc = doc;
    this.root = doc.getElementById('items');
    this.pending = [];
    this.sessions = [];
    this.autoApproval = true;
    this.port = api.runtime.connect({ name: PopupMessage.Port });
    this.port.onMessage.addListener(msg => this.receive(msg));
  }

  start() {
    this.port.postMessage({ type: PopupMessage.Pending });
    this.port.postMessage({ type: PopupMessage.Sessions });
    this.port.postMessage({ type: PopupMessage.AutoApproval });
  }

  receive(msg) {
    if (msg.type === PopupMessage.Pending) { this.pending = msg.items ?? []; this.render(); }
    if (msg.type === PopupMessage.Sessions) { this.sessions = msg.items ?? []; this.render(); }
    if (msg.type === PopupMessage.AutoApproval) { this.autoApproval = msg.enabled === true; this.render(); }
    if (msg.type === PopupMessage.Tabs) this.renderTabs(msg.pendingId, msg.tabs ?? []);
    if (msg.type === PopupMessage.Error) this.renderError();
  }

  render() {
    this.clear();
    const settings = this.el('section'); settings.className = 'card';
    const label = this.el('label');
    const toggle = this.doc.createElement('input'); toggle.type = 'checkbox'; toggle.checked = this.autoApproval;
    toggle.addEventListener('change', () => this.port.postMessage({ type: PopupMessage.SetAutoApproval, enabled: toggle.checked }));
    label.append(toggle, this.doc.createTextNode(' Automatically approve new groups and existing tabs'));
    settings.append(label, this.el('div', this.autoApproval ? 'On: new groups and specified existing HTTP(S) tabs are approved automatically.' : 'Off: requests wait for your approval, and clients cannot enumerate tabs.', 'hint'));
    settings.append(this.el('div', 'Turn this off to stop future automatic grants; revoke active sessions below. Reloading restores the default: on.', 'hint'));
    this.root.append(settings);
    this.root.append(this.el('h2', 'Pending access'));
    if (!this.pending.length) this.root.append(this.el('div', 'No pending access requests.', 'empty'));
    for (const item of this.pending) {
      const card = this.el('section'); card.className = 'card';
      card.append(this.el('strong', item.clientId));
      card.append(this.el('div', item.mode === 'newGroup' ? 'Create a new tab group' : 'Attach to a tab you choose'));
      if (item.url && item.url !== 'about:blank') {
        let origin = item.url;
        try { origin = new URL(item.url).origin; } catch { /* Display raw requested URL safely as text. */ }
        card.append(this.el('div', origin, 'url'));
      }
      card.append(this.el('div', 'This client can read and control the approved page and create up to 10 task pages in a new group. HTTP(S) navigation and website actions are allowed. Revoke access below at any time.', 'hint'));
      const deny = this.button('Deny', 'deny', () => this.port.postMessage({ type: PopupMessage.Deny, pendingId: item.pendingId }));
      const allow = this.button(item.mode === 'newGroup' ? 'Approve' : 'Choose tab', 'approve', () => {
        if (item.mode === 'newGroup') this.approve(item.pendingId);
        else this.port.postMessage({ type: PopupMessage.Tabs, pendingId: item.pendingId });
      });
      card.append(allow, deny); this.root.append(card);
    }
    this.root.append(this.el('h2', 'Active sessions'));
    if (!this.sessions.length) this.root.append(this.el('div', 'No active sessions.', 'empty'));
    for (const session of this.sessions) {
      const card = this.el('section'); card.className = 'card';
      card.append(this.el('strong', session.clientId));
      for (const page of session.pages ?? []) {
        let origin = page.url;
        try { origin = new URL(page.url).origin; } catch { /* Show blank and browser-owned URLs as text. */ }
        card.append(this.el('div', origin || 'about:blank', 'url'));
      }
      card.append(this.button('Revoke access', 'deny', () => this.port.postMessage({ type: PopupMessage.Revoke, sessionId: session.sessionId })));
      this.root.append(card);
    }
  }

  renderTabs(id, tabs) {
    this.clear();
    this.root.append(this.el('div', 'Choose one existing HTTP or HTTPS tab.'));
    for (const tab of tabs) {
      const button = this.el('button'); button.className = 'tab';
      button.append(this.el('strong', tab.title || tab.url), this.el('span', tab.url));
      button.addEventListener('click', () => this.approve(id, tab.tabId));
      this.root.append(button);
    }
    const cancel = this.button('Back', 'deny', () => this.start()); this.root.append(cancel);
  }

  approve(pendingId, tabId) { this.port.postMessage({ type: PopupMessage.Approve, pendingId, tabId }); }
  button(label, cls, fn) { const b = this.el('button', label); b.className = cls; b.addEventListener('click', fn); return b; }
  el(tag, text = '', cls = '') { const e = this.doc.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; }
  clear() { this.root.replaceChildren(); }
  renderError() { this.clear(); this.root.append(this.el('div', 'Request could not be completed.')); }
}

new Popup().start();
