import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Broker } from '../dist/broker.js';
import { Effect } from '../dist/protocol.js';
import { Playwright } from '../dist/preset.js';

const steps = [
  { kind: 'navigate', url: 'https://example.test/login' },
  { kind: 'fill', selector: 'input[name=password]', value: 'p@ss"w' },
  { kind: 'click', role: 'button', name: 'Sign in' },
  { kind: 'check', condition: 'text', expect: 'Welcome', timeoutMs: 0 },
  { kind: 'click', selector: '#stop' },
  { kind: 'fill', selector: 'input[name=later]', value: 'nope' },
];

class Fixture {
  calls = [];
  broker = new Broker({});
  constructor() {
    this.broker.host = { readyState: 1 };
    this.broker.clients.set('agent#test', {});
    this.broker.policy = { check: () => Effect.Allow, summary: () => ({ default: Effect.Allow, rules: 0, valid: true }) };
    this.broker.forward = async (method, params) => {
      this.calls.push({ via: 'forward', method, url: params.url, seq: params.seq });
      if (method === 'listTabs') return { pages: [{ pageId: 'p', url: 'https://example.test/login' }] };
      if (method === 'navigate') return { sideEffect: 'applied', url: params.url };
      return {};
    };
    this.broker.engine.run = async (method, params) => {
      this.calls.push({ via: 'engine', method, selector: params.selector, ref: params.ref, value: params.value });
      if (method === 'locate') return { count: 1, candidates: [{ ref: 'e1' }] };
      if (method === 'snapshot') return { tree: 'Welcome home', url: 'https://example.test/home' };
      if (method === 'click' && params.selector === '#stop') return { sideEffect: 'none', error: 'selector_not_found' };
      return { sideEffect: 'applied', target: { selector: params.selector ?? '#signin' }, strategy: 'selector' };
    };
  }
  call(method, params) {
    return this.broker.handle('agent#test', { jsonrpc: '2.0', id: 1, method, params });
  }
}

test('preset export is runnable javascript and keeps plaintext values', () => {
  const text = Playwright.emit(steps.slice(0, 4));
  assert.match(text, /page\.goto\("https:\/\/example\.test\/login"\)/);
  assert.match(text, /input\[name=password\]"\)\.fill\("p@ss\\"w"\)/);
  assert.match(text, /getByRole\("button", \{ name: "Sign in", exact: true \}\)\.click\(\)/);
  assert.match(text, /includes\("Welcome"\)/);
  const dir = mkdtempSync(join(tmpdir(), 'tether-preset-'));
  const file = join(dir, 'preset.mjs');
  try {
    writeFileSync(file, text);
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('save, export, run and trace keep values and stop on a refused step', async () => {
  const f = new Fixture();
  await assert.rejects(f.call('preset', { op: 'save', steps: [{ kind: 'click', ref: 'e1' }] }), /invalid_params/);
  const saved = await f.call('preset', { op: 'save', id: 'login', title: 'Login', steps });
  assert.equal(saved.revision, 1);
  assert.equal(saved.steps[1].value, 'p@ss"w');
  const again = await f.call('preset', { op: 'save', id: 'login', steps: steps.slice(0, 4) });
  assert.equal(again.revision, 2);
  assert.equal((await f.call('preset', { op: 'list' })).presets[0].steps, 4);
  await assert.rejects(f.call('preset', { op: 'get', id: 'missing' }), /preset_not_found/);
  await assert.rejects(f.broker.handle('other#1', { jsonrpc: '2.0', id: 1, method: 'preset', params: { op: 'get', id: 'login' } }), /preset_not_found/);
  const exported = await f.call('preset', { op: 'export', id: 'login' });
  assert.equal(exported.filename, 'preset-login.mjs');
  assert.match(exported.text, /p@ss\\"w/);
  const run = await f.call('preset', { op: 'run', id: 'login', sessionId: 's', pageId: 'p', seq: 4 });
  assert.equal(run.stopped, false);
  assert.equal(run.nextSeq, 7);
  assert.equal(f.calls.filter(call => call.method === 'navigate').length, 1);
  assert.equal(f.calls.find(call => call.method === 'fill').value, 'p@ss"w');
  assert.equal(f.calls.find(call => call.method === 'locate').method, 'locate');
  assert.equal(f.calls.find(call => call.method === 'click').ref, 'e1');
  const trace = await f.call('trace', {});
  assert.equal(trace.entries.find(entry => entry.method === 'fill').value, 'p@ss"w');
  assert.equal(JSON.stringify(await f.call('records', { op: 'export' })).includes('p@ss'), false);
  const stopped = await f.call('preset', { op: 'save', id: 'login', steps });
  assert.equal(stopped.revision, 3);
  f.calls = [];
  const halted = await f.call('preset', { op: 'run', id: 'login', sessionId: 's', pageId: 'p', seq: 4 });
  assert.equal(halted.stopped, true);
  assert.equal(halted.nextSeq, 8);
  assert.equal(f.calls.filter(call => call.value === 'nope').length, 0);
  assert.equal(f.calls.filter(call => call.selector === '#stop').length, 1);
  assert.equal((await f.call('trace', { op: 'clear' })).cleared, true);
  assert.equal((await f.call('trace', {})).total, 0);
  assert.deepEqual(await f.call('preset', { op: 'delete', id: 'login' }), { id: 'login', deleted: true });
});
