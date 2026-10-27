import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Update } from '../prototype/scripts/update.mjs';

class Bench {
  static root() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-update-test-'));
    fs.mkdirSync(path.join(root, '.local'), { recursive: true });
    fs.writeFileSync(path.join(root, Update.MARKER), JSON.stringify({ ready: true, version: '1.0.0' }));
    return root;
  }
  static with(run, fn) {
    const old = Update.run;
    Update.run = run;
    try { return fn(); } finally { Update.run = old; }
  }
  static tempDirs() { return fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('tether-update-')).sort(); }
}

test('update runs clone, revision, npm ci, upgrade and records fetched metadata', () => {
  const root = Bench.root(), calls = [];
  Bench.with((cmd, args, cwd) => {
    calls.push([path.basename(cmd), ...args]);
    if (args[0] === 'clone') {
      const source = args.at(-1);
      fs.mkdirSync(path.join(source, 'prototype'), { recursive: true });
      fs.writeFileSync(path.join(source, 'prototype/package.json'), JSON.stringify({ version: '2.0.0' }));
    }
    if (args[0] === 'rev-parse') return 'abc123';
    if (args.includes('upgrade')) fs.writeFileSync(path.join(root, Update.MARKER), JSON.stringify({ ready: true, version: '2.0.0' }));
  }, () => {
    const before = Bench.tempDirs();
    assert.equal(Update.apply(root, 'zh-CN'), 0);
    assert.deepEqual(calls.map(([, ...args]) => args[0] === 'clone' || args[0] === 'rev-parse' ? args[0] : args[1] === 'ci' ? 'ci' : args[1] === 'upgrade' ? 'upgrade' : 'unexpected'), ['clone', 'rev-parse', 'ci', 'upgrade']);
    assert.ok(calls[0].includes(Update.REPO) && calls[0].includes(Update.BRANCH));
    assert.ok(calls[2].includes('--no-audit') && calls[2].includes('--no-fund'));
    assert.ok(calls[3].includes('--language') && calls[3].includes('zh-CN'));
    const result = JSON.parse(fs.readFileSync(path.join(root, Update.RESULT), 'utf8'));
    assert.deepEqual({ version: result.version, revision: result.revision, source: result.source }, { version: '2.0.0', revision: 'abc123', source: Update.REPO });
    assert.ok(Number.isFinite(Date.parse(result.updatedAt)));
    assert.equal(fs.existsSync(path.join(root, Update.LOCK)), false);
    assert.deepEqual(Bench.tempDirs(), before);
  });
});

test('download failure skips upgrade and cleans temporary files and lock', () => {
  const root = Bench.root(), before = Bench.tempDirs(), calls = [];
  Bench.with((cmd, args) => { calls.push(args[0]); throw new Error('offline'); }, () => {
    assert.throws(() => Update.apply(root), /offline/);
    assert.deepEqual(calls, ['clone']);
    assert.equal(fs.existsSync(path.join(root, Update.LOCK)), false);
    assert.equal(fs.existsSync(path.join(root, Update.RESULT)), false);
    assert.deepEqual(Bench.tempDirs(), before);
  });
});

test('existing lock is preserved and blocks process execution', () => {
  const root = Bench.root(), lock = path.join(root, Update.LOCK);
  fs.mkdirSync(path.dirname(lock), { recursive: true }); fs.writeFileSync(lock, 'original-owner');
  let called = false;
  Bench.with(() => { called = true; }, () => {
    assert.throws(() => Update.apply(root), /Another update is running/);
    assert.equal(called, false);
    assert.equal(fs.readFileSync(lock, 'utf8'), 'original-owner');
  });
});

test('dry run and missing installation have no side effects', () => {
  const root = Bench.root(), before = fs.readdirSync(root).sort(); let called = false;
  Bench.with(() => { called = true; }, () => {
    assert.equal(Update.apply(root, 'en', true), 0);
    assert.deepEqual(fs.readdirSync(root).sort(), before);
    assert.equal(called, false);
    const absent = path.join(root, 'absent'); fs.mkdirSync(absent);
    assert.throws(() => Update.apply(absent), /Managed installation not found/);
    assert.deepEqual(fs.readdirSync(absent), []);
  });
});

test('version or readiness mismatch does not record success', () => {
  const root = Bench.root();
  Bench.with((cmd, args) => {
    if (args[0] === 'clone') {
      const source = args.at(-1); fs.mkdirSync(path.join(source, 'prototype'), { recursive: true });
      fs.writeFileSync(path.join(source, 'prototype/package.json'), JSON.stringify({ version: '2.0.0' }));
    }
    if (args[0] === 'rev-parse') return 'abc123';
    if (args.includes('upgrade')) fs.writeFileSync(path.join(root, Update.MARKER), JSON.stringify({ ready: false, version: '1.9.0' }));
  }, () => {
    assert.throws(() => Update.apply(root), /version or ready state/);
    assert.equal(fs.existsSync(path.join(root, Update.RESULT)), false);
    assert.equal(fs.existsSync(path.join(root, Update.LOCK)), false);
  });
});
