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
const hostName = 'com.tether.locator_qa';
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
  const manifest = { name: hostName, description: 'Tether isolated locator E2E host', path: join(local, 'host.exe'), type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] };
  writeFileSync(join(local, 'native-host.json'), JSON.stringify(manifest, null, 2));
  makeWrapper(process.execPath);
  registryMade = true;
  ps(`New-Item -Path '${registryPath}' -Force | Out-Null; Set-Item -Path '${registryPath}' -Value '${join(local, 'native-host.json').replaceAll("'", "''")}'`);
  server = createServer((req, res) => {
    const html = '<!doctype html><meta charset="utf-8"><title>Locator fixture</title><label>Name<input id="name"></label><output id="out"></output><button id="deep" onclick="document.querySelector(\'#out\').textContent=\'nested-ok\'"><div><span><i>*</i><span>Deep Save</span></span></div></button><div role="button" tabindex="0" onclick="document.querySelector(\'#out\').textContent=\'xpath-ok\'"><span>Deep <b>Go</b></span></div><button onclick="document.querySelector(\'#out\').textContent=\'dup-1\'"><span>Dup</span></button><button onclick="document.querySelector(\'#out\').textContent=\'dup-2\'"><span>Dup</span></button>';
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

  // Locator closure through the real extension: snapshot refs, nested-text rewrite, refusal and precise locate.
  const { BridgeClient, loadConfig } = await import('../dist/client.js');
  const client = new BridgeClient(await loadConfig(join(local, 'agent.json')));
  const grant = await client.requestSession({ mode: 'newGroup', url: fixtureUrl });
  const sessionId = grant.sessionId;
  if (!sessionId) throw Error(`request_session_${grant.status ?? 'missing_id'}`);
  const pageId = grant.pages?.[0]?.pageId;
  const page = await waitFor(() => context.pages().find(v => v.url() === fixtureUrl), 'fixture_navigation');
  await page.waitForFunction(() => document.readyState === 'complete' && document.title === 'Locator fixture');
  const out = async () => page.locator('#out').textContent();
  const steps = {};
  const snap = await client.snapshot({ sessionId, pageId });
  const ref = snap.tree.match(/button "\*?Deep Save" \[ref=(e\d+)\]/)?.[1];
  if (!ref || /- generic \[ref=e\d+\]:$/m.test(snap.tree)) throw Error('snapshot_tree_failed');
  steps.snapshot = { refs: snap.refs, chars: snap.tree.length, truncated: snap.truncated };
  const byRef = await client.click({ sessionId, pageId, seq: 1, ref });
  if (byRef.sideEffect !== 'applied' || await out() !== 'nested-ok') throw Error('ref_click_failed ' + JSON.stringify(byRef) + ' out=' + await out() + ' tree=' + snap.tree.slice(0,400));
  steps.refClick = { ref, strategy: byRef.strategy, target: byRef.target?.selector };
  const naive = '//button[text()="Deep Save"]';
  if (await page.locator(naive).count() !== 0) throw Error('fixture_not_nested');
  const byText = await client.click({ sessionId, pageId, seq: 2, selector: '//div[@role="button"][text()="Deep Go"]' });
  if (!String(byText.strategy).startsWith('xpath-normalize-space') || await out() !== 'xpath-ok') throw Error('xpath_rewrite_failed');
  steps.xpathRewrite = { strategy: byText.strategy, hint: !!byText.hint };
  const byName = await client.click({ sessionId, pageId, seq: 3, selector: naive });
  if (byName.sideEffect !== 'applied' || await out() !== 'nested-ok') throw Error('nested_text_fallback_failed');
  steps.nestedFallback = { strategy: byName.strategy, target: byName.target?.selector };
  const dup = await client.click({ sessionId, pageId, seq: 4, selector: '//button[text()="Dup"]' });
  if (dup.sideEffect !== 'none' || dup.error !== 'selector_ambiguous' || dup.candidates?.length !== 2 || await out() !== 'nested-ok') throw Error('ambiguity_not_refused');
  steps.ambiguous = { error: dup.error, candidates: dup.candidates.map(c => c.actionable?.selector ?? c.selector) };
  const miss = await client.click({ sessionId, pageId, seq: 5, selector: '#absent' });
  if (miss.sideEffect !== 'none' || miss.error !== 'selector_not_found') throw Error('missing_not_refused');
  const found = await client.locate({ sessionId, pageId, role: 'button', name: 'Dup', exact: true });
  if (found.count !== 2 || new Set(found.candidates.map(c => c.selector)).size !== 2) throw Error('locate_failed');
  const pick = await client.click({ sessionId, pageId, seq: 6, selector: found.candidates[1].selector });
  if (pick.sideEffect !== 'applied' || await out() !== 'dup-2') throw Error('candidate_click_failed');
  steps.locate = { count: found.count, picked: found.candidates[1].selector };
  const filled = await client.fill({ sessionId, pageId, seq: 7, selector: 'Name', value: 'label-ok' });
  if (filled.sideEffect !== 'applied' || await page.inputValue('#name') !== 'label-ok') throw Error('label_fill_failed');
  steps.labelFill = { strategy: filled.strategy };
  await client.release({ sessionId, seq: 8 }); client.close();
  await ctl(hostCfg, '/control/stop'); await waitListening(p, false); brokerOwned = false;
  const report = { result: 'passed', extensionServiceWorker: sw.url(), nativeHost: hostName, steps };
  writeFileSync(join(qa, 'result.json'), JSON.stringify(report, null, 2));
  say(JSON.stringify({ ...report, resultFile: join(qa, 'result.json') }, null, 1));
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
