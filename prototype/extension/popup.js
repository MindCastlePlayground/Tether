import { Broker, Failure, NativeStatus, PopupMessage } from './protocol.js';
import { ErrorText, Locale, Text } from './i18n.js';

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
    this.error = Failure.Failed;
    this.status = { state: NativeStatus.Waiting };
    this.countdowns = new Map();
    this.fading = new Map();
    this.timeouts = new Map();
    this.port = api.runtime.connect({ name: PopupMessage.Port });
    this.port.onMessage.addListener(msg => this.receive(msg));
    this.port.onDisconnect?.addListener(() => this.close());
    this.timer = setInterval(() => this.tick(), 1000);
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
    for (const node of this.doc.querySelectorAll('[data-i18n]')) {
      node.textContent = this.locale.get(node.dataset.i18n);
    }
    this.doc.getElementById('language').value = this.locale.choice;
  }

  start() {
    this.view = null;
    this.reset();
    this.port.postMessage({ type: PopupMessage.Status });
    this.port.postMessage({ type: PopupMessage.Pending });
    this.port.postMessage({ type: PopupMessage.Sessions });
    this.port.postMessage({ type: PopupMessage.AutoApproval });
    this.port.postMessage({ type: PopupMessage.BrokerStatus });
  }

  receive(msg) {
    if (msg.type === PopupMessage.Status) { this.status = msg; if (this.view === null) this.render(); }
    if (msg.type === PopupMessage.Pending) {
      const now = Date.now();
      const items = msg.items ?? [];
      const incoming = new Set(items.map(item => item.pendingId));
      for (const item of items) {
        if (!Number.isFinite(item.expires) || item.expires > now) {
          this.fading.delete(item.pendingId);
          const timeout = this.timeouts.get(item.pendingId);
          if (timeout !== undefined) { clearTimeout(timeout); this.timeouts.delete(item.pendingId); }
        }
      }
      for (const item of this.pending) {
        if (!incoming.has(item.pendingId) && Number.isFinite(item.expires) && item.expires <= now) this.fade(item);
      }
      for (const [id, item] of this.fading) if (!incoming.has(id)) items.push(item);
      this.pending = items;
      if (this.view === null) this.render();
    }
    if (msg.type === PopupMessage.Sessions) {
      this.sessions = msg.items ?? [];
      if (this.view === null) this.render();
    }
    if (msg.type === PopupMessage.AutoApproval) { this.autoApproval = msg.enabled === true; if (this.view === null) this.render(); }
    if (msg.type === PopupMessage.BrokerStatus) { this.brokerStatus = msg; this.brokerMode = msg.mode ?? this.brokerMode; if (this.view === null) this.render(); }
    if (msg.type === PopupMessage.Tabs) this.renderTabs(msg.pendingId, msg.tabs ?? []);
    if (msg.type === PopupMessage.Error) this.renderError(msg.message);
  }

  render() {
    this.view = null;
    this.clear();
    this.root.append(
      this.renderBrokerPanel(),
      this.renderPendingSection(),
      this.renderSessionsSection()
    );
  }

  renderBrokerPanel() {
    const panel = this.el('section', '', 'card panel-broker');

    // Status Row
    const statusRow = this.el('div', '', 'status-row');
    const badge = this.el('div', '', 'status-badge');
    const dot = this.el('span', '', 'dot');

    const isStopped = this.brokerStatus.mode === Broker.Off;
    const isBlocked = this.brokerStatus.state === Broker.StateBlocked;
    const isError = this.status.state === NativeStatus.Error;
    const isBackoff = this.brokerStatus.state === Broker.StateBackoff;
    const isConnected = this.status.state === NativeStatus.Connected && this.brokerStatus.state === Broker.StateRunning;

    let statusKey = Text.BrokerStarting;
    if (isStopped) {
      dot.className = 'dot off';
      statusKey = Text.BrokerStopped;
    } else if (isBlocked) {
      dot.className = 'dot err';
      statusKey = Text.BrokerBlocked;
    } else if (isError) {
      dot.className = 'dot err';
      statusKey = Text.NativeWaiting;
    } else if (isBackoff) {
      dot.className = 'dot warn';
      statusKey = Text.BrokerBackoff;
    } else if (isConnected) {
      dot.className = 'dot ok';
      statusKey = Text.NativeConnected;
    } else {
      dot.className = 'dot warn';
      statusKey = Text.BrokerStarting;
    }

    badge.append(dot, this.el('span', this.locale.get(statusKey)));
    statusRow.append(badge);

    // Both actions remain available in every lifecycle state.
    const controls = this.el('div', '', 'controls-row');
    controls.append(this.button(this.locale.get(Text.BrokerOn), 'btn-approve btn-sm', () =>
        this.port.postMessage({ type: PopupMessage.SetBrokerMode, mode: Broker.On })
    ));
    controls.append(this.button(this.locale.get(Text.BrokerOff), 'btn-deny btn-sm', () =>
        this.port.postMessage({ type: PopupMessage.SetBrokerMode, mode: Broker.Off })
    ));
    statusRow.append(controls);
    panel.append(statusRow);

    // Diagnostic Alert Box (active on error, backoff or blocked)
    if (isError || isBlocked || isBackoff) {
      const alert = this.el('div', '', `alert-box ${isError || isBlocked ? 'alert-err' : 'alert-warn'}`);
      const code = this.status.code || this.brokerStatus.code;
      if (code) alert.append(this.el('div', code, 'alert-title'));

      let hintKey = null;
      if (isError && this.status.code) {
        hintKey = NativeStatus.Hints[this.status.code] ?? Text.NativeHost;
      } else if (this.brokerStatus.state === Broker.StateBackoff || isBlocked) {
        hintKey = this.brokerStatus.code === Broker.PortInUse ? Text.BrokerPortBusy : Text.BrokerStartFailed;
      }
      if (hintKey) alert.append(this.el('div', this.locale.get(hintKey)));
      if (this.status.detail) alert.append(this.el('div', this.status.detail, 'alert-detail'));
      panel.append(alert);
    }

    // Toggles Grid: Broker Auto + Auto Approval
    const toggles = this.el('div', '', 'toggles-grid');

    // 1. Broker Auto Maintain
    const autoBrokerItem = this.el('label', '', 'toggle-item');
    const autoBrokerLeft = this.el('div', '', 'toggle-label');
    const autoBrokerInput = this.doc.createElement('input');
    autoBrokerInput.type = 'checkbox';
    autoBrokerInput.checked = this.brokerMode === Broker.Auto;
    autoBrokerInput.addEventListener('change', () =>
      this.port.postMessage({ type: PopupMessage.SetBrokerMode, mode: autoBrokerInput.checked ? Broker.Auto : Broker.On })
    );
    autoBrokerLeft.append(autoBrokerInput, this.doc.createTextNode(this.locale.get(Text.BrokerAutoShort)));
    autoBrokerItem.title = this.locale.get(Text.BrokerAuto);
    autoBrokerItem.append(autoBrokerLeft);
    toggles.append(autoBrokerItem);

    // 2. Auto Approval
    const autoApprovalItem = this.el('label', '', 'toggle-item');
    const autoApprovalLeft = this.el('div', '', 'toggle-label');
    const autoApprovalInput = this.doc.createElement('input');
    autoApprovalInput.type = 'checkbox';
    autoApprovalInput.checked = this.autoApproval;
    autoApprovalInput.addEventListener('change', () =>
      this.port.postMessage({ type: PopupMessage.SetAutoApproval, enabled: autoApprovalInput.checked })
    );
    autoApprovalLeft.append(autoApprovalInput, this.doc.createTextNode(this.locale.get(Text.AutoApprovalShort)));
    const autoApprovalStatus = this.el('span', this.locale.get(this.autoApproval ? Text.Enabled : Text.Disabled), 'toggle-status');
    autoApprovalItem.append(autoApprovalLeft, autoApprovalStatus);
    toggles.append(autoApprovalItem);

    panel.append(toggles);

    // Progressive Disclosure: Policy Details
    const details = this.el('details', '', 'disclosure');
    const summary = this.el('summary', this.locale.get(Text.PolicyDetails));
    const body = this.el('div', '', 'disclosure-body');
    body.append(
      this.el('p', this.autoApproval ? this.locale.get(Text.AutoOn) : this.locale.get(Text.AutoOff)),
      this.el('p', this.locale.get(Text.AutoHint))
    );
    details.append(summary, body);
    panel.append(details);

    return panel;
  }

  renderPendingSection() {
    const items = this.pending;
    const sec = this.el('section', '', 'section');
    const head = this.el('div', '', 'section-head');
    head.append(this.el('h2', this.locale.get(Text.Pending), 'section-title'));
    if (items.length > 0) {
      head.append(this.el('span', String(items.length), 'section-badge highlight'));
    }
    sec.append(head);

    if (!items.length) {
      sec.append(this.el('div', this.locale.get(Text.NoPending), 'empty'));
      return sec;
    }

    for (const item of items) {
      let fading = this.fading.has(item.pendingId);
      if (!fading && Number.isFinite(item.expires) && item.expires <= Date.now()) {
        this.fade(item);
        fading = true;
      }
      const card = this.el('article', '', `card pending-card${fading ? ' expired' : ''}`);

      const top = this.el('div', '', 'item-top');
      const side = this.el('div', '', 'item-side');
      side.append(this.el('span', item.mode === 'newGroup' ? this.locale.get(Text.NewGroup) : this.locale.get(Text.Attach), 'mode-tag'));
      if (fading) {
        side.append(this.el('span', this.locale.get(Text.Expired), 'countdown expired'));
      } else if (Number.isFinite(item.expires)) {
        const left = item.expires - Date.now();
        const clock = this.el('span', this.format(left), `countdown${left <= 20000 ? ' warn' : ''}`);
        this.countdowns.set(item.pendingId, { node: clock, card, expires: item.expires, item, expired: false });
        side.append(clock);
      }
      top.append(this.el('span', item.clientId, 'client-tag'), side);
      card.append(top);

      if (item.url && item.url !== 'about:blank') {
        let origin = item.url;
        try { origin = new URL(item.url).origin; } catch { /* Keep safe text */ }
        const urlBox = this.el('div', origin, 'url-box');
        urlBox.title = item.url;
        card.append(urlBox);
      }

      const actions = this.el('div', '', 'actions-row');
      const allowBtn = this.button(
        item.mode === 'newGroup' ? this.locale.get(Text.Approve) : this.locale.get(Text.Choose),
        'btn-approve',
        () => {
          if (item.mode === 'newGroup') this.approve(item.pendingId);
          else this.port.postMessage({ type: PopupMessage.Tabs, pendingId: item.pendingId });
        }
      );
      const denyBtn = this.button(this.locale.get(Text.Deny), 'btn-deny', () =>
        this.port.postMessage({ type: PopupMessage.Deny, pendingId: item.pendingId })
      );
      actions.append(allowBtn, denyBtn);
      if (!fading) card.append(actions);

      // Access permission disclosure
      const details = this.el('details', '', 'disclosure');
      const summary = this.el('summary', this.locale.get(Text.AccessDetails));
      const body = this.el('div', this.locale.get(Text.AccessHint), 'disclosure-body');
      details.append(summary, body);
      card.append(details);

      sec.append(card);
    }

    return sec;
  }

  renderSessionsSection() {
    const sec = this.el('section', '', 'section');
    const head = this.el('div', '', 'section-head');
    head.append(this.el('h2', this.locale.get(Text.Sessions), 'section-title'));
    if (this.sessions.length > 0) {
      head.append(this.el('span', String(this.sessions.length), 'section-badge'));
    }
    sec.append(head);

    if (!this.sessions.length) {
      sec.append(this.el('div', this.locale.get(Text.NoSessions), 'empty'));
      return sec;
    }

    for (const session of this.sessions) {
      const card = this.el('article', '', 'card session-card');
      const top = this.el('div', '', 'session-top');
      top.append(this.el('span', session.clientId, 'session-client'));
      top.append(this.button(this.locale.get(Text.Revoke), 'btn-revoke', () =>
        this.port.postMessage({ type: PopupMessage.Revoke, sessionId: session.sessionId })
      ));
      card.append(top);

      if (session.pages && session.pages.length > 0) {
        const pagesList = this.el('div', '', 'session-pages');
        for (const page of session.pages) {
          let origin = page.url;
          try { origin = new URL(page.url).origin; } catch { /* Show blank/raw */ }
          const pageRow = this.el('div', origin || 'about:blank', 'page-row');
          pageRow.title = page.url || 'about:blank';
          pagesList.append(pageRow);
        }
        card.append(pagesList);
      }

      sec.append(card);
    }

    return sec;
  }

  renderTabs(id, tabs) {
    this.view = { id, tabs };
    this.clear();
    const sec = this.el('section', '', 'section');
    const head = this.el('div', '', 'section-head');
    head.append(this.el('h2', this.locale.get(Text.Choose), 'section-title'));
    sec.append(head);
    sec.append(this.el('div', this.locale.get(Text.ChooseHint), 'disclosure-body'));

    if (!tabs.length) {
      sec.append(this.el('div', this.locale.get(Text.NoTabs), 'empty'));
    } else {
      const tabList = this.el('div', '', 'tab-list');
      for (const tab of tabs) {
        const button = this.el('button', '', 'tab');
        button.append(
          this.el('strong', tab.title || tab.url),
          this.el('span', tab.url)
        );
        button.addEventListener('click', () => this.approve(id, tab.tabId));
        tabList.append(button);
      }
      sec.append(tabList);
    }

    sec.append(this.button(this.locale.get(Text.Back), 'btn-deny btn-sm', () => this.start()));
    this.root.append(sec);
  }

  renderError(message = this.error) {
    this.error = message ?? Failure.Failed;
    this.view = { error: true };
    this.reset();
    this.clear();
    const card = this.el('section', '', 'card alert-box alert-err');
    card.append(this.el('div', this.locale.get(Text.Error), 'alert-title'));
    card.append(this.el('div', this.locale.get(ErrorText.Keys[this.error] ?? Text.Error)));
    card.append(this.button(this.locale.get(Text.Refresh), 'btn-deny btn-sm', () => this.start()));
    this.root.append(card);
  }

  tick() {
    const now = Date.now();
    for (const item of this.countdowns.values()) {
      const left = item.expires - now;
      if (left > 0) {
        item.node.textContent = this.format(left);
        item.node.classList.toggle('warn', left <= 20000);
        continue;
      }
      if (item.expired) continue;
      item.expired = true;
      this.fade(item.item);
      item.node.textContent = this.locale.get(Text.Expired);
      item.node.classList.remove('warn');
      item.node.classList.add('expired');
      item.card.classList.add('expired');
      item.card.querySelector('.actions-row')?.remove();
    }
  }

  fade(item) {
    if (this.fading.has(item.pendingId)) return;
    this.fading.set(item.pendingId, item);
    const timeout = setTimeout(() => {
      if (this.timeouts.get(item.pendingId) === timeout) this.timeouts.delete(item.pendingId);
      if (this.fading.get(item.pendingId) !== item) return;
      this.fading.delete(item.pendingId);
      this.countdowns.delete(item.pendingId);
      this.pending = this.pending.filter(pending => pending.pendingId !== item.pendingId);
      if (this.view === null) this.render();
    }, 2000);
    this.timeouts.set(item.pendingId, timeout);
  }

  reset() {
    this.fading.clear();
    for (const timeout of this.timeouts.values()) clearTimeout(timeout);
    this.timeouts.clear();
  }

  close() {
    clearInterval(this.timer);
    this.reset();
  }

  format(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  approve(pendingId, tabId) {
    this.port.postMessage({ type: PopupMessage.Approve, pendingId, tabId });
  }

  button(label, cls, fn) {
    const b = this.el('button', label, cls);
    b.addEventListener('click', fn);
    return b;
  }

  el(tag, text = '', cls = '') {
    const e = this.doc.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  clear() {
    this.countdowns.clear();
    this.root.replaceChildren();
  }
}

new Popup().init();
