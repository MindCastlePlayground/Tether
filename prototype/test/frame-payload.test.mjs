import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { Finder } from '../dist/locator.js';
import { Refs } from '../dist/refs.js';
import { Engine, TabTransport } from '../dist/engine.js';

test('frame controls and scoped snapshots keep document identity after replacement', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<iframe id="vendor" srcdoc="<label>Company <input id=company></label><button>Save</button>"></iframe>');
    const first = await Finder.resolve(page, { selector: 'frame=iframe#vendor >> #company' }, 'fill');
    assert.ok(first.loc);
    await first.loc.fill('North Dock');
    const target = await Finder.target(page, first.loc);
    assert.equal(await (await Refs.loc(page, target.ref)).inputValue(), 'North Dock');
    const snapshot = await Finder.snapshot(page, { scopeRef: target.ref });
    assert.ok(snapshot.refs > 0);
    const ref = snapshot.tree.match(/\[ref=([a-z0-9]+)\]/)[1];
    assert.equal(await (await Refs.loc(page, ref)).inputValue(), 'North Dock');
    await page.frameLocator('#vendor').locator('#company').evaluate(el => el.replaceWith(el.cloneNode()));
    assert.equal(await first.loc.count(), 0);
    const stale = await Finder.resolve(page, { ref: target.ref }, 'fill');
    assert.equal(stale.fail.error, 'ref_stale');
    const fresh = await Finder.resolve(page, { selector: 'frame=iframe#vendor >> #company' }, 'fill');
    await fresh.loc.fill('Updated Dock');
    assert.equal(await page.frameLocator('#vendor').locator('#company').inputValue(), 'Updated Dock');
  } finally { await browser.close(); }
});

test('oversized CDP response preserves the transport for a subsequent small response', async () => {
  const seen = [];
  let calls = 0;
  const transport = new TabTransport(async () => {
    if (++calls === 1) throw Error('payload_too_large');
    return { value: 'small' };
  }, {}, { targetId: 't' }, {});
  transport.onmessage = message => seen.push(message);
  transport.onclose = () => seen.push({ closed: true });
  transport.send({ id: 7, sessionId: 'bb-page', method: 'Runtime.evaluate', params: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(seen.at(-1).error.message, 'payload_too_large');
  transport.send({ id: 8, sessionId: 'bb-page', method: 'Runtime.evaluate', params: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seen.at(-1).result, { value: 'small' });
  assert.equal(seen.some(message => message.closed), false);
});

test('engine payload classification does not affect later unrelated errors', async () => {
  const engine = new Engine(async () => ({}));
  engine.execute = async () => { engine.calls.getStore().payload = true; throw Error('page.ariaSnapshot: Timeout exceeded'); };
  await assert.rejects(engine.run('snapshot', {}), /^Error: payload_too_large$/);
  engine.execute = async () => { throw Error('unrelated_failure'); };
  await assert.rejects(engine.run('snapshot', {}), /^Error: unrelated_failure$/);
});
