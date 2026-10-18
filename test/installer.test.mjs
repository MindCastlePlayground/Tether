import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'jsonc-parser';
import { Cli } from '../installer/cli.mjs';
import { Files } from '../installer/files.mjs';
import { Cmd, Hint, Install, Opt, Probe } from '../installer/constants.mjs';
import { Runtime } from '../installer/runtime.mjs';
import { Browser } from '../installer/browser.mjs';
import { Agents, Detect } from '../installer/agents.mjs';

class Fixture {
  static root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tether-install-')); }
  static runtime(root) {
    for (const file of Install.REQUIRED) {
      const dest = path.join(root, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, '{}');
    }
    fs.writeFileSync(path.join(root, '.local', 'native-host.json'), JSON.stringify({path:path.join(root,'.local','host.exe')}));
  }
  static options(root) { return { agent: Agents.names.join(','), scope: 'project', project: path.join(root,'project'), language:'zh-CN', browser:'edge', runtime:path.join(root,'runtime') }; }
}

test('fresh configs for all hosts are valid and idempotent, including key reorder', () => {
  const entry = {command:'C:\\Tether\\mcp.exe', args:[], env:{BB_LANGUAGE:'en'}};
  for (const name of Agents.names) {
    const text = Agents.edit(name, '', entry);
    assert.equal(Agents.edit(name,text,entry),text);
  }
  const reordered = '{"mcpServers":{"tether":{"env":{"BB_LANGUAGE":"en"},"args":[],"command":"C:\\\\Tether\\\\mcp.exe"}}}';
  assert.equal(Agents.edit('cursor',reordered,entry),reordered);
  assert.throws(() => Agents.edit('gemini','{"mcpServers":null}',entry),/object/);
});

test('all host plans copy complete skill and nonsecret installed location', () => {
  const root = Fixture.root();
  const options = Fixture.options(root);
  const plans = Cli.plans(options,options.runtime);
  assert.equal(plans.length,5);
  for (const plan of plans) {
    assert.equal(plan.skills.length, Files.entries(path.join(Cli.ROOT,'skills',Install.SKILL)).length + 1);
    for (const item of plan.skills) Files.write(item.file,item.text);
    Files.write(plan.config,plan.text);
    const location = Files.json(path.join(plan.skill,Install.LOCATION));
    assert.equal(location.server,'tether');
    assert.equal(location.runtime,options.runtime);
    assert.equal(location.mcpCommand,path.join(options.runtime,'.local','mcp.exe'));
    assert.deepEqual(Object.keys(location).sort(), ['agent','clientConfig','configFile','language','mcpCommand','runtime','server']);
    assert.ok(fs.existsSync(path.join(plan.skill,'references','sdk.md')));
  }
  const repeated = Cli.plans(options,options.runtime);
  assert.ok(repeated.every(p => p.text === p.before));
  assert.equal(Agents.paths('opencode','user',{project:root,userHome:root,configHome:path.join(root,'custom')}).skill,path.join(root,'custom','opencode','skills',Install.SKILL));
});

test('multi-agent preflight refuses collisions before writing any destination', () => {
  const root=Fixture.root(), options=Fixture.options(root);
  fs.mkdirSync(path.join(options.project,'.gemini'),{recursive:true});
  fs.writeFileSync(path.join(options.project,'.gemini','settings.json'),'{"mcpServers":{"tether":{"command":"other"}}}');
  assert.throws(() => Cli.plans(options,options.runtime),/Conflicting/);
  assert.ok(!fs.existsSync(path.join(options.project,'.codex')));
  assert.ok(!fs.existsSync(path.join(options.project,'.agents')));
});

test('existing skill content is preserved on conflict', () => {
  const root=Fixture.root(), options=Fixture.options(root);
  const skill=path.join(options.project,'.agents','skills',Install.SKILL);
  fs.mkdirSync(skill,{recursive:true});
  fs.writeFileSync(path.join(skill,'SKILL.md'),'personal edits');
  assert.throws(() => Cli.plans(options,options.runtime),/Skill conflict/);
  assert.equal(Files.read(path.join(skill,'SKILL.md')),'personal edits');
});

test('config mutations back up exact original, repeat writes create no backup', () => {
  const root=Fixture.root(), file=path.join(root,'settings.json');
  fs.writeFileSync(file,'{"unrelated":"keep"}\n');
  const backup=Files.write(file,'{"unrelated":"keep","mcpServers":{}}\n');
  assert.equal(Files.read(backup),'{"unrelated":"keep"}\n');
  assert.equal(Files.write(file,Files.read(file)),null);
  assert.equal(fs.readdirSync(root).length,2);
});

test('dry run performs no writes or setup, doctor does not claim live connectivity', async () => {
  const root=Fixture.root(), options=Fixture.options(root);
  const before=fs.readdirSync(root);
  await Cli.main(['install','--agent','codex','--project',options.project,'--home',path.join(root,'home'),'--dry-run']);
  assert.deepEqual(fs.readdirSync(root),before);
  Fixture.runtime(options.runtime);
  assert.equal(Cli.doctor(options.runtime,options),0);
  assert.ok(!fs.existsSync(path.join(options.runtime,Install.MARKER)));
  assert.throws(() => Cli.parse(['install','--agent']),/missing/);
  assert.throws(() => Cli.parse(['install','agent','codex']),/Unexpected/);
});

test('reuse checks stable native path and refuses incomplete or unmanaged installs', () => {
  const root=Fixture.root();
  assert.throws(() => Runtime.check(root),/Incomplete/);
  assert.throws(() => Runtime.prepare(root,Cli.ROOT,{}),/already exists/);
  Fixture.runtime(root);
  Runtime.check(root);
  Runtime.prepare(root,Cli.ROOT,{runtime:root});
  fs.writeFileSync(path.join(root,'.local','native-host.json'),JSON.stringify({path:path.join(root,'different.exe')}));
  assert.throws(() => Runtime.check(root),/another runtime/);
});

test('browser trigger targets extension manager without loading/profile switches', () => {
  const root=Fixture.root();
  const exe=path.join(root,'Microsoft','Edge','Application','msedge.exe');
  fs.mkdirSync(path.dirname(exe),{recursive:true}); fs.writeFileSync(exe,'');
  const plan=Browser.plan('edge',root,{PROGRAMFILES:root});
  assert.equal(plan.exe,exe);
  assert.equal(plan.url,'edge://extensions/');
  assert.equal(plan.folder,path.join(root,'extension'));
  assert.equal(Browser.plan('chrome',root,{}).exe,undefined);
  assert.throws(() => Browser.plan('other',root),/Unsupported/);
});

test('runtime copy and npm package include the extension directory anchor', () => {
  const root = Fixture.root();
  const dest = path.join(root, 'runtime', 'extension');
  const anchor = Install.ANCHOR;
  Files.copy(path.join(Cli.ROOT, 'prototype', 'extension'), dest);
  assert.ok(fs.existsSync(path.join(dest, 'manifest.json')));
  assert.equal(Files.read(path.join(dest, anchor)), Files.read(path.join(Cli.ROOT, 'prototype', 'extension', anchor)));
  assert.ok(Install.SOURCE.includes('extension'));
  const pkg = Files.json(path.join(Cli.ROOT, 'package.json'));
  assert.ok(pkg.files.includes('prototype/extension/'));
  assert.ok(Files.read(path.join(dest, anchor)).includes('manifest.json'));
});

test('setup-time skill edits abort before registration and config mutation', async () => {
  const root=Fixture.root(), options=Fixture.options(root);
  const prepare=Runtime.prepare, register=Runtime.register;
  let registrations=0;
  try {
    Runtime.prepare=() => {
      const file=path.join(options.project,'.agents','skills',Install.SKILL,'SKILL.md');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,'edited during setup');
    };
    Runtime.register=() => {registrations++;};
    await assert.rejects(Cli.main(['install','--agent','codex','--project',options.project,'--runtime',options.runtime]),/Skill changed during setup/);
    assert.equal(registrations,0);
    assert.ok(!fs.existsSync(path.join(options.project,'.codex','config.toml')));
  } finally {Runtime.prepare=prepare;Runtime.register=register;}
});

test('agent detection uses PATH, PATHEXT, and home directories', () => {
  const home = Fixture.root();
  const bin = path.join(home, 'bin');
  const alt = path.join(home, 'alt');
  const exists = file => files.has(file);
  let files = new Set();
  const env = { [Probe.PATH]: [bin, alt].join(path.delimiter), [Probe.PATHEXT]: '.EXE;.CMD;.PS1' };
  assert.deepEqual(Detect.find(env, home, exists), []);
  files.add(path.join(bin, Probe.BIN.codex) + '.CMD');
  files.add(path.join(home, Probe.HOME.claude));
  files.add(path.join(home, Probe.HOME.cursor));
  files.add(path.join(home, Probe.HOME.config, Probe.HOME.opencode));
  files.add(path.join(alt, Probe.BIN.gemini) + '.PS1');
  assert.deepEqual(Detect.find(env, home, exists), Agents.names);
  files = new Set([path.join(bin, 'cursor') + '.EXE']);
  assert.deepEqual(Detect.find(env, home, exists), []);
  files = new Set([path.join(bin, Probe.BIN.codex) + '.cmd']);
  assert.deepEqual(Detect.find({ ...env, [Probe.PATHEXT]: '.EXE' }, home, exists), []);
  const codexHome = path.join(home, 'codex-home');
  files = new Set([codexHome]);
  assert.deepEqual(Detect.find({ [Probe.PATH]: '', [Probe.CODEX_HOME]: codexHome }, home, exists), ['codex']);
  const xdg = path.join(home, 'xdg');
  files = new Set([path.join(xdg, Probe.HOME.opencode)]);
  assert.deepEqual(Detect.find({ [Probe.PATH]: '', [Probe.CONFIG_HOME]: xdg }, home, exists), ['opencode']);
  files = new Set([path.join(bin, Probe.BIN.opencode)]);
  assert.deepEqual(Detect.find({ [Probe.PATH]: bin, [Probe.PATHEXT]: '' }, home, exists), ['opencode']);
});

test('parse accepts auto, no-open, and upgrade', () => {
  const none = Cli.parse(['install', '--dry-run']);
  assert.equal(none.options.agent, undefined);
  assert.equal(none.options[Opt.NO_OPEN], undefined);
  const auto = Cli.parse(['install', '--agent', Opt.AUTO, '--no-open', '--open-browser']);
  assert.equal(auto.options.agent, Opt.AUTO);
  assert.equal(auto.options[Opt.NO_OPEN], true);
  assert.equal(auto.options[Install.OPTION.OPEN], true);
  assert.equal(Cli.parse([Cmd.UPGRADE, '--language', 'zh-CN']).command, Cmd.UPGRADE);
  assert.deepEqual(Cli.resolve({ agent: Opt.AUTO, language: 'en' }, () => ['codex', 'opencode']).names, ['codex', 'opencode']);
  assert.equal(Cli.resolve({ agent: 'codex,claude', language: 'en' }, () => []).detected, false);
  assert.throws(() => Cli.resolve({ language: 'en' }, () => []), new RegExp(Opt.AGENT));
  const lines = [];
  const log = console.log;
  console.log = text => lines.push(text);
  try { Cli.help('en'); Cli.help('zh-CN'); }
  finally { console.log = log; }
  const help = lines.join('\n');
  assert.match(help, new RegExp(Cmd.UPGRADE));
  assert.match(help, new RegExp(Opt.NO_OPEN));
  assert.match(help, /auto/);
  assert.match(help, /检测到 Agent|省略或 auto/);
});

test('install opens the browser unless no-open or dry-run, and a missing browser does not fail', async () => {
  const root = Fixture.root();
  const project = path.join(root, 'project');
  const runtime = path.join(root, 'runtime');
  const prepare = Runtime.prepare;
  const register = Runtime.register;
  const open = Browser.open;
  const calls = [];
  const log = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    Runtime.prepare = () => {};
    Runtime.register = () => {};
    Browser.open = async plan => { calls.push(plan.url); };
    const args = ['install', '--agent', 'codex', '--project', project, '--runtime', runtime, '--language', 'en'];
    assert.equal(await Cli.main(args), 0);
    assert.equal(calls.length, 1);
    assert.equal(await Cli.main([...args, '--open-browser']), 0);
    assert.equal(calls.length, 2);
    assert.equal(await Cli.main([...args, '--no-open', '--open-browser']), 0);
    assert.equal(calls.length, 2);
    assert.equal(await Cli.main([...args, '--dry-run']), 0);
    assert.equal(calls.length, 2);
    Browser.open = async () => { throw new Error('Browser executable not found. Open chrome://extensions/ manually'); };
    assert.equal(await Cli.main(args), 0);
    assert.match(logs.join('\n'), /Browser executable not found/);
  } finally {
    Runtime.prepare = prepare;
    Runtime.register = register;
    Browser.open = open;
    console.log = log;
  }
});

test('dry-run without --agent prints detected agents and writes nothing', async () => {
  const root = Fixture.root();
  const find = Detect.find;
  const log = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    Detect.find = () => ['codex', 'claude', 'opencode'];
    const code = await Cli.main(['install', '--dry-run', '--scope', 'project', '--project', path.join(root, 'project'), '--home', path.join(root, 'home'), '--language', 'en']);
    assert.equal(code, 0);
    assert.match(logs.join('\n'), /Detected agents: codex, claude, opencode/);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    Detect.find = find;
    console.log = log;
  }
});

test('upgrade replaces source, keeps local and venv, and mocks npm and python', () => {
  const root = Fixture.root();
  const runtime = path.join(root, 'runtime');
  const source = path.join(root, 'source');
  const dirs = new Set(['src', 'extension', 'python']);
  const seed = (base, text) => {
    for (const name of Install.SOURCE) {
      const dest = path.join(base, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (dirs.has(name)) {
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, 'mark.txt'), text);
      } else fs.writeFileSync(dest, text);
    }
  };
  seed(source, 'new');
  seed(runtime, 'old');
  fs.writeFileSync(path.join(runtime, 'src', 'stale.js'), 'stale');
  fs.mkdirSync(path.join(runtime, '.local'), { recursive: true });
  fs.mkdirSync(path.join(runtime, '.venv'), { recursive: true });
  fs.writeFileSync(path.join(runtime, '.local', 'broker.json'), 'secret');
  fs.writeFileSync(path.join(runtime, Install.KEY), JSON.stringify({ id: 'x', key: 'K' }));
  fs.writeFileSync(path.join(source, Install.MANIFEST), JSON.stringify({ name: 'n' }));
  fs.writeFileSync(path.join(runtime, '.venv', 'pyvenv.cfg'), 'keep');
  fs.writeFileSync(path.join(runtime, Install.MARKER), `${JSON.stringify({ version: '0.0.1', ready: true })}\n`);
  const npm = Runtime.npm;
  const run = Runtime.run;
  const calls = [];
  try {
    Runtime.npm = (args, cwd) => calls.push(['npm', args, cwd]);
    Runtime.run = (command, args, cwd) => calls.push(['run', command, args, cwd]);
    Runtime.upgrade(runtime, source, { language: 'en' });
    assert.equal(Files.read(path.join(runtime, 'src', 'mark.txt')), 'new');
    assert.equal(Files.read(path.join(runtime, 'README.md')), 'new');
    assert.equal(fs.existsSync(path.join(runtime, 'src', 'stale.js')), false);
    assert.equal(Files.read(path.join(runtime, '.local', 'broker.json')), 'secret');
    assert.equal(Files.read(path.join(runtime, '.venv', 'pyvenv.cfg')), 'keep');
    assert.equal(Files.json(path.join(runtime, Install.MARKER)).version, Install.VERSION);
    assert.deepEqual(Files.json(path.join(runtime, Install.MANIFEST)), { name: 'n', key: 'K' });
    fs.writeFileSync(path.join(source, 'src', 'mark.txt'), 'newer');
    Runtime.upgrade(runtime, source, { language: 'en' });
    assert.equal(Files.read(path.join(runtime, 'src', 'mark.txt')), 'newer');
    assert.equal(Files.read(path.join(runtime, '.local', 'broker.json')), 'secret');
    assert.equal(calls.filter(item => item[0] === 'npm').length, 4);
    const runs = calls.filter(item => item[0] === 'run').map(item => item[2].join(' '));
    assert.equal(runs.filter(item => item.includes('pip')).length, 2);
    assert.equal(runs.filter(item => item.includes('setup.py')).length, 2);
    assert.ok(calls.every(item => item[0] !== 'run' || item[3] === runtime));
  } finally {
    Runtime.npm = npm;
    Runtime.run = run;
  }
  assert.throws(() => Runtime.upgrade(path.join(root, 'missing'), source, {}), new RegExp(Hint.INSTALL));
  assert.throws(() => Runtime.upgrade(path.join(root, 'empty'), source, {}), new RegExp(Hint.INSTALL));
  fs.mkdirSync(path.join(root, 'bare'));
  assert.throws(() => Runtime.upgrade(path.join(root, 'bare'), source, {}), new RegExp(Hint.INSTALL));
});

test('install refuses an older runtime and points at upgrade', () => {
  const root = Fixture.root();
  fs.writeFileSync(path.join(root, Install.MARKER), JSON.stringify({ version: '0.0.0', ready: true }));
  assert.throws(() => Runtime.prepare(root, root, {}), new RegExp(Hint.UPGRADE));
});

test('native registration respects opt-out and targets the chosen runtime script', () => {
  const ps=Runtime.ps, calls=[];
  try {
    Runtime.ps=(...args)=>calls.push(args);
    Runtime.register('C:/Tether/runtime',{'no-register':true,language:'en'});
    assert.equal(calls.length,0);
    Runtime.register('C:/Tether/runtime',{language:'zh-CN'});
    assert.equal(calls.length,1);
    assert.equal(calls[0][0],path.join('C:/Tether/runtime','scripts','register.ps1'));
    assert.equal(calls[0][2].BB_LANGUAGE,'zh-CN');
  } finally {Runtime.ps=ps;}
});
