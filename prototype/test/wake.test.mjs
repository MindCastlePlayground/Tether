import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BrowserWake } from '../dist/wake.js';
import { Wake } from '../dist/protocol.js';

class Fake {
  constructor(states) { this.states = states; this.calls = 0; }
  async capabilities() {
    const s = this.states[Math.min(this.calls++, this.states.length - 1)];
    if (s instanceof Error) throw s;
    return { browserConnected: s };
  }
}

test('connected browser needs no wake', async () => {
  const launches = [];
  const w = new BrowserWake(new Fake([true]), {}, async (exe, args) => launches.push([exe, args]), async () => {}, 600);
  await w.ready();
  await w.ready();
  assert.equal(launches.length, 0);
});

test('missing browser is started in the background and awaited', async () => {
  const dir = mkdtempSync(resolve('work/wake-'));
  const exe = join(dir, ...Wake.Paths.chrome);
  mkdirSync(join(exe, '..'), { recursive: true }); writeFileSync(exe, '');
  try {
    const launches = [];
    const w = new BrowserWake(new Fake([false, false, true]), { LOCALAPPDATA: dir }, async (file, args) => launches.push([file, args]), async () => {}, 5000);
    await w.ready();
    assert.deepEqual(launches, [[exe, [Wake.Arg]]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no extension reports browser_not_connected and then fails fast', async () => {
  const launches = [];
  const w = new BrowserWake(new Fake([false]), {}, async () => launches.push(1), async () => {}, 600);
  await assert.rejects(w.ready(), new RegExp(Wake.Missing));
  const t0 = Date.now();
  await assert.rejects(w.ready(), new RegExp(Wake.Missing));
  assert.ok(Date.now() - t0 < 300);
});

test('unreachable Broker is started before probing again', async () => {
  let started = 0;
  const w = new BrowserWake(new Fake([new Error('connectionFailed'), true]), {}, async () => {}, async () => { started++; }, 600);
  await w.ready();
  assert.equal(started, 1);
});

test('BB_BROWSER_WAKE=0 never launches a browser and Edge can be preferred', async () => {
  const launches = [];
  const w = new BrowserWake(new Fake([false]), { [Wake.Flag]: Wake.Off, LOCALAPPDATA: 'C:\\nowhere' }, async () => launches.push(1), async () => {}, 600);
  await assert.rejects(w.ready(), new RegExp(Wake.Missing));
  assert.equal(launches.length, 0);
  const dir = mkdtempSync(resolve('work/wake-'));
  try {
    for (const name of [Wake.Chrome, Wake.Edge]) { const f = join(dir, ...Wake.Paths[name]); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, ''); }
    assert.equal(BrowserWake.exe({ LOCALAPPDATA: dir }), join(dir, ...Wake.Paths.chrome));
    assert.equal(BrowserWake.exe({ LOCALAPPDATA: dir, [Wake.Browser]: Wake.Edge }), join(dir, ...Wake.Paths.edge));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
