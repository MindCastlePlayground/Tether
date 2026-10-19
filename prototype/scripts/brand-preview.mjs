import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { Broker, Failure, PopupMessage } from '../extension/protocol.js';
import { ErrorText, Text } from '../extension/i18n.js';

class Preview {
  static Root = fileURLToPath(new URL('../extension/', import.meta.url));
  static Assets = fileURLToPath(new URL('../../assets/', import.meta.url));
  static Origin = 'https://tether-preview.test';
  static Files = new Set(['popup.html', 'popup.js', 'protocol.js', 'i18n.js', '_locales/en/messages.json', '_locales/zh_CN/messages.json', 'icons/icon-128.png']);
  static Types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

  static async run() {
    const catalogs = {};
    for (const [language, directory] of [['en', 'en'], ['zh-CN', 'zh_CN']]) {
      catalogs[language] = JSON.parse(await readFile(resolve(this.Root, `_locales/${directory}/messages.json`), 'utf8'));
    }
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 380, height: 720 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        const file = url.pathname.slice(1);
        if (url.origin !== this.Origin || !this.Files.has(file)) return route.abort();
        await route.fulfill({ body: await readFile(resolve(this.Root, file)), contentType: this.Types[extname(file)] });
      });
      const events = Object.fromEntries(Object.getOwnPropertyNames(PopupMessage)
        .filter(key => typeof PopupMessage[key] === 'string').map(key => [key, PopupMessage[key]]));
      const broker = Object.fromEntries(Object.getOwnPropertyNames(Broker)
        .filter(key => typeof Broker[key] === 'string').map(key => [key, Broker[key]]));
      await page.addInitScript(({ events, broker }) => {
        class MockPort {
          onMessage = { addListener: fn => { this.receive = fn; } };
          postMessage(msg) {
            window.lastMessage = msg;
            if (msg.type === events.SetAutoApproval) {
              window.approval = msg.enabled;
              this.receive({ type: events.AutoApproval, enabled: msg.enabled });
            } else if (msg.type === events.AutoApproval) {
              this.receive({ type: msg.type, enabled: true });
            } else if (msg.type === events.SetBrokerMode) {
              window.brokerMode = msg.mode;
              this.receive({ type: events.BrokerStatus, mode: msg.mode, state: msg.mode === broker.Off ? broker.StateStopped : broker.StateRunning });
            } else if (msg.type === events.Pending || msg.type === events.Sessions) {
              this.receive({ type: msg.type, items: [] });
            }
          }
        }
        window.port = new MockPort();
        window.chrome = {
          runtime: { connect: () => window.port, getManifest: () => ({ version: '1.1.0' }) },
          i18n: { getUILanguage: () => localStorage.getItem('systemLanguage') || 'en-US' },
          storage: { local: {
            get: async key => ({ [key]: localStorage.getItem(key) }),
            set: async data => { for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value); }
          } }
        };
      }, { events, broker });
      await page.goto(`${this.Origin}/popup.html`);
      await page.getByText(catalogs.en[Text.NoSessions].message, { exact: true }).waitFor();
      assert.equal(await page.title(), catalogs.en[Text.Title].message);
      assert.equal(await page.locator('header img').evaluate(img => img.complete && img.naturalWidth === 128), true);
      assert.equal(await page.locator('#version').textContent(), 'v1.1.0');
      assert.equal(await page.locator('#auto-badge').isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await mkdir(this.Assets, { recursive: true });
      await page.screenshot({ path: resolve(this.Assets, 'popup-preview.png'), fullPage: true });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: resolve(this.Assets, 'popup-preview.dark.png'), fullPage: true });
      await page.emulateMedia({ colorScheme: 'light' });

      const radioGroup = page.getByRole('radiogroup', { name: catalogs.en[Text.Broker].message });
      const radioAuto = radioGroup.getByRole('radio', { name: catalogs.en[Text.ModeAuto].message });
      const radioOn = radioGroup.getByRole('radio', { name: catalogs.en[Text.ModeOn].message });
      const radioOff = radioGroup.getByRole('radio', { name: catalogs.en[Text.ModeOff].message });
      assert.equal(await radioAuto.getAttribute('aria-checked'), 'true');
      await radioOn.click();
      assert.deepEqual(await page.evaluate(() => window.lastMessage), { type: events.SetBrokerMode, mode: broker.On });
      assert.equal(await radioOn.getAttribute('aria-checked'), 'true');
      await radioOn.focus();
      await page.keyboard.press('ArrowRight');
      assert.deepEqual(await page.evaluate(() => window.lastMessage), { type: events.SetBrokerMode, mode: broker.Off });
      assert.equal(await radioOff.getAttribute('aria-checked'), 'true');
      await page.keyboard.press('ArrowRight');
      assert.deepEqual(await page.evaluate(() => window.lastMessage), { type: events.SetBrokerMode, mode: broker.Auto });
      assert.equal(await radioAuto.getAttribute('aria-checked'), 'true');

      assert.equal(await page.locator('.pending-card').count(), 0);
      await page.evaluate(events => window.port.receive({ type: events.Pending, items: [
        { pendingId: 'live', clientId: 'agent-live', mode: 'newGroup', url: 'https://example.com/live', expires: Date.now() + 65000 }
      ] }), events);
      await page.getByText('agent-live', { exact: true }).waitFor();
      assert.match(await page.locator('.countdown').textContent(), /^1:0[0-5]$/);

      await page.evaluate(events => window.port.receive({ type: events.Pending, items: [
        { pendingId: 'soon', clientId: 'agent-soon', mode: 'newGroup', url: 'https://example.com/soon', expires: Date.now() + 15000 }
      ] }), events);
      await page.locator('.countdown.warn').waitFor();
      assert.match(await page.locator('.countdown.warn').textContent(), /^0:1[0-5]$/);

      await page.evaluate(events => window.port.receive({ type: events.Pending, items: [
        { pendingId: 'gone', clientId: 'agent-gone', mode: 'newGroup', url: 'https://example.com/gone', expires: Date.now() + 800 }
      ] }), events);
      const expiring = page.locator('.pending-card').filter({ hasText: 'agent-gone' });
      await expiring.getByText(catalogs.en[Text.Expired].message, { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await expiring.locator('button').count(), 0);
      await page.evaluate(events => window.port.receive({ type: events.Pending, items: [
        { pendingId: 'gone', clientId: 'agent-gone', mode: 'newGroup', url: 'https://example.com/gone', expires: Date.now() - 1000 }
      ] }), events);
      await expiring.getByText(catalogs.en[Text.Expired].message, { exact: true }).waitFor();
      assert.equal(await expiring.locator('button').count(), 0);
      await expiring.waitFor({ state: 'detached', timeout: 5000 });
      await page.evaluate(events => window.port.receive({ type: events.Pending, items: [] }), events);
      await page.getByText(catalogs.en[Text.NoPending].message, { exact: true }).waitFor();

      await page.locator('details.disclosure').first().locator('summary').click();
      const autoToggle = page.getByRole('checkbox', { name: catalogs.en[Text.AutoApprovalShort].message });
      await autoToggle.uncheck();
      await page.locator('details.disclosure').first().locator('summary').click();
      await page.getByText(catalogs.en[Text.AutoOff].message, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.approval), false);
      await page.keyboard.press('Tab');
      await autoToggle.focus();
      assert.equal(await autoToggle.evaluate(el => el.matches(':focus-visible')), true);
      assert.deepEqual(errors, []);

      for (const [language, directory] of [['en', 'en'], ['zh-CN', 'zh_CN']]) {
        const catalog = catalogs[language];
        const text = key => catalog[key].message;
        await page.locator('#language').selectOption(language);
        await page.getByText(text(Text.NoSessions), { exact: true }).waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'), language);
        assert.equal(await page.title(), text(Text.Title));
        await page.reload();
        await page.getByText(text(Text.NoSessions), { exact: true }).waitFor();
        assert.equal(await page.locator('#language').inputValue(), language);
        const toggle = page.getByRole('checkbox', { name: text(Text.AutoApprovalShort) });
        await toggle.uncheck();
        await page.locator('details.disclosure').first().locator('summary').click();
        await page.getByText(text(Text.AutoOff), { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.approval), false);

        assert.equal(await page.locator('.pending-card').count(), 0);
        await page.evaluate(events => window.port.receive({ type: events.Pending, items: [
          { pendingId: 'new', clientId: 'agent-new', mode: 'newGroup', url: 'https://example.com/new', expires: Date.now() + 65000 },
          { pendingId: 'existing', clientId: 'agent-existing', mode: 'attachExisting', url: 'https://example.com/existing', expires: Date.now() + 90000 }
        ] }), events);
        await page.getByText('agent-new', { exact: true }).waitFor();
        assert.equal(await page.locator('.countdown').count(), 2);
        assert.match(await page.locator('.countdown').first().textContent(), /^1:0[0-5]$/);
        const newCard = page.locator('.pending-card').filter({ hasText: 'agent-new' });
        const existingCard = page.locator('.pending-card').filter({ hasText: 'agent-existing' });
        assert.deepEqual(await newCard.locator('.perm-tag').allTextContents(), [
          text(Text.PermRead), text(Text.PermControl), text(Text.PermNavigate), text(Text.PermTabs)
        ]);
        assert.deepEqual(await existingCard.locator('.perm-tag').allTextContents(), [
          text(Text.PermRead), text(Text.PermControl), text(Text.PermNavigate)
        ]);
        await page.evaluate(events => window.port.receive({ type: events.Sessions, items: [
          { sessionId: 'session', clientId: 'agent-active', started: Date.now() - 180000, pages: [
            { tabId: 42, title: 'Example Domain', url: 'https://example.com' },
            { tabId: 43, url: 'about:blank' },
            { tabId: 44, title: 'New Tab', url: 'about:blank' }
          ] }
        ] }), events);
        const blank = page.locator('.page-row').nth(1);
        const namedBlank = page.locator('.page-row').nth(2);
        assert.equal(await blank.locator('.page-title').textContent(), 'about:blank');
        assert.equal(await blank.locator('.page-domain').count(), 0);
        assert.equal(await blank.locator('.page-favicon').textContent(), 'A');
        assert.equal(await blank.evaluate(node => node.textContent.includes('null')), false);
        assert.equal(await namedBlank.locator('.page-title').textContent(), 'New Tab');
        assert.equal(await namedBlank.locator('.page-domain').textContent(), 'about:blank');
        await page.locator('.page-row').first().click();
        assert.deepEqual(await page.evaluate(() => window.lastMessage), { type: events.Focus, tabId: 42 });
        await page.getByRole('button', { name: text(Text.RevokeAll), exact: true }).click();
        assert.deepEqual(await page.evaluate(() => window.lastMessage), { type: events.RevokeAll });
        await page.getByText(text(Text.Revoked), { exact: true }).waitFor();
        await page.getByRole('button', { name: text(Text.Approve), exact: true }).click();
        assert.deepEqual(await page.evaluate(() => window.lastMessage), { type: events.Approve, pendingId: 'new', tabId: undefined });
        await page.getByRole('button', { name: text(Text.Deny), exact: true }).first().click();
        assert.equal(await page.evaluate(() => window.lastMessage.type), events.Deny);
        await page.getByRole('button', { name: text(Text.Revoke), exact: true }).click();
        assert.equal(await page.evaluate(() => window.lastMessage.sessionId), 'session');
        await page.getByRole('button', { name: text(Text.Choose), exact: true }).click();
        assert.equal(await page.evaluate(() => window.lastMessage.pendingId), 'existing');
        await page.evaluate(events => window.port.receive({ type: events.Tabs, pendingId: 'existing', tabs: [] }), events);
        await page.getByText(text(Text.NoTabs), { exact: true }).waitFor();
        await page.evaluate(events => window.port.receive({ type: events.Pending, items: [
          { pendingId: 'push', clientId: 'agent-push', mode: 'newGroup', url: 'https://example.com/push', expires: Date.now() + 60000 }
        ] }), events);
        await page.getByText(text(Text.NoTabs), { exact: true }).waitFor();
        assert.equal(await page.locator('.pending-card').count(), 0);
        await page.evaluate(events => window.port.receive({ type: events.Tabs, pendingId: 'existing', tabs: [
          { tabId: 17, title: 'Example', url: 'https://example.com' }
        ] }), events);
        await page.getByRole('button', { name: 'Example' }).click();
        assert.equal(await page.evaluate(() => window.lastMessage.tabId), 17);
        const other = language === 'en' ? 'zh-CN' : 'en';
        await page.locator('#language').selectOption(other);
        await page.getByRole('button', { name: 'Example' }).waitFor();
        await page.locator('#language').selectOption(language);
        await page.getByRole('button', { name: text(Text.Back), exact: true }).click();
        await page.getByText(text(Text.NoSessions), { exact: true }).waitFor();

        for (const code of [Failure.Forbidden, Failure.Missing, Failure.Invalid, Failure.Failed]) {
          await page.evaluate(({ events, code }) => window.port.receive({ type: events.Error, message: code }), { events, code });
          await page.getByText(text(ErrorText.Keys[code]), { exact: true }).first().waitFor();
          await page.evaluate(events => window.port.receive({ type: events.Pending, items: [
            { pendingId: 'error-push', clientId: 'agent-error', mode: 'newGroup', url: 'https://example.com/error', expires: Date.now() + 60000 }
          ] }), events);
          await page.getByText(text(ErrorText.Keys[code]), { exact: true }).first().waitFor();
          await page.getByRole('button', { name: text(Text.Refresh), exact: true }).click();
          await page.getByText(text(Text.NoSessions), { exact: true }).waitFor();
        }

        await page.reload();
        await page.getByText(text(Text.NoSessions), { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: resolve(this.Assets, language === 'en' ? 'popup-preview.png' : 'popup-preview.zh-CN.png'), fullPage: true });
      }
      assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs['zh-CN']).sort());
      await page.locator('#language').selectOption('auto');
      await page.getByText(catalogs.en[Text.NoSessions].message, { exact: true }).waitFor();
      await page.evaluate(() => localStorage.setItem('language', 'invalid'));
      await page.reload();
      await page.getByText(catalogs.en[Text.NoSessions].message, { exact: true }).waitFor();
      assert.equal(await page.locator('#language').inputValue(), 'auto');
      await page.evaluate(() => localStorage.setItem('systemLanguage', 'zh-TW'));
      await page.reload();
      await page.getByText(catalogs['zh-CN'][Text.NoSessions].message, { exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
      assert.deepEqual(errors, []);
      const report = { at: new Date().toISOString(), fixture: 'mock extension runtime; no Native Host or Broker', languages: ['en', 'zh-CN'], states: ['empty', 'live push', 'countdown', 'countdown warning', 'expired removal', 'auto-approval', 'pending', 'sessions', 'tab chooser', 'no tabs', 'error codes'], persistence: 'reload passed', systemLanguage: 'en-US and zh-TW passed', invalidPreference: 'falls back to browser', localeKeys: Object.keys(catalogs.en).length, logo: '128px loaded', overflow: false, keyboardFocus: 'passed', pageErrors: errors };
      await writeFile(resolve(this.Assets, 'preview-verification.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
    } finally {
      await browser.close();
    }
  }
}

Preview.run().catch(error => { console.error(error); process.exitCode = 1; });
