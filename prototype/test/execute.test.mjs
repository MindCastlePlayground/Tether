import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { ExtensionController } from '../extension/controller.js';
import { Broker } from '../dist/broker.js';
import { Policy } from '../dist/policy.js';

test('execute uses a granted Chrome page, enforces policy and deduplicates scripts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tether-execute-'));
  const policyFile = join(dir, 'policy.json');
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.setHeader('content-security-policy', "default-src 'none'");
    res.end('<title>Execute fixture</title><label>Company <input></label><button>Save</button><output>Ready</output>');
  });
  let browser;
  const broker = new Broker({});
  broker.policy = new Policy(policyFile);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(url);
    await page.locator('button').evaluate(button => {
      button.addEventListener('click', () => {
        document.querySelector('output').textContent = document.querySelector('input').value;
        button.dataset.count = String(Number(button.dataset.count ?? 0) + 1);
      });
    });
    const cdp = await page.context().newCDPSession(page);
    const controller = new ExtensionController({
      debugger: { attach: async () => {}, detach: async () => {}, sendCommand: (_target, method, params) => cdp.send(method, params) },
      tabs: { get: async () => ({ id: 1, url: page.url(), title: await page.title(), groupId: -1 }) },
    }, Date.now, () => 'Chrome/157.0.0.0');
    controller.publishSessions = () => {};
    const grant = { clientId: 'test', sessionId: 's', pageId: 'p' };
    controller.sessions.set('s', { ...grant, expires: Date.now() + 60000, pages: new Set(['p']), owned: new Set() });
    controller.pages.set('p', { ...grant, tabId: 1, groupId: -1, owned: false, attached: false, url });
    broker.host = { readyState: 1 };
    broker.clients.set('test', {});
    broker.forward = (method, params) => controller.dispatch(method, params);
    controller.reply = message => broker.engine.event(message.params);
    const emit = cdp.emit.bind(cdp);
    cdp.emit = (method, ...args) => {
      if (typeof method === 'string') controller.event({ tabId: 1 }, method, args[0]);
      return emit(method, ...args);
    };

    let id = 0;
    const call = (seq, code, options = {}) => broker.handle('test', {
      jsonrpc: '2.0', id: ++id, method: 'execute',
      params: { sessionId: 's', pageId: 'p', seq, mode: 'playwright', code, ...options },
    });
    const allow = { id: 'scripts', client: 'test', origin: url, actions: ['execute'], effect: 'allow' };
    const deny = { id: 'no-fill', client: 'test', origin: url, actions: ['fill'], effect: 'deny' };
    const setRules = rules => writeFile(policyFile, JSON.stringify({ version: 1, default: 'allow', rules }));
    await setRules([{ ...allow, actions: ['*'] }]);
    await assert.rejects(call(1, 'return 1;'), /policy_denied/);
    await setRules([allow, deny]);
    const write = 'await page.getByLabel("Company").fill("North Dock");';
    assert.equal((await call(1, write)).error, 'policy_denied');
    await assert.rejects(call(2, 'return 1;', { pageId: 'other' }), /policy_denied/);
    await setRules([allow]);

    const script = write + 'await page.getByRole("button", {name:"Save"}).click(); await page.getByText("North Dock").waitFor(); return {company: await page.locator("output").innerText(), node: typeof process};';
    const first = await call(2, script);
    assert.deepEqual(first.value, { company: 'North Dock', node: 'undefined' });
    assert.deepEqual(await call(2, script), first);
    await assert.rejects(call(2, 'return 1;'), /request_conflict/);
    assert.equal(await page.locator('button').getAttribute('data-count'), '1');

    const js = await call(3, 'await Promise.resolve(); document.querySelector("output").textContent += "!"; return document.querySelector("output").textContent;', { mode: 'javascript' });
    assert.equal(js.value, 'North Dock!');
    assert.equal(await page.locator('output').textContent(), 'North Dock!');
    const unawaited = await call(4, 'page.getByRole("button").click();');
    assert.equal(unawaited.error, 'execute_unawaited_operation');
    assert.equal(await page.locator('button').getAttribute('data-count'), '1');
    assert.equal((await call(5, 'while(true) {}', { timeoutMs: 150 })).error, 'execute_timeout');
    assert.equal((await call(6, 'while(true) {}', { mode: 'javascript', timeoutMs: 200 })).error, 'execute_timeout');
    assert.equal((await call(7, 'return "x".repeat(30001)')).error, 'execute_result_too_large');
    assert.equal((await call(8, 'return await page.title();')).value, 'Execute fixture');
    assert.equal((await call(9, 'await page.goto("https://example.test");')).error, 'policy_denied');
    assert.equal(page.url(), url + '/');
    assert.equal((await call(10, 'while(true) {}')).error, 'execute_cpu_limit');
  } finally {
    broker.engine.drop();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
