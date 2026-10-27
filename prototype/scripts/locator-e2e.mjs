import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Config } from '../dist/config.js';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(process.env.TETHER_QA_RUNTIME ?? resolve(import.meta.dirname, '..'));
const seed = join(root, '.local');
const id = JSON.parse(readFileSync(join(seed, 'host.json'), 'utf8')).extensionId;
const hostName = 'com.tether.locator_qa';
const chromePath = findBrowser();
const qa = join(root, 'work', `qa-${Date.now()}-${randomBytes(3).toString('hex')}`);
const profile = join(qa, 'profile');
const ext = join(qa, 'extension');
const local = join(qa, 'local');
const registryPath = `HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`;
const regExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
let context; let server; let brokerOwned = false; let registryMade = false;
let cdpSeq = 0;
const say = (s) => process.stdout.write(`${s}\n`);
function findBrowser() {
  const candidates = [process.env.TETHER_QA_CHROME, chromium.executablePath()];
  for (const base of [join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'), join(process.env.USERPROFILE ?? '', '.cache', 'ms-playwright')]) {
    try {
      for (const d of readdirSync(base)) {
        if (!/^(chromium|chrome)-/.test(d)) continue;
        for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
          const p = join(base, d, exe); if (existsSync(p)) candidates.push(p);
        }
      }
    } catch {}
  }
  return candidates.find(p => p && existsSync(p));
}
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
    p.Arguments="\""+@"${join(root, 'dist', 'host.js')}"+"\" \""+@"${join(local, 'host.json')}"+"\" \""+a[0]+"\"";
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
  mkdirSync(local, { recursive: true }); mkdirSync(profile, { recursive: true });
  if (!chromePath) throw Error('extension_capable_chromium_not_found_set_TETHER_QA_CHROME');
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
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath, headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`], ignoreDefaultArgs: ['--disable-extensions'] });
  const popupErrors = [];
  context.on('page', page => {
    page.on('pageerror', e => popupErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') popupErrors.push(m.text()); });
  });
  const sw = await waitFor(() => context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${id}/`)), 'extension_service_worker');
  await waitFor(async () => { const s = ps(`if (Test-Path '${join(local, 'broker-state.json')}') {(Get-Content '${join(local, 'broker-state.json')}' -Raw)} else {''}`); return s && JSON.parse(s).state === 'running'; }, 'auto_broker_start');
  brokerOwned = true;

  // Locator closure through the real extension: snapshot refs, nested-text rewrite, refusal and precise locate.
  const { BridgeClient, loadConfig } = await import(pathToFileURL(join(root, 'dist/client.js')).href);
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
  const ref = snap.tree.match(/button "\*?Deep Save" \[ref=([A-Za-z0-9]{1,64})\]/)?.[1];
  if (!ref || /- generic \[ref=[A-Za-z0-9]{1,64}\]:$/m.test(snap.tree)) throw Error('snapshot_tree_failed');
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
  if (byName.sideEffect !== 'none' || byName.error !== 'selector_not_found' || await out() !== 'xpath-ok') throw Error('unsafe_complex_selector_fallback');
  steps.complexFallbackRefused = { error: byName.error };
  const dup = await client.click({ sessionId, pageId, seq: 4, selector: '//button[text()="Dup"]' });
  if (dup.sideEffect !== 'none' || dup.error !== 'selector_ambiguous' || dup.candidates?.length !== 2 || await out() !== 'xpath-ok') throw Error('ambiguity_not_refused');
  steps.ambiguous = { error: dup.error, candidates: dup.candidates.map(c => c.actionable?.selector ?? c.selector) };
  const miss = await client.click({ sessionId, pageId, seq: 5, selector: '#absent' });
  if (miss.sideEffect !== 'none' || miss.error !== 'selector_not_found') throw Error('missing_not_refused');
  const found = await client.locate({ sessionId, pageId, role: 'button', name: 'Dup', exact: true });
  if (found.count !== 2 || !found.shown || !found.candidates.every(c => c.ref && Object.hasOwn(c, 'context') && Object.hasOwn(c, 'selectorUnique'))) throw Error('locate_contract_failed');
  const pick = await client.click({ sessionId, pageId, seq: 6, ref: found.candidates[1].ref, observe: { maxChars: 300 } });
  if (pick.sideEffect !== 'applied' || await out() !== 'dup-2') throw Error('candidate_click_failed');
  if (pick.observed !== true || pick.after?.url !== fixtureUrl || !Object.hasOwn(pick.after, 'navigated') || pick.after.tree?.length > 300) throw Error('click_observation_contract_failed');
  steps.locate = { count: found.count, shown: found.shown, truncated: found.truncated, picked: found.candidates[1].ref, observed: pick.observed };
  const filled = await client.fill({ sessionId, pageId, seq: 7, selector: '#name', value: 'secret-label-value', observe: { maxChars: 1000 } });
  if (filled.sideEffect !== 'applied' || !filled.observed || await page.inputValue('#name') !== 'secret-label-value' || JSON.stringify(filled).includes('secret-label-value')) throw Error('label_fill_echo_or_action_failed');
  steps.labelFill = { strategy: filled.strategy, valueNotEchoed: true };
  const scoped = await client.snapshot({ sessionId, pageId, scope: '#name', scopeRef: ref }).catch(e => ({error:e.message}));
  if (scoped.error !== 'invalid_params' && scoped.error !== 'scope_conflict') throw Error('scope_exclusivity_not_enforced');
  const fresh = await client.snapshot({ sessionId, pageId });
  const freshRef = fresh.tree.match(/button "\*?Deep Save" \[ref=([A-Za-z0-9]{1,64})\]/)?.[1];
  if (freshRef !== ref) throw Error('same_document_ref_unstable');
  await page.goto(`${fixtureUrl}next`);
  const stale = await client.click({ sessionId, pageId, seq: 8, ref });
  if (stale.error !== 'ref_stale' || stale.sideEffect !== 'none' || await out() !== '') throw Error('cross_document_ref_not_stale');
  steps.staleRef = { error: stale.error, sideEffect: stale.sideEffect };
  steps.scopeConflict = { error: scoped.error };
  await client.release({ sessionId, seq: 9 }); client.close();
  const mcp = new Client({ name: 'tether-usability-qa', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/mcp.js')], env: { ...process.env, BB_CLIENT_CONFIG: join(local, 'agent.json'), BB_BROWSER_WAKE: '0' }, stderr: 'pipe' });
  try {
    await mcp.connect(transport);
    const tools = (await mcp.listTools()).tools;
    if (!tools.find(t => t.name === 'snapshot')?.inputSchema.properties?.outline || !tools.find(t => t.name === 'click')?.inputSchema.properties?.observe) throw Error('mcp_schema_missing');
    const call = async (name, args) => { const r = await mcp.callTool({ name, arguments: args }); if (r.isError) throw Error(`mcp_${name}_failed`); return JSON.parse(r.content[0].text); };
    const grant = await call('requestSession', { mode: 'newGroup', url: fixtureUrl });
    const target = { sessionId: grant.sessionId, pageId: grant.pages[0].pageId };
    const tree = await call('snapshot', { ...target, outline: true });
    const scopeRef = tree.tree.match(/\[ref=([a-z0-9]+)\]/)?.[1];
    if (!scopeRef) throw Error('mcp_outline_no_ref');
    const expanded = await call('snapshot', { ...target, scopeRef });
    if (!expanded.tree) throw Error('mcp_scope_expansion_failed');
    const located = await call('locate', { ...target, selector: '#deep' });
    const clicked = await call('click', { ...target, seq: 1, ref: located.candidates[0].ref, observe: { maxChars: 500 } });
    if (clicked.sideEffect !== 'applied' || !clicked.observed) throw Error('mcp_click_observe_failed');
    const filled = await call('fill', { ...target, seq: 2, selector: '#name', value: 'mcp-secret', observe: { maxChars: 1000 } });
    if (!filled.observed || JSON.stringify(filled).includes('mcp-secret')) throw Error('mcp_fill_redaction_failed');
    await call('release', { sessionId: grant.sessionId, seq: 3 });
    steps.mcp = { tools: tools.length, outline: true, scopeRef: true, clickObserved: true, fillRedacted: true };
  } finally { await mcp.close(); }
  await ctl(hostCfg, '/control/stop'); await waitListening(p, false); brokerOwned = false;
  const report = { result: 'passed', runtime: root, extensionServiceWorker: sw.url(), nativeHost: hostName, steps };
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
