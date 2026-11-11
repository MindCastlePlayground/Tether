import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Cli } from '../installer/cli.mjs';
import { Rollback } from '../prototype/scripts/rollback.mjs';

class Bench {
  static root(version = '1.2.3') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-rollback-'));
    fs.mkdirSync(path.join(root, '.local'), { recursive: true });
    fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, '.tether-install.json'), JSON.stringify({ version, ready: true }));
    fs.writeFileSync(path.join(root, '.local', 'broker.json'), 'secret');
    fs.writeFileSync(path.join(root, '.local', 'broker-state.json'), JSON.stringify({ mode: 'on', state: 'running', attempt: 2, retryAt: 9 }));
    fs.writeFileSync(path.join(root, 'extension', 'build.txt'), 'old-extension');
    fs.writeFileSync(path.join(root, 'dist', 'broker.js'), 'old-broker');
    fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), 'old-dep');
    return root;
  }
  static read(root, name) { return fs.readFileSync(path.join(root, name), 'utf8'); }
  static meta(root) { return JSON.parse(fs.readFileSync(path.join(root, '.rollback', 'meta.json'), 'utf8')); }
}

test('keep stores one runnable copy and the next keep replaces it', () => {
  const root = Bench.root();
  assert.equal(Rollback.keep(root, '1.2.3'), '1.2.3');
  assert.equal(Bench.meta(root).version, '1.2.3');
  assert.equal(Bench.read(root, '.rollback/tree/dist/broker.js'), 'old-broker');
  assert.equal(Bench.read(root, '.rollback/tree/node_modules/dep.js'), 'old-dep');
  assert.equal(fs.existsSync(path.join(root, '.rollback/tree/.local')), false);
  assert.equal(Bench.read(root, '.local/broker.json'), 'secret');
  assert.match(fs.readFileSync(path.join(root, 'rollback.cmd'), 'utf8'), /rollback\\rollback\.mjs/);
  assert.equal(fs.existsSync(path.join(root, '.rollback/rollback.mjs')), true);
  fs.writeFileSync(path.join(root, 'dist', 'broker.js'), 'new-broker');
  fs.writeFileSync(path.join(root, '.tether-install.json'), JSON.stringify({ version: '9.9.9', ready: true }));
  Rollback.keep(root, '9.9.9');
  assert.equal(Bench.meta(root).version, '9.9.9');
  assert.equal(Bench.read(root, '.rollback/tree/dist/broker.js'), 'new-broker');
  assert.equal(fs.existsSync(path.join(root, '.rollback-prev')), false);
  assert.equal(fs.existsSync(path.join(root, '.rollback-next')), false);
});

test('restore swaps back and forth without touching credentials', () => {
  const root = Bench.root();
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'build.txt'), 'stale');
  fs.writeFileSync(path.join(root, 'extension-location.json'), JSON.stringify({ path: outside }));
  Rollback.keep(root, '1.2.3');
  fs.writeFileSync(path.join(root, 'dist', 'broker.js'), 'new-broker');
  fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), 'new-dep');
  fs.writeFileSync(path.join(root, 'extension', 'build.txt'), 'new-extension');
  fs.writeFileSync(path.join(root, '.tether-install.json'), JSON.stringify({ version: '9.9.9', ready: true }));
  const back = Rollback.restore(root, 'zh-CN');
  assert.deepEqual(back, { version: '1.2.3', replaced: '9.9.9' });
  assert.equal(Bench.read(root, 'dist/broker.js'), 'old-broker');
  assert.equal(Bench.read(root, 'node_modules/dep.js'), 'old-dep');
  assert.equal(Bench.read(root, 'extension/build.txt'), 'old-extension');
  assert.equal(Bench.read(outside, 'build.txt'), 'old-extension');
  assert.equal(Bench.read(root, '.local/broker.json'), 'secret');
  assert.equal(Bench.meta(root).version, '9.9.9');
  assert.equal(JSON.parse(Bench.read(root, '.tether-install.json')).version, '1.2.3');
  assert.equal(JSON.parse(Bench.read(root, '.tether-install.json')).ready, true);
  assert.equal(JSON.parse(Bench.read(root, '.local/broker-state.json')).mode, 'on');
  assert.equal(JSON.parse(Bench.read(root, '.local/broker-state.json')).attempt, 0);
  assert.deepEqual(Rollback.restore(root, 'en'), { version: '9.9.9', replaced: '1.2.3' });
  assert.equal(Bench.read(root, 'dist/broker.js'), 'new-broker');
  assert.equal(Bench.read(outside, 'build.txt'), 'new-extension');
  assert.equal(Bench.read(root, '.local/broker.json'), 'secret');
});

test('a failed restore puts the runtime files back', () => {
  const root = Bench.root();
  Rollback.keep(root, '1.2.3');
  fs.writeFileSync(path.join(root, 'dist', 'broker.js'), 'new-broker');
  fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
  fs.writeFileSync(path.join(root, 'not-a-directory'), 'blocked');
  fs.writeFileSync(path.join(root, 'extension-location.json'), JSON.stringify({ path: path.join(root, 'not-a-directory') }));
  assert.throws(() => Rollback.restore(root, 'en'), /put back/);
  assert.equal(Bench.read(root, 'dist/broker.js'), 'new-broker');
  assert.equal(Bench.meta(root).version, '1.2.3');
  assert.equal(JSON.parse(Bench.read(root, '.local/broker-state.json')).mode, 'off');
});

test('rollback of an interrupted upgrade restores the saved mode', () => {
  const root = Bench.root();
  Rollback.keep(root, '1.2.3');
  fs.writeFileSync(path.join(root, 'dist', 'broker.js'), 'partial');
  const paused = JSON.stringify({ mode: 'auto', state: 'running', attempt: 1, retryAt: 4 });
  fs.writeFileSync(path.join(root, '.tether-install.json'), JSON.stringify({ version: '9.9.9', ready: false, upgrade: true, paused, running: true }));
  fs.writeFileSync(path.join(root, '.local', 'broker-state.json'), JSON.stringify({ mode: 'off', state: 'stopped', attempt: 0, retryAt: 0 }));
  assert.equal(Rollback.restore(root, 'en').version, '1.2.3');
  assert.equal(Bench.read(root, 'dist/broker.js'), 'old-broker');
  assert.equal(JSON.parse(Bench.read(root, '.local/broker-state.json')).mode, 'auto');
  assert.equal(JSON.parse(Bench.read(root, '.tether-install.json')).ready, true);
});

test('dry-run reports the saved version and does not swap', async () => {
  const root = Bench.root();
  Rollback.keep(root, '1.2.3');
  fs.writeFileSync(path.join(root, 'dist', 'broker.js'), 'new-broker');
  const lines = [];
  const log = console.log;
  console.log = text => lines.push(String(text));
  try { assert.equal(await Cli.main(['rollback', '--runtime', root, '--dry-run', '--language', 'en']), 0); }
  finally { console.log = log; }
  assert.match(lines.join('\n'), /1\.2\.3/);
  assert.equal(Bench.read(root, 'dist/broker.js'), 'new-broker');
  assert.throws(() => Cli.rollback(fs.mkdtempSync(path.join(os.tmpdir(), 'tether-none-')), { language: 'en' }), /No rollback version/);
});

test('the saved script swaps the runtime it was copied into', () => {
  const root = Bench.root();
  Rollback.keep(root, '1.2.3');
  fs.writeFileSync(path.join(root, 'dist', 'broker.js'), 'new-broker');
  fs.writeFileSync(path.join(root, '.tether-install.json'), JSON.stringify({ version: '9.9.9', ready: true }));
  const result = spawnSync(process.execPath, [path.join(root, '.rollback', 'rollback.mjs'), 'en'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Rolled back to 1\.2\.3/);
  assert.equal(Bench.read(root, 'dist/broker.js'), 'old-broker');
  assert.equal(Bench.read(root, '.local/broker.json'), 'secret');
});
