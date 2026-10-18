import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { PopupMessage } from '../extension/protocol.js';

class Preview {
  static Root = fileURLToPath(new URL('../extension/', import.meta.url));
  static Assets = fileURLToPath(new URL('../../assets/', import.meta.url));
  static Origin = 'https://tether-preview.test';
  static Files = new Set(['popup.html', 'popup.js', 'protocol.js', 'i18n.js', '_locales/en/messages.json', '_locales/zh_CN/messages.json', 'icons/icon-128.png']);
  static Types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

  static async run() {
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
      await page.addInitScript(events => {
        class MockPort {
          onMessage = { addListener: fn => { this.receive = fn; } };
          postMessage(msg) {
            window.lastMessage = msg;
            if (msg.type === events.SetAutoApproval) {
              window.approval = msg.enabled;
              this.receive({ type: events.AutoApproval, enabled: msg.enabled });
            } else if (msg.type === events.AutoApproval) {
              this.receive({ type: msg.type, enabled: true });
            } else if (msg.type === events.Pending || msg.type === events.Sessions) {
              this.receive({ type: msg.type, items: [] });
            }
          }
        }
        window.port = new MockPort();
        window.chrome = {
          runtime: { connect: () => window.port },
          i18n: { getUILanguage: () => localStorage.getItem('systemLanguage') || 'en-US' },
          storage: { local: {
            get: async key => ({ [key]: localStorage.getItem(key) }),
            set: async data => { for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value); }
          } }
        };
      }, events);
      await page.goto(`${this.Origin}/popup.html`);
      await page.getByText('No active sessions.', { exact: true }).waitFor();
      assert.equal(await page.title(), 'Tether — Browser access');
      assert.equal(await page.locator('header img').evaluate(img => img.complete && img.naturalWidth === 128), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await mkdir(this.Assets, { recursive: true });
      await page.screenshot({ path: resolve(this.Assets, 'popup-preview.png'), fullPage: true });
      await page.getByRole('checkbox', { name: 'Automatically approve new groups and existing tabs', exact: true }).uncheck();
      await page.getByText('Off: requests wait for your approval, and clients cannot enumerate tabs.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.approval), false);
      await page.keyboard.press('Tab');
      await page.getByRole('checkbox', { name: 'Automatically approve new groups and existing tabs', exact: true }).focus();
      assert.equal(await page.getByRole('checkbox', { name: 'Automatically approve new groups and existing tabs', exact: true }).evaluate(el => el.matches(':focus-visible')), true);
      assert.deepEqual(errors, []);
      const catalogs = {};
      for (const [language, directory] of [['en', 'en'], ['zh-CN', 'zh_CN']]) {
        const catalog = JSON.parse(await readFile(resolve(this.Root, `_locales/${directory}/messages.json`), 'utf8'));
        catalogs[language] = catalog;
        const text = key => catalog[key].message;
        await page.locator('#language').selectOption(language);
        await page.getByText(text('noSessions'), { exact: true }).waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'), language);
        assert.equal(await page.title(), text('title'));
        await page.reload();
        await page.getByText(text('noSessions'), { exact: true }).waitFor();
        assert.equal(await page.locator('#language').inputValue(), language);
        await page.getByRole('checkbox', { name: text('autoApproval'), exact: true }).uncheck();
        await page.getByText(text('autoOff'), { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.approval), false);
        await page.evaluate(events => {
          window.port.receive({ type: events.Pending, items: [
            { pendingId: 'new', clientId: 'agent-new', mode: 'newGroup' },
            { pendingId: 'existing', clientId: 'agent-existing', mode: 'attachExisting' }
          ] });
          window.port.receive({ type: events.Sessions, items: [
            { sessionId: 'session', clientId: 'agent-active', pages: [{ url: 'https://example.com' }] }
          ] });
        }, events);
        await page.getByRole('button', { name: text('approve'), exact: true }).click();
        assert.deepEqual(await page.evaluate(() => window.lastMessage), { type: events.Approve, pendingId: 'new', tabId: undefined });
        await page.getByRole('button', { name: text('deny'), exact: true }).first().click();
        assert.equal(await page.evaluate(() => window.lastMessage.type), events.Deny);
        await page.getByRole('button', { name: text('revoke'), exact: true }).click();
        assert.equal(await page.evaluate(() => window.lastMessage.sessionId), 'session');
        await page.getByRole('button', { name: text('choose'), exact: true }).click();
        assert.equal(await page.evaluate(() => window.lastMessage.pendingId), 'existing');
        await page.evaluate(events => window.port.receive({ type: events.Tabs, pendingId: 'existing', tabs: [] }), events);
        await page.getByText(text('noTabs'), { exact: true }).waitFor();
        await page.evaluate(events => window.port.receive({ type: events.Tabs, pendingId: 'existing', tabs: [
          { tabId: 17, title: 'Example', url: 'https://example.com' }
        ] }), events);
        await page.getByRole('button', { name: 'Example' }).click();
        assert.equal(await page.evaluate(() => window.lastMessage.tabId), 17);
        const other = language === 'en' ? 'zh-CN' : 'en';
        await page.locator('#language').selectOption(other);
        await page.getByRole('button', { name: 'Example' }).waitFor();
        await page.locator('#language').selectOption(language);
        await page.getByRole('button', { name: text('back'), exact: true }).click();
        await page.getByText(text('noSessions'), { exact: true }).waitFor();
        await page.evaluate(events => window.port.receive({ type: events.Error }), events);
        await page.getByText(text('error'), { exact: true }).waitFor();
        await page.locator('#language').selectOption(other);
        await page.locator('#language').selectOption(language);
        await page.getByText(text('error'), { exact: true }).waitFor();
        await page.reload();
        await page.getByText(text('noSessions'), { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: resolve(this.Assets, language === 'en' ? 'popup-preview.png' : 'popup-preview.zh-CN.png'), fullPage: true });
      }
      assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs['zh-CN']).sort());
      await page.locator('#language').selectOption('auto');
      await page.getByText(catalogs.en.noSessions.message, { exact: true }).waitFor();
      await page.evaluate(() => localStorage.setItem('language', 'invalid'));
      await page.reload();
      await page.getByText(catalogs.en.noSessions.message, { exact: true }).waitFor();
      assert.equal(await page.locator('#language').inputValue(), 'auto');
      await page.evaluate(() => localStorage.setItem('systemLanguage', 'zh-TW'));
      await page.reload();
      await page.getByText(catalogs['zh-CN'].noSessions.message, { exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
      assert.deepEqual(errors, []);
      const report = { at: new Date().toISOString(), fixture: 'mock extension runtime; no Native Host or Broker', languages: ['en', 'zh-CN'], states: ['empty', 'auto-approval', 'pending', 'sessions', 'tab chooser', 'no tabs', 'error'], persistence: 'reload passed', systemLanguage: 'en-US and zh-TW passed', invalidPreference: 'falls back to browser', localeKeys: Object.keys(catalogs.en).length, logo: '128px loaded', overflow: false, keyboardFocus: 'passed', pageErrors: errors };
      await writeFile(resolve(this.Assets, 'preview-verification.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
    } finally {
      await browser.close();
    }
  }
}

Preview.run().catch(error => { console.error(error); process.exitCode = 1; });
