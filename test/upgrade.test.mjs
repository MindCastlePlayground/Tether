import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Files } from '../installer/files.mjs';
import { Install, Mark, ServiceKey } from '../installer/constants.mjs';
import { Runtime } from '../installer/runtime.mjs';
import { Service } from '../installer/service.mjs';

class Bench {
  static runtime(state) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-upgrade-'));
    const runtime = path.join(root, 'runtime'), source = path.join(root, 'source');
    for (const base of [runtime, source]) {
      for (const name of Install.SOURCE) {
        const dest = path.join(base, name);
        if (path.extname(name)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, '{}'); }
        else { fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, 'mark.txt'), base); }
      }
    }
    fs.mkdirSync(path.join(runtime, '.local'), { recursive: true });
    fs.writeFileSync(path.join(runtime, Install.MARKER), JSON.stringify({ [Mark.VERSION]: '0.0.1', [Mark.READY]: true }));
    if (state !== undefined) fs.writeFileSync(Bench.state(runtime), JSON.stringify(state));
    return { runtime, source };
  }
  static state(runtime) { return path.join(runtime, ServiceKey.STATE); }
  static mode(runtime) { return fs.existsSync(Bench.state(runtime)) ? Files.json(Bench.state(runtime)).mode : 'default'; }
  // Replace process-touching steps; `during` observes the runtime while dependencies install.
  static async with(during, fn, { broker = true, mcp = 1 } = {}) {
    const saved = { npm: Runtime.npm, run: Runtime.run, halt: Service.halt, resume: Service.resume, scan: Service.scan, nap: Runtime.nap };
    const calls = [];
    Runtime.npm = (args, cwd) => { calls.push('npm'); during(cwd); };
    Runtime.run = () => calls.push('run');
    Runtime.nap = () => calls.push('nap');
    Service.halt = () => { calls.push('halt'); return broker && calls.filter(c => c === 'halt').length === 1; };
    Service.resume = () => { calls.push('resume'); return ServiceKey.RUNNING; };
    Service.scan = () => ({ broker: broker ? 1 : 0, host: 0, mcp });
    const log = console.log, lines = [];
    console.log = text => lines.push(String(text));
    try { return await fn(calls, lines); }
    finally { Object.assign(Runtime, { npm: saved.npm, run: saved.run, nap: saved.nap }); Object.assign(Service, { halt: saved.halt, resume: saved.resume, scan: saved.scan }); console.log = log; }
  }
}

test('pause turns auto-start off and restore brings back the previous mode', () => {
  const { runtime } = Bench.runtime();
  assert.equal(Service.pause(runtime), null);
  assert.equal(Bench.mode(runtime), ServiceKey.OFF);
  assert.equal(Service.restore(runtime, null), true);
  assert.equal(fs.existsSync(Bench.state(runtime)), false);
  const on = JSON.stringify({ mode: 'on', state: 'blocked', attempt: 5, retryAt: 9 });
  assert.equal(Service.restore(runtime, on), true);
  assert.deepEqual(Files.json(Bench.state(runtime)), { mode: 'on', state: ServiceKey.STARTING, attempt: 0, retryAt: 0 });
  assert.equal(Service.restore(runtime, JSON.stringify({ mode: ServiceKey.OFF })), false);
  assert.equal(Bench.mode(runtime), ServiceKey.OFF);
  assert.equal(Service.restore(runtime, '{ corrupt'), true);
  assert.equal(fs.existsSync(Bench.state(runtime)), false);
});

test('upgrade keeps Broker auto-start off while building and restarts it afterwards', async () => {
  const { runtime, source } = Bench.runtime({ mode: 'auto', state: 'running', attempt: 0, retryAt: 0 });
  const seen = [];
  await Bench.with(cwd => seen.push(Bench.mode(cwd)), async (calls, lines) => {
    const result = Runtime.upgrade(runtime, source, { language: 'en' });
    assert.deepEqual(result, { running: true, state: ServiceKey.RUNNING, mcp: 1 });
    assert.deepEqual(seen, [ServiceKey.OFF, ServiceKey.OFF]);
    assert.equal(Bench.mode(runtime), 'auto');
    assert.deepEqual(Files.json(path.join(runtime, Install.MARKER)), { [Mark.VERSION]: Install.VERSION, [Mark.READY]: true });
    assert.ok(calls.indexOf('halt') < calls.indexOf('npm') && calls.lastIndexOf('halt') < calls.indexOf('resume'));
    assert.ok(lines.some(line => line.includes('auto-start is paused')));
    assert.ok(lines.some(line => line.includes('1 agent session')));
  });
});

test('a Broker the user turned off stays off after upgrade', async () => {
  const { runtime, source } = Bench.runtime({ mode: ServiceKey.OFF, state: 'stopped', attempt: 0, retryAt: 0 });
  await Bench.with(() => {}, async calls => {
    assert.equal(Runtime.upgrade(runtime, source, { language: 'en' }).state, undefined);
    assert.ok(!calls.includes('resume'));
    assert.equal(Bench.mode(runtime), ServiceKey.OFF);
  }, { broker: false, mcp: 0 });
});

test('an interrupted upgrade stays paused and a rerun restores the original mode', async () => {
  const { runtime, source } = Bench.runtime({ mode: 'on', state: 'running', attempt: 0, retryAt: 0 });
  const boom = () => { throw new Error('EBUSY: resource busy'); };
  await Bench.with(boom, async calls => {
    assert.throws(() => Runtime.upgrade(runtime, source, { language: 'en' }), /EBUSY[\s\S]*rerun the upgrade/);
    // npm failed twice: the retry stopped processes again and waited before trying once more.
    assert.deepEqual(calls.filter(c => c === 'npm' || c === 'nap'), ['npm', 'nap', 'npm']);
  });
  assert.equal(Bench.mode(runtime), ServiceKey.OFF);
  const meta = Files.json(path.join(runtime, Install.MARKER));
  assert.equal(meta[Mark.READY], false);
  assert.equal(meta[Mark.UPGRADE], true);
  assert.equal(meta[Mark.RUNNING], true);
  assert.equal(JSON.parse(meta[Mark.PAUSED]).mode, 'on');
  // The Broker is already stopped now; the marker still remembers it was running before.
  await Bench.with(() => {}, async calls => {
    const check = Runtime.check;
    Runtime.check = () => {};
    try { Runtime.prepare(runtime, source, { language: 'en' }); } finally { Runtime.check = check; }
    assert.ok(calls.includes('resume'));
    assert.equal(Bench.mode(runtime), 'on');
    assert.equal(Files.json(path.join(runtime, Install.MARKER))[Mark.READY], true);
  }, { broker: false, mcp: 0 });
});

test('a transient lock during dependency install is retried once', async () => {
  const { runtime, source } = Bench.runtime();
  let failures = 1;
  await Bench.with(() => { if (failures-- > 0) throw new Error('EPERM'); }, async calls => {
    Runtime.upgrade(runtime, source, { language: 'en' });
    assert.ok(calls.includes('nap'));
    assert.equal(Bench.mode(runtime), 'default');
  });
});
