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
  static Files = new Set(['popup.html', 'popup.js', 'protocol.js', 'icons/icon-128.png']);
  static Types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };

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
        window.chrome = { runtime: { connect: () => new MockPort() } };
      }, events);
      await page.goto(`${this.Origin}/popup.html`);
      await page.getByText('No active sessions.', { exact: true }).waitFor();
      assert.equal(await page.title(), 'Tether — Browser access');
      assert.equal(await page.locator('header img').evaluate(img => img.complete && img.naturalWidth === 128), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await mkdir(this.Assets, { recursive: true });
      await page.screenshot({ path: resolve(this.Assets, 'popup-preview.png'), fullPage: true });
      await page.getByRole('checkbox').uncheck();
      await page.getByText('Off: requests wait for your approval, and clients cannot enumerate tabs.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.approval), false);
      await page.keyboard.press('Tab');
      await page.getByRole('checkbox').focus();
      assert.equal(await page.getByRole('checkbox').evaluate(el => el.matches(':focus-visible')), true);
      assert.deepEqual(errors, []);
      const report = { at: new Date().toISOString(), fixture: 'mock extension runtime; no Native Host or Broker', title: 'Tether', logo: '128px loaded', overflow: false, toggle: 'passed', keyboardFocus: 'passed', pageErrors: errors };
      await writeFile(resolve(this.Assets, 'preview-verification.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
    } finally {
      await browser.close();
    }
  }
}

Preview.run().catch(error => { console.error(error); process.exitCode = 1; });
