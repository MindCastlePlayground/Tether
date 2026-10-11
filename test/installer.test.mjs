import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'jsonc-parser';
import { Cli } from '../installer/cli.mjs';
import { Files } from '../installer/files.mjs';
import { Install } from '../installer/constants.mjs';
import { Runtime } from '../installer/runtime.mjs';
import { Browser } from '../installer/browser.mjs';
import { Agents } from '../installer/agents.mjs';

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
