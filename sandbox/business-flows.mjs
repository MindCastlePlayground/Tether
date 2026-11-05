import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '../prototype/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../prototype/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { startBusiness } from './business-fixture.mjs';

const MCP = 'http://127.0.0.1:18780/mcp';
const DOC_NAME = 'yard-note-2026.txt';
const DOC_BODY = `BIZDOC-START\n${'yard-line-07\n'.repeat(4000)}BIZDOC-END\n`;
const INVOICE = 'invoice-vendor-19\nline-two\n';
const results = [];
let client;
let auxClient;
let business;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function textOf(result) { return result?.content?.map(item => item.text ?? '').join('\n') ?? ''; }
async function call(active, name, args = {}) {
  const result = await active.callTool({ name, arguments: args });
  if (result?.isError) throw Error(textOf(result).slice(0, 2500));
  const text = result?.content?.find(item => item.type === 'text')?.text;
  if (typeof text === 'string') { try { return JSON.parse(text); } catch { return text; } }
  return result?.structuredContent ?? result;
}
const tool = (name, args) => call(client, name, args);
const tether = (method, params = {}) => tool('tether', { method, params });
const aux = (method, params = {}) => call(auxClient, 'tether', { method, params });
async function connect(name) {
  const token = (await readFile('/data/mcp-token', 'utf8')).trim();
  if (!token) throw Error('empty mcp token file');
  const transport = new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const created = new Client({ name, version: '1.0.0' });
  await created.connect(transport);
  return created;
}
async function waitFor(fn, label, timeout = 12000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (error) { last = error; }
    await sleep(200);
  }
  const detail = last instanceof Error ? last.message : JSON.stringify(last).slice(0, 500);
  throw Error(`${label} timed out${detail ? `: ${detail}` : ''}`);
}
function refFor(tree, role, name) {
  const needle = `- ${role} "${name}"`;
  for (const line of String(tree ?? '').split('\n')) {
    if (!line.includes(needle)) continue;
    const match = line.match(/\[ref=([a-z0-9]+)\]/);
    if (match) return match[1];
  }
  throw Error(`missing ref ${role} ${name}; tree ${String(tree).slice(0, 700)}`);
}
async function dom(urlPart, expression) {
  return tool('sandbox_eval', { code: `const page = context.pages().find(item => item.url().includes(${JSON.stringify(urlPart)})); if (!page) throw Error('page missing'); return await page.evaluate(${expression});` });
}
async function openSession(ctx, url) {
  const granted = await tether('requestSession', { mode: 'newGroup', url });
  if (granted.status !== 'approved' || !granted.sessionId) throw Error(`session not approved ${JSON.stringify(granted).slice(0, 400)}`);
  ctx.sessionId = granted.sessionId;
  ctx.seq = 0;
  const tabs = await tether('listTabs', { sessionId: ctx.sessionId });
  const pages = tabs.pages ?? [];
  const page = pages.find(item => (item.url || '').startsWith(url)) ?? pages[0];
  if (!page?.pageId) throw Error(`no page ${JSON.stringify(tabs).slice(0, 400)}`);
  ctx.pageId = page.pageId;
}
async function snap(ctx) { return tether('snapshot', { sessionId: ctx.sessionId, pageId: ctx.pageId }); }
async function fill(ctx, selector, value, ref = false) {
  const result = await tether('fill', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, ...(ref ? { ref: selector } : { selector }), value });
  if (result.sideEffect !== 'applied') throw Error(`fill ${selector} failed ${JSON.stringify(result).slice(0, 600)}`);
  return result;
}
async function click(ctx, selector, ref = false) {
  const result = await tether('click', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, ...(ref ? { ref: selector } : { selector }) });
  if (result.sideEffect !== 'applied') throw Error(`click ${selector} failed ${JSON.stringify(result).slice(0, 600)}`);
  return result;
}
async function upload(ctx, selector, name, mime, text) {
  const bytes = Buffer.from(text);
  const started = await tether('uploadStart', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, files: [{ name, mimeType: mime, size: bytes.length }] });
  if (!started.uploadId || !started.chunkBytes) throw Error(`upload start failed ${JSON.stringify(started).slice(0, 300)}`);
  let offset = 0;
  while (offset < bytes.length) {
    const part = bytes.subarray(offset, offset + started.chunkBytes);
    const chunk = await tether('uploadChunk', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, uploadId: started.uploadId, fileIndex: 0, offset, data: part.toString('base64') });
    if (chunk.nextOffset !== offset + part.length) throw Error(`chunk offset ${JSON.stringify(chunk)}`);
    offset = chunk.nextOffset;
  }
  const finished = await tether('uploadFinish', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, uploadId: started.uploadId, selector });
  if (finished.sideEffect !== 'applied') throw Error(`upload finish failed ${JSON.stringify(finished).slice(0, 400)}`);
}
async function download(ctx, url) {
  const started = await tether('downloadStart', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, url });
  if (!started.downloadId) throw Error(`download start failed ${JSON.stringify(started).slice(0, 300)}`);
  const parts = [];
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    const chunk = await tether('downloadRead', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, downloadId: started.downloadId, offset });
    if (chunk.data) parts.push(Buffer.from(chunk.data, 'base64'));
    if (chunk.done) return { name: started.name, text: Buffer.concat(parts).toString('utf8') };
    if (chunk.nextOffset === offset) throw Error('download did not advance');
    offset = chunk.nextOffset;
  }
  throw Error('download did not finish');
}
async function clickDialog(ctx, selector, action, promptText) {
  const clickPromise = tether('click', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, selector });
  let found;
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const listed = await aux('dialog', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, action: 'list' });
    found = (listed.dialogs ?? []).find(item => item.type === (promptText === undefined ? 'confirm' : 'prompt'));
    if (found) break;
    await sleep(150);
  }
  if (!found) {
    const click = await Promise.race([clickPromise, sleep(500).then(() => null)]);
    throw Error(`dialog missing click=${JSON.stringify(click).slice(0, 300)}`);
  }
  const handled = await aux('dialog', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, action, dialogId: found.id, ...(promptText !== undefined ? { promptText } : {}) });
  if (handled.sideEffect !== 'applied') throw Error(`dialog handle failed ${JSON.stringify(handled)}`);
  const click = await clickPromise;
  if (click.sideEffect !== 'applied') throw Error(`dialog click failed ${JSON.stringify(click).slice(0, 400)}`);
  return found;
}
async function scenario(name, fn) {
  const selected = process.env.TETHER_BUSINESS_SCENARIOS?.split(',');
  if (selected && !selected.includes(name)) return;
  const ctx = { sessionId: null, pageId: null, seq: 0 };
  const started = Date.now();
  let failure;
  try { await fn(ctx); }
  catch (error) { failure = error; }
  finally {
    if (ctx.sessionId) {
      try {
        const tabs = await tether('listTabs', { sessionId: ctx.sessionId });
        for (const page of tabs.pages ?? []) await tether('closeTab', { sessionId: ctx.sessionId, pageId: page.pageId, seq: ++ctx.seq });
      } catch (error) { failure ??= error; }
      try { await tether('release', { sessionId: ctx.sessionId, seq: ++ctx.seq }); }
      catch (error) { failure ??= error; }
    }
  }
  results.push({ name, ok: !failure, ms: Date.now() - started, ...(failure ? { error: String(failure.stack || failure).slice(0, 2000) } : {}) });
  if (failure) console.error(`FAIL ${name}\n${failure.stack || failure}`);
  else console.log(`PASS ${name} ${Date.now() - started}ms`);
}
async function ensureBrowser() {
  await waitFor(async () => (await fetch('http://127.0.0.1:18780/health', { signal: AbortSignal.timeout(1000) })).ok, 'mcp health', 20000);
  await tool('sandbox_browser', { op: 'stop' });
  await tool('sandbox_exec', { command: 'ps -eo pid,args | awk \'/dist\\/broker[.]js/ && !/awk/ {print $1}\' | while read -r pid; do kill "$pid"; done; sleep 0.4; echo broker-stopped' });
  await tool('sandbox_browser', { op: 'start' });
  const status = await waitFor(async () => {
    const current = await tool('sandbox_status');
    return current.broker?.browserConnected && current.browser === 'running' ? current : null;
  }, 'browser bridge', 25000);
  const extensionId = status.extensionId;
  if (!extensionId) throw Error('extension id missing');
  const stored = await waitFor(async () => tool('sandbox_eval', { code: `const worker = context.serviceWorkers().find(item => item.url().includes(${JSON.stringify(extensionId)})); if (!worker) return null; return await worker.evaluate(() => chrome.storage.local.get('autoApprove'));` }), 'service worker', 15000);
  if (stored?.autoApprove === false) {
    await tool('sandbox_eval', { code: `const worker = context.serviceWorkers().find(item => item.url().includes(${JSON.stringify(extensionId)})); await worker.evaluate(() => chrome.storage.local.set({ autoApprove: true })); return true;` });
    await tool('sandbox_browser', { op: 'restart' });
    await waitFor(async () => {
      const current = await tool('sandbox_status');
      return current.broker?.browserConnected ? current : null;
    }, 'browser after approval restore', 25000);
  }
}

async function main() {
  client = await connect('tether-business-flows');
  auxClient = await connect('tether-business-dialogs');
  await ensureBrowser();
  business = await startBusiness();
  const root = business.url;

  await scenario('cart', async ctx => {
    await openSession(ctx, `${root}/shop`);
    await fill(ctx, '#q', 'desk');
    await click(ctx, '#search');
    await waitFor(async () => (await snap(ctx)).tree?.includes('Add Desk Lamp') ? true : null, 'lamp result');
    await click(ctx, '#add-LAMP-02');
    await fill(ctx, '#q', 'mug');
    await click(ctx, '#search');
    await waitFor(async () => (await snap(ctx)).tree?.includes('Add Clay Mug') ? true : null, 'mug result');
    await click(ctx, '#add-MUG-03');
    await fill(ctx, '#qty-LAMP-02', '3');
    await click(ctx, '#update-LAMP-02');
    await fill(ctx, '#qty-MUG-03', '2');
    await click(ctx, '#update-MUG-03');
    await click(ctx, '#checkout');
    await waitFor(async () => business.store.orders.length === 1 ? true : null, 'order record');
    const order = business.store.orders[0];
    if (order.total !== '162.50' || order.totalCents !== 16250) throw Error(`total ${order.total} ${order.totalCents}`);
    if (order.items.map(item => `${item.sku}:${item.qty}`).join(',') !== 'LAMP-02:3,MUG-03:2') throw Error(`items ${JSON.stringify(order.items)}`);
    const text = await waitFor(async () => {
      const value = await dom('/shop', '() => document.querySelector("#order-result").textContent');
      return value === `order:${order.id} total:162.50` ? value : null;
    }, 'order confirmation');
    if (text !== `order:${order.id} total:162.50`) throw Error(`dom order ${text}`);
  });

  await scenario('profile', async ctx => {
    await openSession(ctx, `${root}/account`);
    await fill(ctx, '#display', 'Avery North');
    await fill(ctx, '#department', 'Field Desk');
    await fill(ctx, '#phone', '555-0142');
    await click(ctx, '#save');
    await waitFor(async () => business.store.profile?.displayName === 'Avery North' ? true : null, 'profile save');
    await tether('navigate', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, url: `${root}/account` });
    const values = await waitFor(async () => {
      const read = await dom('/account', '() => ({ display: document.querySelector("#display").value, department: document.querySelector("#department").value, phone: document.querySelector("#phone").value, account: document.querySelector("#account").value, result: document.querySelector("#profile-result").textContent })');
      return read?.display === 'Avery North' ? read : null;
    }, 'profile reload');
    if (values.department !== 'Field Desk' || values.phone !== '555-0142' || values.account !== 'biz-test-7' || values.result !== 'loaded:Avery North') throw Error(JSON.stringify(values));
    if (JSON.stringify(business.store.profile) !== JSON.stringify({ accountId: 'biz-test-7', displayName: 'Avery North', department: 'Field Desk', phone: '555-0142' })) throw Error('profile store mismatch');
  });

  await scenario('ticket', async ctx => {
    await openSession(ctx, `${root}/tickets`);
    await fill(ctx, '#title', 'Dock gate stuck');
    await fill(ctx, '#body', 'Gate B stays open after the shift change.');
    await fill(ctx, '#priority', 'high');
    await click(ctx, '#create');
    await fill(ctx, '#title', 'Spare lamp');
    await fill(ctx, '#body', 'Need a spare lamp for bay 4.');
    await fill(ctx, '#priority', 'low');
    await click(ctx, '#create');
    await waitFor(async () => business.store.tickets.length === 2 ? true : null, 'tickets created');
    await fill(ctx, '#ticket-id', 'T-1');
    await fill(ctx, '#next-status', 'done');
    await click(ctx, '#apply-status');
    await click(ctx, '#filter-done');
    const view = await waitFor(async () => {
      const text = await dom('/tickets', '() => ({ list: document.querySelector("#ticket-list").textContent, history: document.querySelector("#ticket-history").textContent, filter: document.querySelector("#filter-result").textContent })');
      return text?.list === 'T-1|done|Dock gate stuck' ? text : null;
    }, 'filtered tickets');
    if (!view.history.includes('T-1:open>done') || !view.filter.includes('count:1')) throw Error(JSON.stringify(view));
    const openTicket = business.store.tickets.find(item => item.id === 'T-2');
    const doneTicket = business.store.tickets.find(item => item.id === 'T-1');
    if (openTicket.status !== 'open' || doneTicket.status !== 'done' || doneTicket.history.map(item => `${item.from}>${item.to}`).join(',') !== 'none>open,open>done') throw Error(JSON.stringify(business.store.tickets));
  });

  await scenario('booking', async ctx => {
    await openSession(ctx, `${root}/book`);
    await waitFor(async () => (await dom('/book', '() => document.querySelector("#state-afternoon").textContent')) === 'afternoon:open' ? true : null, 'open slot');
    await fill(ctx, '#contact', 'Riley Chen');
    await click(ctx, '#book');
    await waitFor(async () => business.store.bookings[0]?.status === 'booked' ? true : null, 'booking stored');
    const booking = business.store.bookings[0];
    if (booking.contact !== 'Riley Chen' || booking.slot !== 'afternoon' || booking.date !== '2026-11-20' || business.store.slots[booking.date].afternoon !== booking.id) throw Error(JSON.stringify(booking));
    if (business.store.slots[booking.date].morning !== 'open' || business.store.slots[booking.date].evening !== 'open') throw Error('other slots changed');
    const bookedText = await waitFor(async () => {
      const value = await dom('/book', '() => document.querySelector("#book-result").textContent');
      return value === `booked:${booking.id}` ? value : null;
    }, 'booking confirmation');
    if (bookedText !== `booked:${booking.id}`) throw Error(bookedText);
    await click(ctx, '#cancel');
    await waitFor(async () => business.store.bookings[0].status === 'cancelled' && business.store.slots[booking.date].afternoon === 'open' ? true : null, 'booking cancelled');
    const cancelled = await waitFor(async () => {
      const value = await dom('/book', '() => ({ result: document.querySelector("#book-result").textContent, slot: document.querySelector("#state-afternoon").textContent })');
      return value?.result === `cancelled:${booking.id}` && value?.slot === 'afternoon:open' ? value : null;
    }, 'cancel confirmation');
    if (cancelled.result !== `cancelled:${booking.id}` || cancelled.slot !== 'afternoon:open') throw Error(JSON.stringify(cancelled));
  });

  await scenario('table', async ctx => {
    await openSession(ctx, `${root}/ledger?owner=north&page=1`);
    const first = await snap(ctx);
    if (!first.tree.includes('L-003:open') || first.tree.includes('L-042')) throw Error(`unexpected first page ${first.tree.slice(0, 400)}`);
    await click(ctx, '#next');
    await waitFor(async () => (await dom('/ledger', '() => location.search + document.querySelector("#label-L-042")?.textContent')).includes('L-042:open') ? true : null, 'second page');
    await fill(ctx, '#status-L-042', 'approved');
    await click(ctx, '#save-L-042');
    await waitFor(async () => business.store.ledger.find(row => row.id === 'L-042')?.status === 'approved' ? true : null, 'row update');
    const changed = business.store.ledger.filter((row, index) => row.status !== business.store.ledgerBaseline[index].status);
    if (changed.length !== 1 || changed[0].id !== 'L-042' || changed[0].status !== 'approved') throw Error(`rows changed ${JSON.stringify(changed)}`);
    const label = await waitFor(async () => {
      const value = await dom('/ledger', '() => document.querySelector("#label-L-042").textContent');
      return value === 'L-042:approved' ? value : null;
    }, 'row label');
    if (label !== 'L-042:approved') throw Error(label);
    if (business.store.ledger.find(row => row.id === 'L-003').status !== 'open') throw Error('neighbor changed');
  });

  await scenario('files', async ctx => {
    await openSession(ctx, `${root}/docs`);
    await upload(ctx, '#doc', DOC_NAME, 'text/plain', DOC_BODY);
    await fill(ctx, '#doc-title', 'Yard handoff');
    await click(ctx, '#submit-doc');
    const doc = await waitFor(async () => business.store.docs[0], 'stored document');
    if (doc.name !== DOC_NAME || doc.title !== 'Yard handoff' || doc.text !== DOC_BODY) throw Error(`stored name=${doc.name} bytes=${doc.text?.length}`);
    const shown = await dom('/docs', '() => document.querySelector("#doc-result").textContent + " " + document.querySelector("#file-url").textContent');
    if (!shown.includes(`stored:${doc.id} name:${DOC_NAME}`) || !shown.includes(`/api/docs/${doc.id}/file`)) throw Error(shown);
    const downloaded = await download(ctx, `/api/docs/${doc.id}/file`);
    if (downloaded.name !== DOC_NAME || downloaded.text !== DOC_BODY) throw Error(`download name=${downloaded.name} bytes=${downloaded.text.length}`);
  });

  await scenario('dialog', async ctx => {
    await openSession(ctx, `${root}/prompts`);
    const prompt = await clickDialog(ctx, '#rename', 'accept', 'north-batch-19');
    if (prompt.type !== 'prompt') throw Error(prompt.type);
    await waitFor(async () => business.store.dialogs.some(item => item.action === 'rename' && item.name === 'north-batch-19') ? true : null, 'rename stored');
    const renamed = await dom('/prompts', '() => document.querySelector("#dialog-result").textContent');
    if (renamed !== 'renamed:north-batch-19') throw Error(renamed);
    await clickDialog(ctx, '#discard', 'dismiss');
    const kept = await waitFor(async () => {
      const text = await dom('/prompts', '() => document.querySelector("#dialog-result").textContent');
      return text === 'cancel-kept' ? text : null;
    }, 'cancel branch');
    if (kept !== 'cancel-kept') throw Error(kept);
    if (business.store.dialogs.some(item => item.action === 'discard') || business.store.dialogs.length !== 1) throw Error(JSON.stringify(business.store.dialogs));
  });

  await scenario('popup', async ctx => {
    await openSession(ctx, `${root}/orders`);
    const opener = ctx.pageId;
    await click(ctx, '#open-detail');
    const candidate = await waitFor(async () => {
      const listed = await tether('popupCandidates', { sessionId: ctx.sessionId });
      return (listed.tabs ?? []).find(item => (item.url || '').includes('/orders/detail') && item.openerPageId === opener);
    }, 'popup candidate');
    const adopted = await tether('adoptPopup', { sessionId: ctx.sessionId, seq: ++ctx.seq, openerPageId: candidate.openerPageId, tabId: candidate.tabId });
    if (!adopted.pageId) throw Error(`adopt failed ${JSON.stringify(adopted).slice(0, 300)}`);
    ctx.pageId = adopted.pageId;
    const detail = await dom('/orders/detail', '() => document.querySelector("#detail-sku").textContent');
    if (detail !== 'LAMP-02') throw Error(detail);
    await fill(ctx, '#note', 'dock-3');
    await click(ctx, '#save-note');
    await waitFor(async () => business.store.deskOrder.note === 'dock-3' ? true : null, 'note stored');
    const detailText = await dom('/orders/detail', '() => document.querySelector("#detail-result").textContent');
    if (detailText !== 'detail:dock-3') throw Error(detailText);
    await tether('closeTab', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq });
    ctx.pageId = opener;
    const tabs = await tether('listTabs', { sessionId: ctx.sessionId });
    if ((tabs.pages ?? []).some(item => item.pageId === adopted.pageId)) throw Error('popup still listed');
    await click(ctx, '#reload-order');
    const main = await waitFor(async () => {
      const text = await dom('/orders', '() => document.querySelector("#main-note").textContent');
      return text === 'note:dock-3' ? text : null;
    }, 'main note');
    if (main !== 'note:dock-3') throw Error(main);
  });

  await scenario('iframe', async ctx => {
    await openSession(ctx, `${root}/portal`);
    await waitFor(async () => dom('/portal', '() => [...document.querySelectorAll("iframe")].some(frame => frame.src.includes("/form"))') , 'iframe element');
    await sleep(300);
    const targets = await tool('sandbox_cdp', { method: 'Target.getTargets' });
    if (!targets.targetInfos.some(item => item.type === 'iframe' && item.url.startsWith(business.vendorUrl + '/'))) throw Error('vendor iframe is not out of process');
    await fill(ctx, 'frame=iframe#vendor >> #company', 'North Dock Supply');
    await fill(ctx, 'frame=iframe#vendor >> #amount', '1840');
    await fill(ctx, 'frame=iframe#vendor >> #memo', 'gate hardware');
    await upload(ctx, 'frame=iframe#vendor >> #invoice', 'invoice-19.txt', 'text/plain', INVOICE);
    await click(ctx, 'frame=iframe#vendor >> #send-intake');
    const intake = await waitFor(async () => business.vendorStore.intakes[0], 'vendor intake');
    if (intake.company !== 'North Dock Supply' || intake.amount !== '1840' || intake.memo !== 'gate hardware' || intake.fileName !== 'invoice-19.txt' || intake.text !== INVOICE) throw Error(JSON.stringify({ ...intake, textLength: intake.text?.length }));
    const frameText = await tool('sandbox_eval', { code: `const page = context.pages().find(item => item.url().includes('/portal')); const frame = page.frames().find(item => item.url().includes('/form')); if (!frame) throw Error('frame missing'); return await frame.locator('#intake-result').innerText();` });
    if (frameText !== `intake:${intake.id}:North Dock Supply`) throw Error(frameText);
    if (business.vendorStore.intakes.length !== 1) throw Error('intake was not isolated');
  });

  await scenario('recovery', async ctx => {
    await openSession(ctx, `${root}/yard`);
    const first = await snap(ctx);
    if ((first.refs ?? 0) < 200 || first.truncated) throw Error(`snapshot refs=${first.refs} truncated=${first.truncated} chars=${first.tree?.length}`);
    const inputRef = refFor(first.tree, 'textbox', 'Y7');
    const commitRef = refFor(first.tree, 'button', 'Commit yard');
    await fill(ctx, inputRef, 'route-a', true);
    await click(ctx, commitRef, true);
    await waitFor(async () => business.store.yard[0]?.value === 'route-a' ? true : null, 'first commit');
    await click(ctx, '#rerender');
    await waitFor(async () => (await dom('/yard', '() => document.querySelector("#yard-result").textContent')) === 'rerendered' ? true : null, 'rerender');
    const staleClick = await tether('click', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, ref: commitRef });
    const staleFill = await tether('fill', { sessionId: ctx.sessionId, pageId: ctx.pageId, seq: ++ctx.seq, ref: inputRef, value: 'should-not-apply' });
    if (staleClick.sideEffect !== 'none' || staleClick.error !== 'ref_stale' || staleFill.sideEffect !== 'none' || staleFill.error !== 'ref_stale') throw Error(`stale click=${JSON.stringify(staleClick).slice(0,300)} fill=${JSON.stringify(staleFill).slice(0,300)}`);
    if (business.store.yard.length !== 1) throw Error(`stale ref mutated yard ${business.store.yard.length}`);
    const second = await snap(ctx);
    const nextInput = refFor(second.tree, 'textbox', 'Y7');
    const nextCommit = refFor(second.tree, 'button', 'Commit yard');
    if (nextInput === inputRef || nextCommit === commitRef) throw Error('rerender reused old refs');
    await fill(ctx, nextInput, 'route-b', true);
    await click(ctx, nextCommit, true);
    await waitFor(async () => business.store.yard.at(-1)?.value === 'route-b' && business.store.yard.length === 2 ? true : null, 'second commit');
    await click(ctx, '#inflate');
    await waitFor(async () => (await dom('/yard', '() => document.querySelector("#yard-result").textContent')) === 'inflated' ? true : null, 'inflated marker');
    let oversized = '';
    try { oversized = JSON.stringify(await snap(ctx)).slice(0, 200); }
    catch (error) { oversized = String(error.stack || error); }
    if (!oversized.includes('payload_too_large')) throw Error(`oversized response was ${oversized.slice(0, 500)}`);
    const still = await tether('listTabs', { sessionId: ctx.sessionId });
    if (!(still.pages ?? []).some(item => item.pageId === ctx.pageId)) throw Error('session lost after oversized snapshot');
    await click(ctx, '#deflate');
    const third = await snap(ctx);
    if ((third.refs ?? 0) < 200) throw Error(`snapshot after deflate refs=${third.refs}`);
    await fill(ctx, '#c7', 'route-c');
    await click(ctx, '#commit');
    await waitFor(async () => business.store.yard.at(-1)?.value === 'route-c' && business.store.yard.length === 3 ? true : null, 'commit after recovery');
    const committed = await dom('/yard', '() => document.querySelector("#yard-result").textContent');
    if (committed !== 'committed:3:route-c') throw Error(committed);
  });
}

try {
  await main();
} catch (error) {
  results.push({ name: 'harness', ok: false, error: String(error.stack || error).slice(0, 2000) });
  console.error(`FAIL harness\n${error.stack || error}`);
} finally {
  try { await business?.close(); }
  catch (error) { results.push({ name: 'cleanup', ok: false, error: String(error.stack || error) }); }
  const failed = results.filter(item => !item.ok);
  const summary = { passed: results.filter(item => item.ok).map(item => item.name), failed: failed.map(item => ({ name: item.name, error: item.error })), results };
  await writeFile('/tmp/business-summary.json', JSON.stringify(summary, null, 2));
  console.log(`SUMMARY passed=${summary.passed.length} failed=${summary.failed.length}`);
  client?.close();
  auxClient?.close();
  process.exitCode = failed.length ? 1 : 0;
}
