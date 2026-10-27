import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { Finder, Rewrite, Snapshot } from '../dist/locator.js';
import { Engine } from '../dist/engine.js';
import { Broker } from '../dist/broker.js';

const HTML = `<main><h1>Settings</h1>
<form onsubmit="return false">
  <label>Email <input name="email"></label>
  <div class="field"><span>Nickname</span><input placeholder="Your nickname"></div>
  <button type="button" id="save" onclick="document.title='saved'"><div><span><i>💾</i><span>Save changes</span></span></div></button>
  <div role="button" tabindex="0" onclick="document.title='custom'"><span>Custom <b>Go</b></span></div>
  <button type="button" onclick="document.title='plain'">Save</button>
  <button type="button" style="display:none" onclick="document.title='hidden'">Hidden</button>
  <button type="button" onclick="document.title='delete-1'"><span>Delete</span></button>
  <button type="button" onclick="document.title='delete-2'"><span>Delete</span></button>
</form></main>`;

let browser, page;
const run = (p, m) => Finder.resolve(page, p, m);
const click = async (p) => { const r = await run(p, 'click'); if (!('fail' in r)) await r.loc.click(); return r; };

test.before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage(); });
test.after(async () => { await browser?.close(); });
test.beforeEach(async () => { await page.setContent(HTML); await page.evaluate(() => { document.title = ''; }); });

test('snapshot is a compact tree with refs and no anonymous wrappers', async () => {
  const s = await Finder.snapshot(page, {});
  assert.match(s.tree, /button "💾Save changes" \[ref=[a-z0-9]+\]/);
  assert.doesNotMatch(s.tree, /- generic \[ref=[a-z0-9]+\]:?$/m);
  assert.ok(s.refs > 5);
  assert.equal(s.sideEffect, 'none');
  const scoped = await Finder.snapshot(page, { scope: 'form', maxChars: 60 });
  assert.equal(scoped.truncated, true);
  assert.equal((await Finder.snapshot(page, { scope: '#nope' })).error, 'scope_not_found');
});

test('ref from snapshot clicks a button whose text is nested several levels deep', async () => {
  const s = await Finder.snapshot(page, {});
  const ref = s.tree.match(/button "💾Save changes" \[ref=([a-z0-9]+)\]/)[1];
  const r = await click({ ref });
  assert.equal(r.how, 'ref');
  assert.equal(await page.title(), 'saved');
});

test('describing the target or calling locate does not invalidate refs the agent holds', async () => {
  const s = await Finder.snapshot(page, {});
  const ref = s.tree.match(/button "💾Save changes" \[ref=([a-z0-9]+)\]/)[1];
  await Finder.locate(page, { role: 'button', name: 'Delete' });
  const r = await run({ ref }, 'click');
  assert.equal(r.how, 'ref');
  const target = await Finder.target(page, r.loc);
  assert.equal(target.role, 'button');
  await r.loc.click({ timeout: 2000 });
  assert.equal(await page.title(), 'saved');
});

test('stale ref refuses after a re-render, even with identical role and name', async () => {
  const s = await Finder.snapshot(page, {});
  const ref = s.tree.match(/button "Custom Go" \[ref=([a-z0-9]+)\]/)[1];
  await page.setContent(HTML);
  const r = await click({ ref });
  assert.equal(r.fail.error, 'ref_stale');
  assert.equal(await page.title(), '');
  const gone = await run({ ref: 'e999' }, 'click');
  assert.equal(gone.fail.error, 'ref_stale');
});

test('XPath text() on nested text is rewritten instead of failing', async () => {
  const r = await click({ selector: '//button[text()="Delete"]' });
  assert.equal(r.fail.error, 'selector_ambiguous');
  assert.equal(r.fail.candidates.length, 2);
  assert.equal(await page.title(), '');
  const ok = await click({ selector: '//div[@role="button"][contains(text(),"Custom")]' });
  assert.equal(ok.how.startsWith('xpath-normalize-space'), true);
  assert.match(ok.hint, /direct children/);
  assert.equal(await page.title(), 'custom');
});

test('exact XPath text does not silently become fuzzy name matching', async () => {
  const r = await click({ selector: '//button[text()="Save changes"]' });
  assert.equal(r.fail.error, 'selector_not_found');
  assert.equal(await page.title(), '');
});

test('text match on an inner span is retargeted to the button', async () => {
  const r = await click({ selector: 'text=Save changes' });
  assert.match(r.how, /actionable-ancestor$/);
  assert.equal(await r.loc.evaluate(e => e.id), 'save');
  assert.equal(await page.title(), 'saved');
});

test('explicit text and jQuery :contains are accepted', async () => {
  assert.match((await click({ selector: 'text=Custom Go' })).how, /^selector/);
  assert.equal(await page.title(), 'custom');
  assert.equal((await click({ selector: 'button:contains("Save changes")' })).how, 'jquery-contains');
  assert.equal(await page.title(), 'saved');
});

test('ambiguity and absence refuse without acting and offer unique selectors', async () => {
  const r = await run({ selector: 'button' }, 'click');
  assert.equal(r.fail.error, 'selector_ambiguous');
  for (const c of r.fail.candidates) assert.equal(await page.locator(c.selector).count(), 1, c.selector);
  const miss = await run({ selector: '#missing-node' }, 'click');
  assert.equal(miss.fail.error, 'selector_not_found');
  assert.equal(miss.fail.sideEffect, 'none');
  assert.equal((await run({ selector: '//*[' }, 'click')).fail.error, 'selector_invalid');
  assert.equal(await page.title(), '');
});

test('hidden duplicates are ignored when exactly one match is visible', async () => {
  await page.setContent('<button style="display:none">Go</button><button onclick="document.title=\'go\'">Go</button>');
  const r = await click({ selector: 'button' });
  assert.equal(r.how, 'selector+visible');
  assert.equal(await page.title(), 'go');
});

test('fill finds fields by label, placeholder or wrapper', async () => {
  let r = await run({ selector: 'internal:label="Email"s' }, 'fill'); await r.loc.fill('a@b.c');
  assert.equal(await page.inputValue('input[name=email]'), 'a@b.c');
  r = await run({ selector: 'input[placeholder="Your nickname"]' }, 'fill');
  assert.equal(r.how, 'selector');
  r = await run({ selector: '.field' }, 'fill');
  assert.equal(r.how, 'selector+inner-field');
  assert.equal((await run({ selector: 'h1' }, 'fill')).fail.error, 'not_fillable');
});

test('locate returns verified selectors and the actionable ancestor', async () => {
  const r = await Finder.locate(page, { text: 'Save changes' });
  assert.equal(r.count, 1);
  const [c] = r.candidates;
  assert.equal(c.actionable.role, 'button');
  assert.equal(await page.locator(c.actionable.selector).count(), 1);
  const byRole = await Finder.locate(page, { role: 'button', name: 'Delete' });
  assert.equal(byRole.count, 2);
  assert.notEqual(byRole.candidates[0].selector, byRole.candidates[1].selector);
  assert.equal((await Finder.locate(page, {})).error, 'locate_query_empty');
});

test('rewrite and snapshot helpers', () => {
  assert.deepEqual(Rewrite.texts('//button[text()="Save"]'), ['Save']);
  assert.deepEqual(Rewrite.texts('Log in'), ['Log in']);
  assert.equal(Rewrite.role('//a[contains(text(),"x")]'), 'link');
  assert.equal(Snapshot.compact('- generic [ref=e1]:\n  - button "A" [ref=e2]\n- generic [ref=e3]'), '- button "A" [ref=e2]');
});

test('broker validates selector/ref parameters', () => {
  const ok = p => { try { Broker.validate(p.m, p); return true; } catch { return false; } };
  assert.equal(ok({ m: 'click', selector: 'a' }), true);
  assert.equal(ok({ m: 'click', ref: 'e3' }), true);
  assert.equal(ok({ m: 'click', ref: 'e3', selector: 'a' }), false);
  assert.equal(ok({ m: 'click' }), false);
  assert.equal(ok({ m: 'click', ref: 'E 1' }), false);
  assert.equal(ok({ m: 'fill', ref: 'e3' }), false);
  assert.equal(ok({ m: 'locate' }), false);
  assert.equal(ok({ m: 'locate', role: 'button', name: 'x' }), true);
  assert.equal(ok({ m: 'snapshot', depth: 0 }), false);
  assert.equal(ok({ m: 'snapshot' }), true);
});

test('failed scoped selectors and tag selectors never broaden to page text', async () => {
  await page.setContent('<section class="modal"><button>Cancel</button></section><button>OK</button><div role="button">button</div>');
  for (const selector of ['.modal button:has-text("OK")', '//section[@class="modal"]//button[text()="OK"]', 'a']) {
    const r = await run({ selector }, 'click');
    assert.equal(r.fail.error, 'selector_not_found', selector);
  }
  assert.equal(Rewrite.contains('[title=":contains("]'), undefined);
  assert.equal(Rewrite.all('//button[text()="OK"] | //a', 'click').length, 1);
});

test('visibility checks include matches after the first twenty', async () => {
  await page.setContent('<button>Go</button>' + '<button hidden>Go</button>'.repeat(25) + '<button>Go</button>');
  assert.equal((await run({ selector: 'button' }, 'click')).fail.error, 'selector_ambiguous');
  await page.locator('button').first().evaluate(el => el.hidden = true);
  const r = await run({ selector: 'button' }, 'click');
  assert.equal(r.how, 'selector+visible');
  assert.equal(await r.loc.evaluate(el => el === document.querySelector('button:last-child')), true);
});

test('identity refs survive names, scoped snapshots and same-document navigation', async () => {
  const first = await Finder.locate(page, { selector: '#save' });
  const ref = first.candidates[0].ref;
  await page.locator('#save').evaluate(el => { el.textContent = 'Renamed'; history.replaceState({}, '', '#changed'); });
  await Finder.snapshot(page, { scope: 'h1' });
  const again = await Finder.locate(page, { selector: '#save' });
  assert.equal(again.candidates[0].ref, ref);
  assert.equal((await run({ ref }, 'click')).how, 'ref');
  await page.goto('data:text/html,<button id="save">Renamed</button>');
  assert.equal((await run({ ref }, 'click')).fail.error, 'ref_stale');
});

test('outline refs expand regions, scope isolates identical controls, counts are emitted only', async () => {
  await page.setContent('<main><section aria-label="Orders"><h2>Orders</h2><ul><li>Order A<button>Delete</button></li></ul></section><section aria-label="Account"><button>Delete</button></section></main>');
  const outline = await Finder.snapshot(page, { outline: true });
  assert.doesNotMatch(outline.tree, /button "Delete"/);
  const ref = outline.tree.match(/region "Orders" \[ref=([a-z0-9]+)\]/)[1];
  const scope = await Finder.snapshot(page, { scopeRef: ref });
  assert.match(scope.tree, /Order A/); assert.doesNotMatch(scope.tree, /Account/);
  const found = await Finder.locate(page, { scopeRef: ref, role: 'button', name: 'Delete' });
  assert.equal(found.count, 1); assert.match(found.candidates[0].context.text, /Order A/);
  assert.equal(found.candidates[0].selectorUnique, true);
  assert.equal((await Finder.snapshot(page, { scope: 'section' })).error, 'scope_ambiguous');
  assert.equal((await Finder.snapshot(page, { scope: 'main', scopeRef: ref })).error, 'scope_conflict');
  const tiny = await Finder.snapshot(page, { maxChars: 1 });
  assert.equal(tiny.tree, ''); assert.equal(tiny.refs, 0); assert.equal(tiny.truncated, true);
  const short = await Finder.snapshot(page, { maxChars: 180 });
  assert.equal(short.refs, [...short.tree.matchAll(/\[ref=/g)].length);
  assert.ok(short.tree.length <= 180);
});

test('candidate count reports omissions and candidate refs target exact identities', async () => {
  await page.setContent('<ul>' + Array.from({ length: 23 }, (_, i) => `<li>Order ${i}<button>Delete</button></li>`).join('') + '</ul>');
  const r = await Finder.locate(page, { role: 'button', name: 'Delete' });
  assert.equal(r.count, 23); assert.equal(r.shown, 10); assert.equal(r.truncated, true);
  const ref = r.candidates[8].ref;
  await page.locator('li').first().evaluate(el => el.remove());
  const selected = await run({ ref }, 'click');
  assert.match(await selected.loc.evaluate(el => el.parentElement.textContent), /Order 8/);
});

test('action observations are opt-in, bounded, redacted and separate from execution', async () => {
  const engine = new Engine(async () => {}); engine.page = async () => page;
  const none = await engine.run('click', { selector: '#save' });
  assert.equal(none.sideEffect, 'applied'); assert.equal('observed' in none, false);
  const secret = 'private-value-482';
  const filled = await engine.run('fill', { selector: 'input[name=email]', value: secret, observe: { scope: 'form', maxChars: 1000 } });
  assert.equal(filled.sideEffect, 'applied'); assert.equal(filled.observed, true);
  assert.equal(filled.after.navigated, false); assert.doesNotMatch(JSON.stringify(filled), /private-value-482/);
  assert.equal(await page.inputValue('input[name=email]'), secret);
  const missing = await engine.run('click', { selector: '#save', observe: { scope: '#missing' } });
  assert.equal(missing.sideEffect, 'applied'); assert.equal(missing.observed, false); assert.equal(missing.observationError, 'scope_not_found');
  assert.equal(await page.title(), 'saved');
});

test('navigation observation refuses an old scopeRef without expanding to the new page', async () => {
  const engine = new Engine(async () => {}); engine.page = async () => page;
  const scope = (await Finder.locate(page, { selector: 'form' })).candidates[0].ref;
  await page.locator('#save').evaluate(el => el.setAttribute('onclick', "document.open();document.write('<h1>new document content</h1>');document.close()"));
  const r = await engine.run('click', { selector: '#save', observe: { scopeRef: scope } });
  assert.equal(r.sideEffect, 'applied'); assert.equal(r.observed, false); assert.equal(r.observationError, 'ref_stale');
  assert.equal(r.after, undefined);
});

test('observation success cannot turn an uncertain action into success', async () => {
  const engine = new Engine(async () => {}); engine.page = async () => page;
  await page.locator('#save').evaluate(el => el.disabled = true);
  page.setDefaultTimeout(200);
  try {
    const r = await engine.run('click', { selector: '#save', observe: {} });
    assert.equal(r.sideEffect, 'possible'); assert.equal(r.error, 'outcome_unknown'); assert.equal(r.observed, true);
  } finally { page.setDefaultTimeout(30000); }
});

test('broker rejects invalid and conflicting nested observation parameters', () => {
  for (const observe of [true, [], { maxChars: 0 }, { scope: 'a', scopeRef: 'tabc' }, { extra: true }]) {
    assert.throws(() => Broker.validate('click', { selector: 'button', observe }));
  }
  assert.doesNotThrow(() => Broker.validate('click', { ref: 't' + 'a'.repeat(32) + 'e12', observe: { maxChars: 20 } }));
});

test('incomplete uniqueness verification refuses before any action', async () => {
  const visible = Finder.visible;
  Finder.visible = async () => undefined;
  try {
    const r = await click({ selector: 'button' });
    assert.equal(r.fail.error, 'uniqueness_unverified'); assert.equal(r.fail.sideEffect, 'none');
    assert.equal(await page.title(), '');
  } finally { Finder.visible = visible; }
});

test('observation timeout does not repeat a write or change its outcome', async () => {
  const engine = new Engine(async () => {}); engine.page = async () => page;
  await page.locator('#save').evaluate(el => el.setAttribute('onclick', "document.title=String(+(document.title||0)+1)"));
  const snapshot = Finder.snapshot;
  Finder.snapshot = async () => new Promise(resolve => setTimeout(() => resolve({ url: '', title: '', tree: '', truncated: false }), 3200));
  try {
    const r = await engine.run('click', { selector: '#save', observe: {} });
    assert.equal(r.sideEffect, 'applied'); assert.equal(r.observed, false); assert.equal(r.observationError, 'observation_timeout');
    assert.equal(await page.title(), '1');
    await new Promise(resolve => setTimeout(resolve, 250));
  } finally { Finder.snapshot = snapshot; }
});

test('post-action observation honors read policy without undoing the action', async () => {
  const engine = new Engine(async () => {}, () => false); engine.page = async () => page;
  const r = await engine.run('click', { selector: '#save', observe: {} });
  assert.equal(r.sideEffect, 'applied'); assert.equal(r.observationError, 'observation_denied'); assert.equal(r.after, undefined);
});

test('filling an existing textarea value never echoes it through target metadata', async () => {
  const value = 'private-existing-value'.repeat(20);
  await page.setContent(`<section><textarea>${value}</textarea></section>`);
  const engine = new Engine(async () => {}); engine.page = async () => page;
  const r = await engine.run('fill', { selector: 'textarea', value });
  assert.equal(r.sideEffect, 'applied'); assert.equal(JSON.stringify(r).includes('private-existing-value'), false);
});
