import { Broker, Failure, NativeStatus, PopupMessage, SessionMode } from './protocol.js';
import { ErrorText, Locale, Text } from './i18n.js';

class Popup {
  constructor(api = chrome, doc = document) {
    this.api = api;
    this.doc = doc;
    this.root = doc.getElementById('items');
    this.pending = [];
    this.sessions = [];
    this.autoApproval = false;
    this.brokerMode = Broker.Auto;
    this.brokerStatus = { state: Broker.StateStarting };
    this.locale = new Locale(api);
    this.view = null;
    this.error = Failure.Failed;
    this.status = { state: NativeStatus.Waiting };
    this.countdowns = new Map();
    this.durations = [];
    this.fading = new Map();
    this.timeouts = new Map();
    this.revokedNotice = false;
    this.revokedTimer = null;
    this.port = api.runtime.connect({ name: PopupMessage.Port });
    this.port.onMessage.addListener(msg => this.receive(msg));
    this.port.onDisconnect?.addListener(() => this.close());
    this.timer = setInterval(() => this.tick(), 1000);
  }

  async init() {
    await this.locale.load();
    this.localize();
    const version = this.api.runtime.getManifest?.()?.version;
    const versionEl = this.doc.getElementById('version');
    if (versionEl) versionEl.textContent = version ? `v${version}` : '';
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
    if (msg.type === PopupMessage.AutoApproval) {
      this.autoApproval = msg.enabled === true;
      this.syncHeader();
      if (this.view === null) this.render();
    }
    if (msg.type === PopupMessage.BrokerStatus) {
      this.brokerStatus = msg;
      this.brokerMode = msg.mode ?? this.brokerMode;
      if (this.view === null) {
        const focusRadio = this.doc.activeElement?.getAttribute?.('role') === 'radio';
        this.render();
        if (focusRadio) this.root.querySelector('.seg-btn[aria-checked="true"]')?.focus();
      }
    }
    if (msg.type === PopupMessage.Tabs) this.renderTabs(msg.pendingId, msg.tabs ?? []);
    if (msg.type === PopupMessage.Error) this.renderError(msg.message);
  }

  render() {
    this.view = null;
    this.syncHeader();
    this.clear();
    this.root.append(
      this.renderBrokerPanel(),
      this.renderPendingSection(),
      this.renderSessionsSection()
    );
  }

  syncHeader() {
    const badge = this.doc.getElementById('auto-badge');
    if (badge) badge.hidden = !this.autoApproval;
  }

  renderBrokerPanel() {
    const panel = this.el('section', '', 'card panel-broker');

    // Status Row
    const statusRow = this.el('div', '', 'status-row');
    const badge = this.el('div', '', 'status-badge');
    const dot = this.el('span', '', 'dot');

    const isStopped = this.brokerStatus.mode === Broker.Off || this.brokerMode === Broker.Off;
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

    const modeKey = this.brokerMode === Broker.Auto ? Text.BrokerAutoShort : this.brokerMode === Broker.On ? Text.ModeOn : Text.ModeOff;
    const statusText = isStopped
      ? this.locale.get(statusKey)
      : `${this.locale.get(statusKey)} · ${this.locale.get(modeKey)}`;
    badge.append(dot, this.el('span', statusText));
    statusRow.append(badge);
    panel.append(statusRow);

    // Segmented Broker Mode Control
    const group = this.el('div', '', 'segmented');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', this.locale.get(Text.Broker));
    const modes = [
      [Broker.Auto, Text.ModeAuto, Text.BrokerAuto],
      [Broker.On, Text.ModeOn, Text.BrokerOn],
      [Broker.Off, Text.ModeOff, Text.BrokerOff]
    ];
    const radios = [];
    for (const [mode, labelKey, titleKey] of modes) {
      const active = this.brokerMode === mode;
      const btn = this.button(this.locale.get(labelKey), 'seg-btn', () => {
        if (this.brokerMode === mode) return;
        this.brokerMode = mode;
        for (let i = 0; i < radios.length; i++) {
          const checked = modes[i][0] === mode;
          radios[i].setAttribute('aria-checked', String(checked));
          radios[i].tabIndex = checked ? 0 : -1;
        }
        this.port.postMessage({ type: PopupMessage.SetBrokerMode, mode });
      });
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(active));
      btn.tabIndex = active ? 0 : -1;
      btn.title = this.locale.get(titleKey);
      btn.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        const idx = (modes.findIndex(([m]) => m === mode) + dir + modes.length) % modes.length;
        const [nextMode] = modes[idx];
        this.brokerMode = nextMode;
        for (let i = 0; i < radios.length; i++) {
          const checked = i === idx;
          radios[i].setAttribute('aria-checked', String(checked));
          radios[i].tabIndex = checked ? 0 : -1;
        }
        radios[idx].focus();
        this.port.postMessage({ type: PopupMessage.SetBrokerMode, mode: nextMode });
      });
      radios.push(btn);
      group.append(btn);
    }
    panel.append(group);

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

    // Toggles Grid: Auto Approval
    const toggles = this.el('div', '', 'toggles-grid');
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

      const perms = this.el('div', '', 'perm-tags');
      const permKeys = [Text.PermRead, Text.PermControl, Text.PermNavigate];
      if (item.mode === SessionMode.NewGroup) permKeys.push(Text.PermTabs);
      for (const key of permKeys) perms.append(this.el('span', this.locale.get(key), 'perm-tag'));
      card.append(perms);

      const actions = this.el('div', '', 'actions-row');
      const denyBtn = this.button(this.locale.get(Text.Deny), 'btn-deny', () =>
        this.port.postMessage({ type: PopupMessage.Deny, pendingId: item.pendingId })
      );
      const allowBtn = this.button(
        item.mode === 'newGroup' ? this.locale.get(Text.Approve) : this.locale.get(Text.Choose),
        'btn-approve',
        () => {
          if (item.mode === 'newGroup') this.approve(item.pendingId);
          else this.port.postMessage({ type: PopupMessage.Tabs, pendingId: item.pendingId });
        }
      );
      actions.append(denyBtn, allowBtn);
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
    const left = this.el('div', '', 'section-head-left');
    left.append(this.el('h2', this.locale.get(Text.Sessions), 'section-title'));
    if (this.sessions.length > 0) {
      left.append(this.el('span', String(this.sessions.length), 'section-badge'));
    }
    const right = this.el('div', '', 'section-head-right');
    if (this.revokedNotice) {
      right.append(this.el('span', this.locale.get(Text.Revoked), 'revoked-notice'));
    }
    if (this.sessions.length > 0) {
      right.append(this.button(this.locale.get(Text.RevokeAll), 'btn-revoke', () => {
        this.showRevoked();
        this.port.postMessage({ type: PopupMessage.RevokeAll });
      }));
    }
    head.append(left, right);
    sec.append(head);

    if (!this.sessions.length) {
      sec.append(this.el('div', this.locale.get(Text.NoSessions), 'empty'));
      return sec;
    }

    for (const session of this.sessions) {
      const card = this.el('article', '', 'card session-card');
      const top = this.el('div', '', 'session-top');
      const meta = this.el('div', '', 'session-meta');
      meta.append(this.el('span', session.clientId, 'session-client'));
      const started = Number.isFinite(session.started) ? session.started : Date.now();
      const durationEl = this.el('span', this.formatDuration(started), 'session-duration');
      this.durations.push({ node: durationEl, started });
      meta.append(durationEl);
      top.append(meta);
      top.append(this.button(this.locale.get(Text.Revoke), 'btn-revoke', () => {
        this.showRevoked();
        this.port.postMessage({ type: PopupMessage.Revoke, sessionId: session.sessionId });
      }));
      card.append(top);

      if (session.pages && session.pages.length > 0) {
        const pagesList = this.el('div', '', 'session-pages');
        for (const page of session.pages) {
          let domain = page.url || 'about:blank';
          try {
            const parsed = new URL(page.url);
            domain = parsed.hostname || page.url || domain;
          } catch { /* Keep raw url */ }
          const title = page.title || domain;
          const initial = (domain.replace(/^www\./i, '')[0] || title[0] || '•').toUpperCase();
          const row = Number.isInteger(page.tabId)
            ? this.button('', 'page-row', () => this.port.postMessage({ type: PopupMessage.Focus, tabId: page.tabId }))
            : this.el('div', '', 'page-row');
          row.title = page.url || 'about:blank';
          row.append(this.el('span', initial, 'page-favicon'), this.el('span', title, 'page-title'));
          if (page.title) row.append(this.el('span', domain, 'page-domain'));
          pagesList.append(row);
        }
        card.append(pagesList);
      }

      sec.append(card);
    }

    return sec;
  }

  showRevoked() {
    this.revokedNotice = true;
    clearTimeout(this.revokedTimer);
    this.revokedTimer = setTimeout(() => {
      this.revokedNotice = false;
      this.revokedTimer = null;
      if (this.view === null) this.render();
    }, 5000);
    if (this.view === null) this.render();
  }

  formatDuration(started) {
    const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
    return this.locale.get(Text.SessionDuration).replace('$1', String(minutes));
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
    for (const item of this.durations) {
      item.node.textContent = this.formatDuration(item.started);
    }
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
    clearTimeout(this.revokedTimer);
    this.revokedTimer = null;
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
    this.durations = [];
    this.root.replaceChildren();
  }
}

new Popup().init();
