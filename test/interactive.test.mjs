import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { Cli } from '../installer/cli.mjs';
import { Wizard } from '../installer/wizard.mjs';
import { Cancelled, Tui } from '../installer/ui.mjs';
import { Choice, Install, Lang, State, Step } from '../installer/constants.mjs';
import { Runtime } from '../installer/runtime.mjs';
import { Copy } from '../installer/text.mjs';

// Scripted UI: answers by step id, otherwise accepts the default like pressing Enter.
class Script {
  constructor(answers = {}) { this.answers = answers; this.asked = []; this.notes = []; }
  reply(id, initial) {
    this.asked.push(id);
    const value = this.answers[id];
    if (value instanceof Error) throw value;
    return value === undefined ? initial : value;
  }
  async pick(id, message, items, initial) { return this.reply(id, initial); }
  async many(id, message, items, initial) { return this.reply(id, initial); }
  async ask(id, message, fallback = '') { return this.reply(id, fallback); }
  async ok(id, message, initial = true) { return this.reply(id, initial); }
  start() {} end() {} info() {}
  stop(text) { this.notes.push(text); }
  warn(text) { this.notes.push(text); }
  note(text) { this.notes.push(text); }
}

class Env {
  static make(extra = {}) {
    const root = path.join(os.tmpdir(), 'tether-wizard', 'runtime');
    return { language: Lang.EN, state: State.NONE, root, agents: ['codex', 'claude'], browsers: ['edge'], cwd: os.tmpdir(), home: path.dirname(root), check: () => ({ root, state: State.NONE }), ...extra };
  }
}

test('quick install on a fresh machine needs only Enter presses', async () => {
  const ui = new Script();
  const args = await Wizard.run(ui, Env.make());
  const { command, options } = Cli.parse(args);
  assert.equal(command, 'install');
  assert.equal(options.agent, 'codex,claude');
  assert.equal(options.scope, undefined);
  assert.equal(Cli.scope('codex', options), 'user');
  assert.equal(options.browser, 'edge');
  assert.equal(options['dry-run'], undefined);
  assert.deepEqual(ui.asked, [Step.ACTION, Step.AGENTS, Step.BROWSER, Step.MODE, Step.CONFIRM]);
});

test('preview choice adds --dry-run and summary lists the plan', async () => {
  const ui = new Script({ [Step.CONFIRM]: Choice.PREVIEW });
  const { options } = Cli.parse(await Wizard.run(ui, Env.make()));
  assert.equal(options['dry-run'], true);
  assert.ok(ui.notes.some(text => text.includes('Codex, Claude Code') && text.includes('Edge')));
});

test('project scope is only offered in custom mode', async () => {
  const user = new Script({ [Step.MODE]: Choice.CUSTOM });
  const kept = Cli.parse(await Wizard.run(user, Env.make())).options;
  assert.equal(kept.scope, undefined);
  assert.ok(user.asked.includes(Step.SCOPE) && !user.asked.includes(Step.PROJECT));
  const ui = new Script({ [Step.MODE]: Choice.CUSTOM, [Step.SCOPE]: 'project', [Step.PROJECT]: 'C:\\proj' });
  const { options } = Cli.parse(await Wizard.run(ui, Env.make()));
  assert.equal(options.scope, 'project');
  assert.equal(options.project, 'C:\\proj');
  assert.ok(ui.notes.some(text => text.includes('C:\\proj')));
});

test('custom mode maps answers to install options', async () => {
  const ui = new Script({ [Step.MODE]: Choice.CUSTOM, [Step.HOME]: 'D:\\Apps\\Tether', [Step.EXTENSION_DIR]: 'E:\\ext dir', [Step.PYTHON]: 'py', [Step.LANGUAGE]: Lang.ZH, [Step.REGISTER]: false, [Step.OPEN]: false });
  const { options } = Cli.parse(await Wizard.run(ui, Env.make()));
  assert.equal(options.home, 'D:\\Apps\\Tether');
  assert.equal(options['extension-dir'], 'E:\\ext dir');
  assert.equal(options.python, 'py');
  assert.equal(options.language, Lang.ZH);
  assert.equal(options['no-register'], true);
  assert.equal(options['no-open'], true);
  assert.equal(options.runtime, undefined);
});

test('custom mode with an existing runtime skips home and python', async () => {
  const ui = new Script({ [Step.MODE]: Choice.CUSTOM, [Step.RUNTIME]: 'C:\\runtime' });
  const { options } = Cli.parse(await Wizard.run(ui, Env.make()));
  assert.equal(options.runtime, 'C:\\runtime');
  assert.ok(!ui.asked.includes(Step.HOME) && !ui.asked.includes(Step.PYTHON));
  assert.equal(options['no-register'], undefined);
});

test('menu follows the installed state', async () => {
  const stale = Env.make({ state: State.STALE, old: '1.0.0', check: () => ({ state: State.STALE, old: '1.0.0' }) });
  const upgrade = Cli.parse(await Wizard.run(new Script(), stale)).options;
  assert.equal(upgrade.upgrade, true);
  assert.deepEqual(await Wizard.run(new Script({ [Step.ACTION]: Choice.RUNTIME_ONLY }), stale), ['upgrade']);
  const current = Env.make({ state: State.CURRENT });
  assert.deepEqual(await Wizard.run(new Script({ [Step.ACTION]: Choice.EXTENSION }), current), ['extension', '--open-browser', '--browser', 'edge']);
  assert.deepEqual(await Wizard.run(new Script({ [Step.ACTION]: Choice.DOCTOR }), current), ['doctor']);
  assert.deepEqual(await Wizard.run(new Script({ [Step.ACTION]: Choice.UPDATE }), current), ['update']);
  assert.equal(Cli.parse(await Wizard.run(new Script({ [Step.ACTION]: Choice.REPAIR }), current)).options.force, true);
  assert.equal(await Wizard.run(new Script({ [Step.ACTION]: Choice.EXIT }), current), null);
});

test('preflight offers upgrade for an older runtime at the chosen home', async () => {
  const checks = [];
  const check = args => { checks.push(args.includes('--upgrade')); return { state: State.STALE, old: '1.0.0' }; };
  const args = await Wizard.run(new Script(), Env.make({ check }));
  assert.ok(args.includes('--upgrade'));
  assert.deepEqual(checks, [false, true]);
  assert.equal(await Wizard.run(new Script({ [Step.UPGRADE]: false }), Env.make({ check })), null);
});

test('preflight conflicts ask before forcing replacement', async () => {
  const check = args => (args.includes('--force') ? { state: State.NONE } : { state: State.NONE, conflict: 'C:\\p\\.mcp.json: Conflicting tether entry' });
  const declined = new Script();
  assert.equal(await Wizard.run(declined, Env.make({ check })), null);
  assert.ok(declined.notes.some(text => text.includes('.mcp.json')));
  const accepted = await Wizard.run(new Script({ [Step.FORCE]: true }), Env.make({ check }));
  assert.equal(Cli.parse(accepted).options.force, true);
});

test('preflight errors and cancellation stop without arguments', async () => {
  const failed = new Script();
  assert.equal(await Wizard.run(failed, Env.make({ check: () => ({ state: State.NONE, error: 'Malformed JSONC' }) })), null);
  assert.ok(failed.notes.some(text => text.includes('Malformed JSONC')));
  assert.equal(await Wizard.run(new Script({ [Step.BROWSER]: new Cancelled() }), Env.make()), null);
  await assert.rejects(Wizard.run(new Script({ [Step.BROWSER]: new Error('boom') }), Env.make()), /boom/);
});

test('Cli.state classifies install homes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-state-'));
  const dir = name => path.join(root, name);
  const mark = (name, meta) => { fs.mkdirSync(dir(name)); fs.writeFileSync(path.join(dir(name), Install.MARKER), JSON.stringify(meta)); };
  fs.mkdirSync(dir('foreign'));
  mark('partial', { version: Install.VERSION, ready: false });
  mark('current', { version: Install.VERSION, ready: true });
  mark('stale', { version: '0.1.0', ready: true });
  assert.equal(Cli.state(dir('none')).state, State.NONE);
  assert.equal(Cli.state(dir('foreign')).state, State.FOREIGN);
  assert.equal(Cli.state(dir('partial')).state, State.PARTIAL);
  assert.equal(Cli.state(dir('current')).state, State.CURRENT);
  assert.deepEqual(Cli.state(dir('stale')), { state: State.STALE, old: '0.1.0' });
});

test('Cli.check reports real config conflicts and clears them with --force', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-check-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, '.mcp.json'), '{"mcpServers":{"tether":{"command":"other.exe"}}}');
  const args = ['install', '--agent', 'claude', '--scope', 'project', '--project', project, '--home', path.join(root, 'home'), '--language', 'en'];
  const report = Cli.check(args);
  assert.equal(report.state, State.NONE);
  assert.match(report.conflict, /\.mcp\.json: Conflicting tether entry/);
  assert.equal(Cli.check([...args, '--force']).conflict, undefined);
  fs.writeFileSync(path.join(project, '.mcp.json'), '{ broken');
  assert.match(Cli.check(args).error, /Malformed/);
  fs.mkdirSync(path.join(root, 'home', 'runtime'), { recursive: true });
  assert.match(Cli.check([...args, '--force']).error, /not created by this installer/);
});

test('terminal UI drives clack prompts and maps Ctrl+C to cancellation', async () => {
  const io = () => { const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {}; return { input, output: new PassThrough() }; };
  const a = io();
  const picked = new Tui(a).pick(Step.BROWSER, 'Browser', [['chrome', 'Chrome'], ['edge', 'Edge']], 'chrome');
  setImmediate(() => { a.input.write('\x1b[B'); a.input.write('\r'); });
  assert.equal(await picked, 'edge');
  const b = io();
  const cancelled = new Tui(b).ok(Step.OPEN, 'Open?');
  setImmediate(() => b.input.write('\x03'));
  await assert.rejects(cancelled, Cancelled);
});

test('a newer installed runtime is never downgraded by default', async () => {
  const newer = Env.make({ state: State.NEWER, old: '9.0.0' });
  const ui = new Script({ [Step.ACTION]: Choice.EXIT });
  assert.equal(await Wizard.run(ui, newer), null);
  assert.ok(ui.notes.some(text => text.includes('9.0.0')));
  assert.deepEqual(await Wizard.run(new Script({ [Step.ACTION]: Choice.DOCTOR }), newer), ['doctor']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-newer-'));
  fs.writeFileSync(path.join(root, Install.MARKER), JSON.stringify({ version: '9.0.0', ready: true }));
  assert.deepEqual(Cli.state(root), { state: State.NEWER, old: '9.0.0' });
  assert.throws(() => Runtime.upgrade(root, root, { language: 'en' }), /newer than this installer/);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-newer-home-'));
  fs.mkdirSync(path.join(home, 'runtime'));
  fs.writeFileSync(path.join(home, 'runtime', Install.MARKER), JSON.stringify({ version: '9.0.0', ready: true }));
  assert.match(Cli.check(['install', '--agent', 'codex', '--project', home, '--home', home, '--language', 'en']).error, /newer than this installer/);
  assert.equal(Runtime.compare('1.10.0', '1.9.9'), 1);
  assert.equal(Runtime.compare('1.1', '1.1.0'), 0);
  assert.equal(Runtime.compare('0.9.0', '1.1.0'), -1);
});

test('summary aligns CJK labels and names options in words', () => {
  const t = Copy.of(Lang.ZH);
  const text = Wizard.summary(t, ['install', '--agent', 'codex', '--browser', 'chrome', '--force', '--no-open'], { root: 'C:\rt' });
  const lines = text.split('\n');
  const column = line => { const [, label, gap] = line.match(/^(\S+)(\s+)/); return Wizard.width(label) + gap.length; };
  assert.ok(lines.every(line => column(line) === column(lines[0])));
  assert.match(text, /备份并替换冲突项, 不打开浏览器/);
});

test('upgrade summary warns about running Broker and agent sessions', async () => {
  const check = () => ({ state: State.STALE, old: '1.0.0', busy: { broker: 1, host: 1, mcp: 3 } });
  const ui = new Script();
  const args = await Wizard.run(ui, Env.make({ state: State.STALE, old: '1.0.0', check }));
  assert.ok(args.includes('--upgrade'));
  assert.ok(ui.notes.some(text => text.includes('auto-start is paused')));
  assert.ok(ui.notes.some(text => text.includes('3 agent session')));
});
