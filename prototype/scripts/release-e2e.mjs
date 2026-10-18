import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Config } from '../dist/config.js';

const root = resolve(import.meta.dirname, '..');
const repo = resolve(root, '..');
const id = JSON.parse(readFileSync(join(root, '.local', 'host.json'), 'utf8')).extensionId;
const hostName = 'com.tether.release_qa';
const chromePath = process.env.TETHER_QA_CHROME ?? join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const qa = join(root, 'work', `qa-${Date.now()}-${randomBytes(3).toString('hex')}`);
const profile = join(qa, 'profile');
const ext = join(qa, 'extension');
const local = join(qa, 'local');
const registryPath = `HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`;
const regExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
let context; let server; let brokerOwned = false; let registryMade = false;
let cdpSeq = 0;
const say = (s) => process.stdout.write(`${s}\n`);
function ps(script) {
  const r = spawnSync(regExe, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw Error(`powershell_failed:${r.status}`);
  return r.stdout.trim();
}
function port() {
  return new Promise((resolvePort, reject) => {
    const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolvePort(p)); });
  });
}
function ctl(cfg, path) {
  return new Promise((resolveCtl, reject) => {
    const url = new URL(cfg.url); url.protocol = 'https:'; url.pathname = path;
    const req = httpsRequest(url, { method: 'POST', ...Config.tls(cfg) }, res => {
      res.resume(); res.on('end', () => res.statusCode === 200 ? resolveCtl() : reject(Error(`control_http_${res.statusCode}`)));
    });
    req.on('error', reject); req.end();
  });
}
function waitListening(p, yes, ms = 15000) {
  const end = Date.now() + ms;
  return (async () => {
    while (Date.now() < end) {
      const up = await new Promise(ok => { const s = createServer(); s.once('error', () => ok(true)); s.listen(p, '127.0.0.1', () => s.close(() => ok(false))); });
      if (up === yes) return;
      await delay(200);
    }
    throw Error(`broker_listening_${yes ? 'timeout' : 'still_up'}`);
  })();
}
async function waitFor(fn, label, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await delay(150); }
  throw Error(`${label}_timeout`);
}
function targetEval(cdp, sessionId, expression) {
  return new Promise((resolveEval, reject) => {
    const id = ++cdpSeq;
    const timer = setTimeout(() => finish(Error('popup_cdp_timeout')), 5000);
    const onMessage = e => {
      if (e.sessionId !== sessionId) return;
      let packet; try { packet = JSON.parse(e.message); } catch { return; }
      if (packet.id !== id) return;
      finish(packet.error ? Error(packet.error.message) : null, packet.result?.result?.value);
    };
    const finish = (err, value) => { clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', onMessage); err ? reject(err) : resolveEval(value); };
    cdp.on('Target.receivedMessageFromTarget', onMessage);
    void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }) }).catch(finish);
  });
}
function makeWrapper(node) {
  const exe = join(local, 'host.exe');
  const src = String.raw`using System; using System.Diagnostics; using System.IO; using System.Threading;
class QaHost {
  static void Pump(Stream i, Stream o) { byte[] b=new byte[8192]; int n; try { while((n=i.Read(b,0,b.Length))>0){o.Write(b,0,n);o.Flush();} } catch {} }
  static int Main(string[] a) {
    if(a.Length<1 || !a[0].StartsWith("chrome-extension://${id}/")) return 2;
    var p=new ProcessStartInfo(@"${node}"); p.UseShellExecute=false;p.CreateNoWindow=true;p.RedirectStandardInput=true;p.RedirectStandardOutput=true;p.RedirectStandardError=true;
    p.Arguments="\""+@"${join(repo, 'prototype', 'dist', 'host.js')}"+"\" \""+@"${join(local, 'host.json')}"+"\" \""+a[0]+"\"";
    p.EnvironmentVariables["BB_CLIENT_CONFIG"]=@"${join(local, 'agent.json')}";
    using(var c=Process.Start(p)){var i=new Thread(()=>{Pump(Console.OpenStandardInput(),c.StandardInput.BaseStream);try{c.StandardInput.Close();}catch{}});var o=new Thread(()=>Pump(c.StandardOutput.BaseStream,Console.OpenStandardOutput()));var e=new Thread(()=>Pump(c.StandardError.BaseStream,Console.OpenStandardError()));i.IsBackground=o.IsBackground=e.IsBackground=true;i.Start();o.Start();e.Start();c.WaitForExit();o.Join();e.Join();return c.ExitCode;}
  }
}`;
  const script = join(local, 'compile.ps1');
  writeFileSync(script, `$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${src}\n'@ -OutputAssembly '${exe.replaceAll("'", "''")}' -OutputType ConsoleApplication\n`);
  const r = spawnSync(regExe, ['-NoProfile', '-NonInteractive', '-File', script], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !existsSync(exe)) throw Error('qa_host_compile_failed');
}
async function run() {
  if (!existsSync(chromePath)) throw Error('configured_chromium_not_found');
  mkdirSync(local, { recursive: true }); mkdirSync(profile, { recursive: true });
  const busy = ps(`if (Test-Path -LiteralPath '${registryPath}') { 'present' } else { 'absent' }`);
  if (busy !== 'absent') throw Error('qa_registry_key_already_exists');
  cpSync(join(root, 'extension'), ext, { recursive: true });
  const proto = join(ext, 'protocol.js');
  writeFileSync(proto, readFileSync(proto, 'utf8').replace("com.freebird.browser_bridge", hostName));
  const hostCfg = JSON.parse(readFileSync(join(root, '.local', 'host.json'), 'utf8'));
  const brokerCfg = JSON.parse(readFileSync(join(root, '.local', 'broker.json'), 'utf8'));
  delete brokerCfg.lan;
  const p = await port(); brokerCfg.port = p;
  writeFileSync(join(local, 'broker.json'), JSON.stringify(brokerCfg));
  hostCfg.url = `wss://127.0.0.1:${p}/bridge`;
  hostCfg.extensionId = id;
  writeFileSync(join(local, 'host.json'), JSON.stringify(hostCfg));
  const agent = JSON.parse(readFileSync(join(root, '.local', 'agent.json'), 'utf8'));
  agent.url = `wss://127.0.0.1:${p}/bridge`;
  writeFileSync(join(local, 'agent.json'), JSON.stringify(agent));
  const manifest = { name: hostName, description: 'Tether isolated release E2E host', path: join(local, 'host.exe'), type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] };
  writeFileSync(join(local, 'native-host.json'), JSON.stringify(manifest, null, 2));
  makeWrapper(process.execPath);
  registryMade = true;
  ps(`New-Item -Path '${registryPath}' -Force | Out-Null; Set-Item -Path '${registryPath}' -Value '${join(local, 'native-host.json').replaceAll("'", "''")}'`);
  server = createServer((req, res) => {
    const html = '<!doctype html><meta charset="utf-8"><title>Release fixture</title><label>Name<input id="name"></label><button id="go" onclick="document.querySelector(\'#out\').textContent=document.querySelector(\'#name\').value">Apply</button><output id="out"></output>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath, headless: false, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`], ignoreDefaultArgs: ['--disable-extensions'] });
  const popupErrors = [];
  context.on('page', page => {
    page.on('pageerror', e => popupErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') popupErrors.push(m.text()); });
  });
  const sw = await waitFor(() => context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${id}/`)), 'extension_service_worker');
  await waitFor(async () => { const s = ps(`if (Test-Path '${join(local, 'broker-state.json')}') {(Get-Content '${join(local, 'broker-state.json')}' -Raw)} else {''}`); return s && JSON.parse(s).state === 'running'; }, 'auto_broker_start');
  brokerOwned = true;
  const fixturePage = await context.newPage(); await fixturePage.goto(fixtureUrl);
  const cdp = await context.browser().newBrowserCDPSession();
  await sw.evaluate(async () => chrome.action.openPopup());
  const targetInfo = await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url === `chrome-extension://${id}/popup.html`), 'action_popup_target', 8000);
  const attached = await cdp.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: false });
  const popupReady = await waitFor(async () => targetEval(cdp, attached.sessionId, "document.querySelectorAll('#items input[type=checkbox]').length >= 2"), 'popup_render', 8000);
  if (!popupReady) throw Error('popup_render_failed');
  await targetEval(cdp, attached.sessionId, "document.querySelector('#language').value='en'; document.querySelector('#language').dispatchEvent(new Event('change',{bubbles:true})); true");
  await waitFor(async () => targetEval(cdp, attached.sessionId, "[...document.querySelectorAll('button')].some(b=>b.innerText.includes('Stop'))"), 'popup_english', 8000);
  const { BridgeClient, loadConfig } = await import('../dist/client.js');
  const client = new BridgeClient(await loadConfig(join(local, 'agent.json')));
  const grant = await client.requestSession({ mode: 'newGroup', url: fixtureUrl });
  let sessionId = grant.sessionId;
  if (!sessionId && grant.pendingId) {
    await targetEval(cdp, attached.sessionId, "[...document.querySelectorAll('#items section.card')].find(c=>c.innerText.includes('127.0.0.1'))?.querySelector('button.approve')?.click(); true");
    const approved = await waitFor(async () => { const s = await client.approvalStatus({ pendingId: grant.pendingId }); return s.status === 'approved' ? s : false; }, 'session_approval', 12000);
    sessionId = approved.sessionId;
  }
  if (!sessionId) throw Error(`request_session_${grant.status ?? 'missing_id'}`);
  const pages = await client.listTabs({ sessionId });
  const rows = Array.isArray(pages) ? pages : pages.pages ?? pages.tabs ?? [];
  const target = rows.find(x => x.url === fixtureUrl) ?? rows[0];
  if (!target?.pageId) throw Error('new_group_page_missing');
  const page = await waitFor(() => context.pages().find(v => v.url() === fixtureUrl), 'fixture_navigation');
  await page.waitForFunction(() => document.readyState === 'complete' && document.title === 'Release fixture');
  const observed = await client.observe({ sessionId, pageId: target.pageId });
  if (observed.title !== 'Release fixture' || !String(observed.text).includes('Apply')) throw Error('observe_fixture_failed');
  await client.fill({ sessionId, pageId: target.pageId, seq: 1, selector: '#name', value: 'release-ok' });
  await client.click({ sessionId, pageId: target.pageId, seq: 2, selector: '#go' });
  const verified = await client.observe({ sessionId, pageId: target.pageId });
  if (!String(verified.text).includes('release-ok')) throw Error('browser_operation_failed');
  await client.release({ sessionId, seq: 3 }); client.close();
  const popupShot = await new Promise((resolveShot, reject) => {
    const id = ++cdpSeq; const timer = setTimeout(() => reject(Error('popup_screenshot_timeout')), 5000);
    const receive = e => { if (e.sessionId !== attached.sessionId) return; let p; try { p = JSON.parse(e.message); } catch { return; } if (p.id !== id) return; clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', receive); p.error ? reject(Error(p.error.message)) : resolveShot(p.result?.data); };
    cdp.on('Target.receivedMessageFromTarget', receive);
    void cdp.send('Target.sendMessageToTarget', { sessionId: attached.sessionId, message: JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }) }).catch(reject);
  });
  writeFileSync(join(qa, 'popup-en.png'), Buffer.from(popupShot, 'base64'));
  const checked = await targetEval(cdp, attached.sessionId, "document.querySelector('#items input[type=checkbox]').checked");
  if (!checked) throw Error('default_auto_guard_unchecked');
  const auto = { check: async () => targetEval(cdp, attached.sessionId, "const x=document.querySelector('#items input[type=checkbox]'); x.checked=true; x.dispatchEvent(new Event('change',{bubbles:true})); true") };
  await targetEval(cdp, attached.sessionId, "document.querySelectorAll('#items section.card button')[1].click(); true");
  await waitFor(async () => { const s = JSON.parse(readFileSync(join(local, 'broker-state.json'), 'utf8')); return s.mode === 'off' && s.state === 'stopped'; }, 'manual_off');
  const before = JSON.parse(readFileSync(join(local, 'broker-state.json'), 'utf8'));
  await delay(31000);
  const after = JSON.parse(readFileSync(join(local, 'broker-state.json'), 'utf8'));
  if (before.mode !== 'off' || after.mode !== 'off' || after.state !== 'stopped') throw Error('manual_off_autostarted');
  await targetEval(cdp, attached.sessionId, "document.querySelectorAll('#items section.card button')[0].click(); true");
  await waitFor(async () => { const s = JSON.parse(readFileSync(join(local, 'broker-state.json'), 'utf8')); return s.mode === 'on' && s.state === 'running'; }, 'manual_start');
  await waitListening(p, true);
  await auto.check();
  try { await waitFor(async () => { const s = JSON.parse(readFileSync(join(local, 'broker-state.json'), 'utf8')); return s.mode === 'auto' && s.state === 'running'; }, 'auto_on'); }
  catch (e) { writeFileSync(join(qa, 'popup-debug.json'), JSON.stringify({ broker: JSON.parse(readFileSync(join(local, 'broker-state.json'), 'utf8')), popup: await targetEval(cdp, attached.sessionId, "({text:document.body.innerText,checks:[...document.querySelectorAll('input[type=checkbox]')].map(x=>x.checked)})") }, null, 2)); throw e; }
  await waitFor(async () => targetEval(cdp, attached.sessionId, "document.querySelector('#items input[type=checkbox]').checked"), 'auto_guard_on');
  await ctl(hostCfg, '/control/stop');
  await waitListening(p, false);
  brokerOwned = false;
  const modeAfterStop = JSON.parse(readFileSync(join(local, 'broker-state.json'), 'utf8')).mode;
  if (modeAfterStop !== 'auto') throw Error('auto_mode_not_preserved_after_stop');
  await waitListening(p, true, 42000);
  brokerOwned = true;
  await waitFor(async () => JSON.parse(readFileSync(join(local, 'broker-state.json'), 'utf8')).state === 'running', 'alarm_recovery', 12000);
  await targetEval(cdp, attached.sessionId, "document.querySelector('#language').value='zh-CN'; document.querySelector('#language').dispatchEvent(new Event('change',{bubbles:true})); true");
  const zhShot = await new Promise((resolveShot, reject) => {
    const id = ++cdpSeq; const timer = setTimeout(() => reject(Error('popup_screenshot_timeout')), 5000);
    const receive = e => { if (e.sessionId !== attached.sessionId) return; let p; try { p = JSON.parse(e.message); } catch { return; } if (p.id !== id) return; clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', receive); p.error ? reject(Error(p.error.message)) : resolveShot(p.result?.data); };
    cdp.on('Target.receivedMessageFromTarget', receive);
    void cdp.send('Target.sendMessageToTarget', { sessionId: attached.sessionId, message: JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }) }).catch(reject);
  });
  writeFileSync(join(qa, 'popup-zh.png'), Buffer.from(zhShot, 'base64'));
  await ctl(hostCfg, '/control/stop'); await waitListening(p, false); brokerOwned = false;
  const report = { result: 'passed', extensionServiceWorker: sw.url(), nativeHost: hostName, brokerPort: p, defaultAuto: true, manualOffSurvived31s: true, startThenAuto: true, recoveryAfter30sAlarm: true, browserOps: ['requestSession', 'observe', 'fill', 'click', 'release'], popupScreenshots: ['popup-en.png', 'popup-zh.png'] };
  writeFileSync(join(qa, 'result.json'), JSON.stringify(report, null, 2));
  say(JSON.stringify({ ...report, resultFile: join(qa, 'result.json') }));
}
try { await run(); }
catch (e) { writeFileSync(join(qa, 'failure.log'), `${e?.stack ?? e?.message ?? 'unknown'}\n`); say(`BLOCKER ${e?.message ?? 'unknown'} log=${join(qa, 'failure.log')}`); process.exitCode = 1; }
finally {
  try { if (context) await Promise.race([context.close(), delay(5000)]); } catch {}
  try { if (server) await new Promise(r => server.close(r)); } catch {}
  if (brokerOwned) {
    try { const cfg = JSON.parse(readFileSync(join(local, 'host.json'), 'utf8')); await ctl(cfg, '/control/stop'); } catch {}
  }
  if (registryMade) { try { ps(`Remove-Item -LiteralPath '${registryPath}' -Recurse -Force`); } catch {} }
}
