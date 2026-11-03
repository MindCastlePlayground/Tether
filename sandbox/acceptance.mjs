import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Client } from '../prototype/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../prototype/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { WebSocketServer } from '../prototype/node_modules/ws/wrapper.mjs';

const MCP = 'http://127.0.0.1:18780/mcp';
const LIMIT = 10_000;
const FIXTURE_BODY = 'sandbox-network-body-'.repeat(4200);
const passed = [];
let failed = null;
let fixture;
let client;
let transport;
let sessionId;
let fixtureUrl;

function check(condition, message) { assert.ok(condition, message); }
function resultOf(r) {
  if (r?.isError) throw new Error(`MCP tool error: ${r.content?.map(x => x.text ?? '').join('\n')}`);
  const text = r?.content?.find(x => x.type === 'text')?.text;
  if (typeof text === 'string') { try { return JSON.parse(text); } catch { return text; } }
  return r?.structuredContent ?? r;
}
async function tool(name, args = {}) { return resultOf(await client.callTool({ name, arguments: args })); }
async function tether(method, params = {}) { return tool('tether', { method, params }); }
async function evalInBrowser(code) { return tool('sandbox_eval', { code }); }
async function waitFor(fn, label) {
  const end = Date.now() + LIMIT;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`${label} timed out${last instanceof Error ? `: ${last.message}` : ''}`);
}
async function run(label, fn) {
  try { await fn(); passed.push(label); console.log(`PASS ${label}`); }
  catch (e) { failed ??= e; console.error(`FAIL ${label}\n${e.stack ?? e}`); }
}

function startFixture() {
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/large' }); res.end(); return; }
    if (req.url === '/large') { res.writeHead(200, { 'content-type': 'text/plain', 'x-fixture': 'linux-sandbox' }); res.end(FIXTURE_BODY); return; }
    if (req.url === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ fixture: true })); return; }
    if (req.url === '/post' && req.method === 'POST') {
      let data = ''; req.setEncoding('utf8'); req.on('data', x => data += x);
      req.on('end', () => { res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ received: data })); }); return;
    }
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('data: fixture-sse\n\n'); const timer = setTimeout(() => res.end(), 800); req.on('close', () => clearTimeout(timer)); return;
    }
    if (req.url === '/ws') return;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Tether sandbox fixture</title><h1>Fixture ready</h1><form><label>Query <input id="query" name="query"></label><button id="change" type="button">Change DOM</button></form><output id="state">idle</output><button id="fetch" type="button">Fetch JSON</button><button id="send" type="button">Send POST</button><button id="redirect" type="button">Fetch redirect</button><button id="sse" type="button">Open SSE</button><button id="socket" type="button">Open WebSocket</button><script>
      change.onclick=()=>state.textContent='changed';
      document.querySelector('#fetch').onclick=()=>window.fetch('/json').then(r=>r.json()).then(x=>state.textContent=x.fixture?'json-ok':'json-failed');
      send.onclick=()=>window.fetch('/post',{method:'POST',headers:{'content-type':'text/plain'},body:'fixture-post-data'}).then(r=>r.json()).then(x=>state.textContent=x.received);
      redirect.onclick=()=>window.fetch('/redirect').then(r=>r.text()).then(x=>state.textContent=x.slice(0,12));
      sse.onclick=()=>{const e=new EventSource('/events');e.onmessage=x=>{state.textContent=x.data;e.close()}};
      socket.onclick=()=>{const w=new WebSocket('ws://127.0.0.1:'+location.port+'/ws');w.onopen=()=>w.send('fixture-ws');w.onmessage=x=>{state.textContent=x.data;w.close()}};
    </script>`);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => { wss.emit('connection', ws, req); ws.on('message', data => ws.send(`echo:${data}`)); });
  });
  return { server, wss };
}

async function main() {
  await waitFor(async () => (await fetch('http://127.0.0.1:18780/health', { signal: AbortSignal.timeout(1000) })).ok, 'MCP startup');
  const token = (await readFile('/data/mcp-token', 'utf8')).trim();
  check(token.length > 0, 'MCP token file is empty');
  transport = new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  client = new Client({ name: 'tether-sandbox-acceptance', version: '1.0.0' });
  await client.connect(transport);
  await run('MCP tools, container exec and files', async () => {
    const tools = await client.listTools();
    for (const name of ['sandbox_status', 'sandbox_browser', 'sandbox_exec', 'sandbox_files', 'sandbox_eval', 'tether']) check(tools.tools.some(x => x.name === name), `missing MCP tool ${name}`);
    const status = await waitFor(async () => { const s = await tool('sandbox_status'); return s.broker?.browserConnected && s.browser === 'running' ? s : null; }, 'browser startup');
    check(status && typeof status === 'object', 'sandbox_status returned no status object');
    const extensionId = status.extensionId ?? status.browser?.extensionId;
    check(typeof extensionId === 'string' && extensionId.length > 0, 'status did not provide extensionId');
    const exec = await tool('sandbox_exec', { command: 'printf tether-exec-ok' });
    check((exec.stdout ?? exec.output ?? '').includes('tether-exec-ok') && (exec.code ?? exec.exitCode) === 0, `sandbox_exec failed: ${JSON.stringify(exec)}`);
    const path = '/tmp/tether-acceptance.txt';
    await tool('sandbox_files', { op: 'write', path, content: 'tether-files-ok' });
    const read = await tool('sandbox_files', { op: 'read', path });
    check((read.content ?? read.text ?? '').includes('tether-files-ok'), `sandbox_files read mismatch: ${JSON.stringify(read)}`);
    const list = await tool('sandbox_files', { op: 'list', path: '/tmp' });
    check(JSON.stringify(list).includes('tether-acceptance.txt'), 'sandbox_files list missed fixture file');
    fixture = startFixture();
    await new Promise((resolve, reject) => { fixture.server.once('error', reject); fixture.server.listen(0, '0.0.0.0', resolve); });
    fixtureUrl = `http://127.0.0.1:${fixture.server.address().port}`;
    fixture.wss.on('error', e => { throw e; });
    check(extensionId.length >= 8, 'extension id shape invalid');
  });
  await run('real toolbar popup, extension storage and automatic-approval control', async () => {
    const status = await tool('sandbox_status');
    const extensionId = status.extensionId;
    await evalInBrowser(`const w=context.serviceWorkers().find(w=>w.url().includes('${extensionId}')); if(!w)throw Error('worker missing'); await w.evaluate(()=>chrome.action.openPopup());`);
    const targets = await tool('sandbox_cdp', { method:'Target.getTargets' });
    const popup = targets.targetInfos.find(t=>t.url === `chrome-extension://${extensionId}/popup.html`);
    check(popup, 'real toolbar popup target missing');
    const r = await tool('sandbox_cdp', { targetId:popup.targetId, method:'Runtime.evaluate', params:{awaitPromise:true,returnByValue:true,expression:`(async()=>{
      const until=Date.now()+5000;
      while(!document.querySelector('.toggle-item input[type=checkbox]')?.checked && Date.now()<until) await new Promise(r=>setTimeout(r,100));
      const auto=()=>document.querySelector('.toggle-item input[type=checkbox]');
      if(!auto()?.checked)throw Error('auto approval default not ready');
      auto().click(); await new Promise(r=>setTimeout(r,300));
      const off=await chrome.storage.local.get('autoApprove');
      if(off.autoApprove!==false)throw Error('toggle off not persisted');
      auto().click(); await new Promise(r=>setTimeout(r,300));
      const on=await chrome.storage.local.get('autoApprove');
      if(on.autoApprove!==true)throw Error('toggle on not persisted');
      return {ready:true};
    })()`}});
    check(r.result?.value?.ready === true, JSON.stringify(r));
    await tool('sandbox_cdp',{method:'Target.closeTarget',params:{targetId:popup.targetId}});
  });
  await run('session auto-approval, tab listing, snapshot, fill, click, navigate and tab lifecycle', async () => {
    const granted = await tether('requestSession', { mode: 'newGroup', url: fixtureUrl });
    check(granted.status === 'approved' && granted.sessionId, `session was not auto-approved: ${JSON.stringify(granted)}`);
    sessionId = granted.sessionId;
    const tabs = await tether('listTabs', { sessionId });
    const pages = tabs.pages ?? tabs.tabs ?? tabs;
    check(Array.isArray(pages) && pages.length >= 1, `listTabs returned no pages: ${JSON.stringify(tabs)}`);
    let page = pages.find(x => x.pageId && (x.url ?? '').startsWith(fixtureUrl)) ?? pages.find(x => x.pageId);
    check(page?.pageId, `no pageId in tabs: ${JSON.stringify(tabs)}`);
    let snap = await tether('snapshot', { sessionId, pageId: page.pageId });
    check(JSON.stringify(snap).includes('Fixture ready'), `snapshot missed fixture: ${JSON.stringify(snap).slice(0,1000)}`);
    const fill = await tether('fill', { sessionId, pageId: page.pageId, seq: 1, selector: '#query', value: 'sandbox-query' });
    check(fill.sideEffect === 'applied', `fill failed: ${JSON.stringify(fill)}`);
    const click = await tether('click', { sessionId, pageId: page.pageId, seq: 2, selector: '#change' });
    check(click.sideEffect === 'applied', `click failed: ${JSON.stringify(click)}`);
    const observe = await tether('snapshot', { sessionId, pageId: page.pageId });
    check(JSON.stringify(observe).includes('changed'), `DOM click had no effect: ${JSON.stringify(observe)}`);
    const created = await tether('createTab', { sessionId, seq: 3, url: fixtureUrl });
    const secondId = created.pageId;
    check(secondId && secondId !== page.pageId, `createTab failed: ${JSON.stringify(created)}`);
    const nav = await tether('navigate', { sessionId, pageId: secondId, seq: 4, url: `${fixtureUrl}/json` });
    check(nav.sideEffect === 'applied', `navigate failed: ${JSON.stringify(nav)}`);
    const secondTabs = await tether('listTabs', { sessionId });
    check(JSON.stringify(secondTabs).includes('/json'), 'navigated tab missing from listTabs');
    await tether('closeTab', { sessionId, pageId: secondId, seq: 5 });
    const closed = await tether('listTabs', { sessionId });
    check(!(closed.pages ?? closed.tabs ?? []).some(x => x.pageId === secondId), 'closed tab still appears');
    const all = await tether('availableTabs');
    check(Array.isArray(all.tabs), `availableTabs shape unexpected: ${JSON.stringify(all)}`);
  });
  await run('network capture for JSON, POST, redirect, SSE, WebSocket, body pagination and clear', async () => {
    const tabs = await tether('listTabs', { sessionId });
    const page = (tabs.pages ?? tabs.tabs).find(x => (x.url ?? '').startsWith(fixtureUrl));
    check(page?.pageId, `fixture page missing: ${JSON.stringify(tabs)}`);
    const pageId = page.pageId;
    const started = await tether('network', { sessionId, pageId, op: 'start' });
    check(started.active === true, `network start failed: ${JSON.stringify(started)}`);
    for (const selector of ['#fetch', '#send', '#redirect', '#sse', '#socket']) {
      const seq = selector === '#fetch' ? 6 : selector === '#send' ? 7 : selector === '#redirect' ? 8 : selector === '#sse' ? 9 : 10;
      await tether('click', { sessionId, pageId, seq, selector });
      await new Promise(r => setTimeout(r, selector === '#sse' ? 900 : 350));
    }
    const list = await waitFor(async () => {
      const x = await tether('network', { sessionId, pageId, op: 'list', limit: 100 });
      return (x.requests ?? []).some(y => y.url?.endsWith('/ws')) && (x.requests ?? []).some(y => y.url?.endsWith('/events')) ? x : null;
    }, 'network records');
    const rows = list.requests;
    const post = rows.find(x => x.url.endsWith('/post'));
    const hops = rows.filter(x => x.url.endsWith('/redirect') || x.url.endsWith('/large'));
    const ws = rows.find(x => x.url.endsWith('/ws'));
    const sse = rows.find(x => x.url.endsWith('/events'));
    check(post?.finished && post.status === 201, `POST not captured: ${JSON.stringify(post)}`);
    const detail = await tether('network', { sessionId, pageId, op: 'detail', requestId: post.requestId });
    check((detail.request?.request?.postData ?? '').includes('fixture-post-data'), `POST body not captured: ${JSON.stringify(detail)}`);
    check(hops.length === 2 && hops.some(x => x.status === 302) && hops.some(x => x.status === 200), `redirect hops missing: ${JSON.stringify(hops)}`);
    const wsDetail = ws && await tether('network', { sessionId, pageId, op: 'detail', requestId: ws.requestId });
    const sseDetail = sse && await tether('network', { sessionId, pageId, op: 'detail', requestId: sse.requestId });
    check(wsDetail?.request.events.some(e => e.method === 'Network.webSocketFrameReceived'), `WebSocket events missing: ${JSON.stringify(wsDetail)}`);
    check(sseDetail?.request.events.some(e => e.method === 'Network.eventSourceMessageReceived'), `SSE events missing: ${JSON.stringify(sseDetail)}`);
    const final = hops.find(x => x.url.endsWith('/large'));
    let body = '', offset = 0;
    do {
      const chunk = await tether('network', { sessionId, pageId, op: 'body', requestId: final.requestId, offset, maxChars: 28000 });
      body += chunk.body; offset = chunk.nextOffset;
    } while (offset !== null);
    check(body === FIXTURE_BODY, `response body mismatch (${body.length}/${FIXTURE_BODY.length})`);
    const pageList2 = await tether('network', { sessionId, pageId, op: 'list', offset: 1, limit: 2 });
    check(pageList2.offset === 1 && pageList2.requests.length === 2, `network pagination failed: ${JSON.stringify(pageList2)}`);
    await tether('network', { sessionId, pageId, op: 'stop' });
    const clear = await tether('network', { sessionId, pageId, op: 'clear' });
    check(clear.count === 0, `network clear failed: ${JSON.stringify(clear)}`);
  });
  await run('dialogs, popups, iframe, upload, download, screenshot and direct CDP', async () => {
    const result = await evalInBrowser(`
      const p = await context.newPage();
      await p.goto(${JSON.stringify(fixtureUrl)});
      await p.setContent('<input type=file id=file><button id=dialog>Dialog</button><a id=download download="sample.txt">Download</a><iframe srcdoc="<button>Frame button</button>"></iframe>');
      await p.locator('#dialog').evaluate(el=>el.onclick=()=>document.body.dataset.answer=String(confirm('continue?')));
      await p.locator('#file').setInputFiles({name:'upload.txt',mimeType:'text/plain',buffer:Buffer.from('upload-ok')});
      const upload = await p.locator('#file').evaluate(el=>el.files[0].text());
      p.once('dialog',d=>d.accept()); await p.locator('#dialog').click();
      const answer=await p.locator('body').getAttribute('data-answer');
      await p.frameLocator('iframe').getByRole('button').click();
      const popupWait=context.waitForEvent('page');
      await p.evaluate(()=>window.open('about:blank')); const popup=await popupWait;
      await popup.close();
      await p.locator('#download').evaluate(el=>el.href=URL.createObjectURL(new Blob(['download-ok'],{type:'text/plain'})));
      const downloadWait=p.waitForEvent('download');await p.locator('#download').click();const download=await downloadWait;
      await download.saveAs('/data/acceptance-download.txt');
      const cdp=await context.newCDPSession(p);const dom=await cdp.send('DOM.getDocument');await cdp.detach();
      return {upload,answer,download:download.suggestedFilename(),dom:dom.root.nodeName};
    `);
    check(result.upload === 'upload-ok' && result.answer === 'true' && result.download === 'sample.txt' && result.dom === '#document', JSON.stringify(result));
    const file = await tool('sandbox_files', { op:'read', path:'/data/acceptance-download.txt' });
    check(file.content === 'download-ok', 'download content mismatch');
    const shot = await client.callTool({name:'sandbox_screenshot',arguments:{}});
    check(shot.content.some(x=>x.type==='image' && x.mimeType==='image/png' && x.data.length>100), 'screenshot missing');
  });
  await run('browser restart, reacquire session and reset test profile', async () => {
    await tool('sandbox_files', { op:'write',path:'/data/extensions/acceptance/manifest.json',content:JSON.stringify({manifest_version:3,name:'Acceptance extension',version:'1.0',content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js']}]}) });
    await tool('sandbox_files', { op:'write',path:'/data/extensions/acceptance/content.js',content:"document.documentElement.dataset.sandboxExtension='loaded';" });
    const stopped = await tool('sandbox_browser', { op: 'restart', extensions:['/data/extensions/acceptance'] });
    check(stopped && typeof stopped === 'object', 'browser restart returned no status');
    const status = await waitFor(async () => {
      const x = await tool('sandbox_status');
      const state = typeof x.browser === 'string' ? x.browser : x.browser?.state ?? x.state;
      return state === 'running' || x.browser?.running === true || x.running === true ? x : null;
    }, 'browser restart');
    const extensionId = status.extensionId ?? status.browser?.extensionId;
    check(extensionId, 'extension ID missing after browser restart');
    const again = await tether('requestSession', { mode: 'newGroup', url: fixtureUrl });
    check(again.status === 'approved' && again.sessionId, `session after restart failed: ${JSON.stringify(again)}`);
    sessionId = again.sessionId;
    const tabs = await tether('listTabs', { sessionId });
    check((tabs.pages ?? tabs.tabs ?? []).length > 0, 'no pages after restart session');
    const addon = await evalInBrowser(`const p=context.pages().find(p=>p.url().startsWith(${JSON.stringify(fixtureUrl)})); await p.waitForFunction(()=>document.documentElement.dataset.sandboxExtension==='loaded');return true;`);
    check(addon === true, 'extra unpacked extension was not loaded');
    await tether('release', { sessionId, seq: 11 });
    sessionId = null;
    const reset = await tool('sandbox_browser', { op: 'reset', extensions:[] });
    check(reset && typeof reset === 'object', 'browser reset returned no status');
  });
}

try {
  await main();
} catch (e) {
  failed ??= e;
  console.error(`FAIL runner\n${e.stack ?? e}`);
} finally {
  if (sessionId && client) {
    try { await tether('release', { sessionId, seq: 999 }); } catch (e) { console.error(`CLEANUP session: ${e.message}`); }
  }
  try { await client?.close(); } catch (e) { console.error(`CLEANUP client: ${e.message}`); }
  try { await transport?.close(); } catch (e) { console.error(`CLEANUP transport: ${e.message}`); }
  if (fixture) {
    for (const c of fixture.wss.clients) c.terminate();
    await new Promise(resolve => fixture.wss.close(() => fixture.server.close(() => resolve())));
  }
  console.log(`SUMMARY ${passed.length} passed, ${failed ? 1 : 0} failed`);
}
if (failed) process.exitCode = 1;
