import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkCapture } from '../extension/network.js';
import { ExtensionController } from '../extension/controller.js';
import { Wire, Failure, NetworkLimits, NetworkCdp } from '../extension/protocol.js';

class CaptureFixture {
  page = {pageId:'p',tabId:1,attached:true};
  body = 'abc'.repeat(30000);
  net = new NetworkCapture({debugger:{sendCommand:async()=>({body:this.body,base64Encoded:false})}});
  run(p) { return this.net.run(this.page,p,async()=>{}); }
  event(method,p) { this.net.event('p',method,p); }
  request(id='x',extra={}) { this.event(NetworkCdp.Request,{requestId:id,timestamp:1,type:'Fetch',request:{url:'https://x/',method:'GET'},...extra}); }
}

test('capture records bounded request lifecycle, filters, details, bodies and stop/clear', async () => {
  const calls = [];
  const api = { debugger: { sendCommand: async (target, method, params) => {
    calls.push([method, params]);
    if (method === 'Network.getResponseBody') return { body: 'hello world', base64Encoded: false };
    return {};
  } } };
  const net = new NetworkCapture(api), page = { pageId: 'p', tabId: 4, attached: true };
  const auth = async () => {};
  assert.deepEqual(await net.run(page, { op: 'start' }, auth), { active: true, count: 0 });
  net.event('p', 'Network.requestWillBeSent', { requestId: 'r1', request: { url: 'https://x/a', method: 'POST', headers: { a: 'b' }, postData: 'form' }, type: 'Fetch', timestamp: 1 });
  net.event('p', 'Network.responseReceived', { requestId: 'r1', type: 'Fetch', response: { status: 201, mimeType: 'text/plain', headers: { h: 'v' } } });
  net.event('p', 'Network.loadingFinished', { requestId: 'r1', timestamp: 2, encodedDataLength: 11 });
  const listed = await net.run(page, { op: 'list', url: '/a', type: 'Fetch' }, auth);
  assert.equal(listed.total, 1);
  const detail = await net.run(page, { op: 'detail', requestId: 'r1' }, auth);
  assert.equal(detail.request.response.status, 201);
  assert.equal((await net.run(page, { op: 'body', requestId: 'r1', maxChars: 5 }, auth)).body, 'hello');
  assert.equal((await net.run(page, { op: 'stop' }, auth)).active, false);
  await net.run(page, { op: 'clear' }, auth);
  assert.equal((await net.run(page, { op: 'list' }, auth)).total, 0);
  assert.ok(calls.some(x => x[0] === 'Network.enable'));
});

test('network operation enforces authorization and shared debugger attach is reused', async () => {
  const c = Object.create(ExtensionController.prototype);
  const cmds = [];
  const page = { pageId: 'p', clientId: 'c', sessionId: 's', tabId: 7, attached: false, debuggerOwned: false,
    groupId: -1, owned: false, url: 'https://x/' };
  c.api = { debugger: { attach: async () => { cmds.push('attach'); }, detach:async () => { cmds.push('detach'); },
    sendCommand: async (_t, method) => { cmds.push(method); return { targetInfo: { targetId: '7' } }; } },
    tabs: { get: async () => ({ id: 7, url: 'https://x/', groupId: -1 }) } };
  c.sessions = new Map([['s', { clientId: 'c', sessionId: 's', expires: Date.now() + 10000, pages: new Set(['p']) }]]);
  c.pages = new Map([['p', page]]); c.attached = new Set(); c.intentionalDetach = new Set();
  c.clock = Date.now; c.safeUrl = ExtensionController.prototype.safeUrl; c.checkGroup = ExtensionController.prototype.checkGroup;
  c.network = new NetworkCapture(c.api);
  c.grant = ExtensionController.prototype.grant; c.client = ExtensionController.prototype.client;
  c.version = () => ({ product: 'Chrome', userAgent: 'Chrome', protocolVersion: '1.3' });
  const info = await c.attach({ session: c.sessions.get('s'), page });
  assert.equal(info.tabId, 7);
  await c.attach({session:c.sessions.get('s'),page});
  assert.equal(cmds.filter(x=>x==='attach').length,1);
  await c.detachPage(page);
  assert.equal(cmds.includes('Network.disable'), false);
  await assert.rejects(() => c.dispatch(Wire.Network, { clientId: 'other', sessionId: 's', pageId: 'p', op: 'start' }), e => e.message === Failure.Forbidden);
});

test('capture validates paging limits and ignores events outside an active capture', async () => {
  const net = new NetworkCapture({ debugger: { sendCommand: async () => ({}) } });
  net.event('p', 'Network.requestWillBeSent', { requestId: 'x', request: { url: 'https://x/' } });
  await assert.rejects(() => net.run({ pageId: 'p' }, { op: 'list', limit: 101 }, async () => {}), e => e.message === Failure.NetworkUnavailable);
  await net.run({ pageId: 'p', tabId: 1, attached: true }, { op: 'start' }, async () => {});
  await assert.rejects(() => net.run({ pageId: 'p' }, { op: 'list', limit: 101 }, async () => {}), e => e.message === Failure.Invalid);
});

test('body pagination reconstructs long content and unfinished/failed bodies are explicit errors',async()=>{
  const f=new CaptureFixture();await f.run({op:'start'});f.request();
  const id=(await f.run({op:'list'})).requests[0].requestId;
  await assert.rejects(f.run({op:'body',requestId:id}),/network_pending/);
  f.event(NetworkCdp.Finished,{requestId:'x',timestamp:2});
  let content='',offset=0;
  do { const part=await f.run({op:'body',requestId:id,offset,maxChars:30000});content+=part.body;offset=part.nextOffset; } while(offset!==null);
  assert.equal(content,f.body);
  f.event(NetworkCdp.Failed,{requestId:'x',errorText:'net::ERR_FAILED'});
  await assert.rejects(f.run({op:'body',requestId:id}),/network_unavailable/);
});

test('redirect hops retain distinct details and never retrieve the final body for an earlier hop',async()=>{
  const f=new CaptureFixture();await f.run({op:'start'});f.request();
  f.request('x',{timestamp:2,redirectResponse:{status:302,headers:{location:'/final'}},request:{url:'https://x/final',method:'GET'}});
  f.event(NetworkCdp.Response,{requestId:'x',response:{status:200}});
  f.event(NetworkCdp.Finished,{requestId:'x',timestamp:3});
  const rows=(await f.run({op:'list'})).requests;
  assert.deepEqual(rows.map(r=>r.status),[302,200]);assert.notEqual(rows[0].requestId,rows[1].requestId);
  assert.equal((await f.run({op:'detail',requestId:rows[0].requestId})).request.response.status,302);
  await assert.rejects(f.run({op:'body',requestId:rows[0].requestId}),/network_unavailable/);
});

test('large headers, stream messages and lists fit native frame limit; retained requests are bounded',async()=>{
  const f=new CaptureFixture();await f.run({op:'start'});
  const huge=String.fromCharCode(0).repeat(40000);
  for(let i=0;i<NetworkLimits.Requests+1;i++) {
    f.request(String(i),{request:{url:'https://x/'+huge,method:'GET',headers:{huge},postData:huge},initiator:{type:huge}});
    f.event(NetworkCdp.Response,{requestId:String(i),response:{status:200,mimeType:huge,headers:{huge}}});
  }
  const list=await f.run({op:'list',limit:100});
  assert.equal(list.total,NetworkLimits.Requests);assert.equal(list.dropped,1);
  assert.ok(Buffer.byteLength(JSON.stringify(list))<512*1024);
  const last=(await f.run({op:'list',offset:499})).requests[0];
  for(let i=0;i<30;i++)f.event(NetworkCdp.SSE,{requestId:String(NetworkLimits.Requests),data:huge});
  const detail=await f.run({op:'detail',requestId:last.requestId});
  assert.equal(detail.request.truncated,true);assert.equal(detail.request.eventsDropped,10);
  assert.ok(Buffer.byteLength(JSON.stringify(detail))<512*1024);
  f.net.drop('p');assert.equal(f.net.pages.size,0);
});

test('revocation during response read prevents a completed response from being returned',async()=>{
  const f=new CaptureFixture();await f.run({op:'start'});f.request();f.event(NetworkCdp.Finished,{requestId:'x'});
  const requestId=(await f.run({op:'list'})).requests[0].requestId;
  let checks=0;
  await assert.rejects(f.net.run(f.page,{op:'body',requestId},async()=>{if(++checks===2)throw Error(Failure.Forbidden);}),/not_authorized/);
});
