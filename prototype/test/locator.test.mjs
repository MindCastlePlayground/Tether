import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { Finder, Rewrite, Snapshot } from '../dist/locator.js';
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
  assert.match(s.tree, /button "💾Save changes" \[ref=e\d+\]/);
  assert.doesNotMatch(s.tree, /- generic \[ref=e\d+\]:?$/m);
  assert.ok(s.refs > 5);
  assert.equal(s.sideEffect, 'none');
  const scoped = await Finder.snapshot(page, { scope: 'form', maxChars: 60 });
  assert.equal(scoped.truncated, true);
  assert.equal((await Finder.snapshot(page, { scope: '#nope' })).error, 'scope_not_found');
});

test('ref from snapshot clicks a button whose text is nested several levels deep', async () => {
  const s = await Finder.snapshot(page, {});
  const ref = s.tree.match(/button "💾Save changes" \[ref=(e\d+)\]/)[1];
  const r = await click({ ref });
  assert.equal(r.how, 'ref');
  assert.equal(await page.title(), 'saved');
});

test('describing the target or calling locate does not invalidate refs the agent holds', async () => {
  const s = await Finder.snapshot(page, {});
  const ref = s.tree.match(/button "💾Save changes" \[ref=(e\d+)\]/)[1];
  await Finder.locate(page, { role: 'button', name: 'Delete' });
  const r = await run({ ref }, 'click');
  assert.equal(r.how, 'ref');
  const target = await Finder.target(page, r.loc);
  assert.equal(target.role, 'button');
  await r.loc.click({ timeout: 2000 });
  assert.equal(await page.title(), 'saved');
});

test('stale ref falls back to its role and name after a re-render, else refuses', async () => {
  const s = await Finder.snapshot(page, {});
  const ref = s.tree.match(/button "Custom Go" \[ref=(e\d+)\]/)[1];
  await page.setContent(HTML);
  const r = await click({ ref });
  assert.equal(r.how, 'ref-role-name');
  assert.equal(await page.title(), 'custom');
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

test('emoji-prefixed name still resolves to the button through text fallbacks', async () => {
  const r = await click({ selector: '//button[text()="Save changes"]' });
  assert.match(r.how, /^(role-name|text)/);
  assert.equal(await r.loc.evaluate(e => e.id), 'save');
  assert.equal(await page.title(), 'saved');
});

test('text match on an inner span is retargeted to the button', async () => {
  const r = await click({ selector: 'text=Save changes' });
  assert.match(r.how, /actionable-ancestor$/);
  assert.equal(await r.loc.evaluate(e => e.id), 'save');
  assert.equal(await page.title(), 'saved');
});

test('bare text and jQuery :contains are accepted', async () => {
  assert.match((await click({ selector: 'Custom Go' })).how, /^text/);
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
  let r = await run({ selector: 'Email' }, 'fill'); await r.loc.fill('a@b.c');
  assert.equal(await page.inputValue('input[name=email]'), 'a@b.c');
  r = await run({ selector: 'Your nickname' }, 'fill');
  assert.equal(r.how, 'placeholder');
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
