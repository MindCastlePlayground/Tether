import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Cli } from '../installer/cli.mjs';
import { Cmd, Policy } from '../installer/constants.mjs';

class Fixture {
  static runtime() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-policy-'));
    fs.mkdirSync(path.join(root, '.local'), { recursive: true });
    return root;
  }
  static file(runtime) { return path.join(runtime, '.local', Policy.FILE); }
  static read(runtime) { return JSON.parse(fs.readFileSync(Fixture.file(runtime), 'utf8')); }
  static async run(args) {
    const log = console.log;
    const lines = [];
    console.log = (...items) => lines.push(items.join(' '));
    try { return { code: await Cli.main(args), out: lines.join('\n') }; }
    finally { console.log = log; }
  }
}

test('policy list prints the built-in default when unconfigured', async () => {
  const runtime = Fixture.runtime();
  const { code, out } = await Fixture.run(['policy', 'list', '--runtime', runtime, '--language', 'zh-CN']);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out.split('未配置')[0]), Policy.FALLBACK);
  assert.match(out, /未配置，默认全放行/);
  assert.ok(!fs.existsSync(Fixture.file(runtime)));
});

test('policy add, default, remove, and reset round-trip', async () => {
  const runtime = Fixture.runtime();
  const base = ['--runtime', runtime, '--language', 'en'];
  assert.equal((await Fixture.run(['policy', 'add', '--effect', 'deny', '--actions', 'fill,click', '--origin', 'https://*.bank.com', '--client', 'codex', '--id', 'no-bank', ...base])).code, 0);
  assert.deepEqual(Fixture.read(runtime).rules, [{ id: 'no-bank', client: 'codex', origin: 'https://*.bank.com', actions: ['fill', 'click'], effect: 'deny' }]);
  const listed = await Fixture.run(['policy', 'list', ...base]);
  assert.deepEqual(JSON.parse(listed.out), Fixture.read(runtime));
  assert.equal((await Fixture.run(['policy', 'default', 'deny', ...base])).code, 0);
  assert.equal(Fixture.read(runtime).default, 'deny');
  assert.equal((await Fixture.run(['policy', 'remove', '--id', 'no-bank', ...base])).code, 0);
  assert.deepEqual(Fixture.read(runtime).rules, []);
  assert.equal((await Fixture.run(['policy', 'reset', ...base])).code, 0);
  assert.ok(!fs.existsSync(Fixture.file(runtime)));
});

test('policy add defaults wildcard fields, prepends on --first, and auto ids increment', async () => {
  const runtime = Fixture.runtime();
  const base = ['policy', 'add', '--runtime', runtime, '--language', 'en'];
  assert.equal((await Fixture.run([...base, '--effect', 'allow', '--actions', 'observe'])).code, 0);
  assert.deepEqual(Fixture.read(runtime).rules[0], { id: 'r1', client: '*', origin: '*', actions: ['observe'], effect: 'allow' });
  assert.equal((await Fixture.run([...base, '--effect', 'allow', '--actions', 'click'])).code, 0);
  assert.deepEqual(Fixture.read(runtime).rules.map(rule => rule.id), ['r1', 'r2']);
  assert.equal((await Fixture.run([...base, '--effect', 'deny', '--actions', 'navigate', '--first'])).code, 0);
  assert.deepEqual(Fixture.read(runtime).rules.map(rule => rule.id), ['r3', 'r1', 'r2']);
});

test('policy add rejects invalid effects, ask pairing, actions, and origins without writing', async () => {
  const runtime = Fixture.runtime();
  const base = ['policy', 'add', '--runtime', runtime, '--language', 'en'];
  await assert.rejects(Fixture.run([...base, '--effect', 'maybe', '--actions', 'fill']), /Invalid effect/);
  await assert.rejects(Fixture.run([...base, '--effect', 'ask', '--actions', 'fill']), /ask/);
  await assert.rejects(Fixture.run([...base, '--effect', 'ask', '--actions', '*']), /ask/);
  await assert.rejects(Fixture.run([...base, '--effect', 'allow', '--actions', 'teleport']), /Unknown action/);
  await assert.rejects(Fixture.run([...base, '--effect', 'deny', '--actions', 'fill', '--origin', 'bank.com']), /Invalid origin/);
  await assert.rejects(Fixture.run([...base, '--effect', 'deny', '--actions', 'fill', '--origin', 'https://a.com/path']), /Invalid origin/);
  await assert.rejects(Fixture.run([...base, '--effect', 'deny', '--actions', 'fill', '--origin', 'https://a.com:99999']), /Invalid origin/);
  assert.ok(!fs.existsSync(Fixture.file(runtime)));
  assert.equal((await Fixture.run([...base, '--effect', 'ask', '--actions', 'session', '--origin', 'https://*.bank.com'])).code, 0);
  assert.equal(Fixture.read(runtime).rules[0].effect, 'ask');
});

test('policy add enforces explicit and generated id uniqueness', async () => {
  const runtime = Fixture.runtime();
  const base = ['policy', 'add', '--runtime', runtime, '--language', 'en'];
  assert.equal((await Fixture.run([...base, '--effect', 'allow', '--actions', 'observe', '--id', 'dup'])).code, 0);
  await assert.rejects(Fixture.run([...base, '--effect', 'allow', '--actions', 'click', '--id', 'dup']), /Duplicate rule id/);
  assert.equal(Fixture.read(runtime).rules.length, 1);
});

test('policy remove rejects unknown ids and missing flags', async () => {
  const runtime = Fixture.runtime();
  await assert.rejects(Fixture.run(['policy', 'remove', '--id', 'ghost', '--runtime', runtime, '--language', 'en']), /Rule not found/);
  await assert.rejects(Fixture.run(['policy', 'remove', '--runtime', runtime, '--language', 'en']), /--id/);
});

test('policy requires an installed runtime and resolves --home paths', async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-policy-bare-'));
  await assert.rejects(Fixture.run(['policy', 'list', '--runtime', bare]), new RegExp('tether install'));
  await assert.rejects(Fixture.run(['policy', 'bogus', '--runtime', bare]), /Unknown policy action/);
  fs.mkdirSync(path.join(bare, 'runtime', '.local'), { recursive: true });
  const { code, out } = await Fixture.run(['policy', 'path', '--home', bare]);
  assert.equal(code, 0);
  assert.equal(out, path.join(bare, 'runtime', '.local', Policy.FILE));
});

test('parse supports policy actions, positional values, and bilingual help', () => {
  const add = Cli.parse(['policy', 'add', '--effect', 'allow', '--actions', 'fill', '--first']);
  assert.equal(add.command, Cmd.POLICY);
  assert.equal(add.options.action, Policy.ACTION.ADD);
  assert.equal(add.options[Policy.KEY.FIRST], true);
  assert.equal(Cli.parse(['policy', 'list']).options.action, Policy.ACTION.LIST);
  assert.equal(Cli.parse(['policy', 'default', 'deny']).options.value, 'deny');
  assert.throws(() => Cli.parse(['policy', 'list', 'extra']), /Unexpected argument/);
  assert.throws(() => Cli.parse(['policy', 'add', '--effect']), /missing/);
  const lines = [];
  const log = console.log;
  console.log = text => lines.push(text);
  try { Cli.help('en'); Cli.help('zh-CN'); }
  finally { console.log = log; }
  const help = lines.join('\n');
  assert.match(help, /tether policy add/);
  assert.match(help, /策略（<runtime>\/\.local\/policy\.json/);
});
