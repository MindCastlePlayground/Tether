import test from'node:test';
import assert from'node:assert/strict';
import{once}from'node:events';
import WebSocket from'ws';
import{Broker}from'../dist/broker.js';
import{Config}from'../dist/config.js';
import{BridgeClient}from'../dist/client.js';
const config=Config.load('.local/broker.json');config.port=18448;
const base=Config.load('.local/script.json');base.url='wss://127.0.0.1:18448/bridge';
const hostCfg=Config.load('.local/host.json');hostCfg.url=base.url;
const broker=new Broker(config);let host;let calls=[];
test.before(async()=>{await broker.start();host=new WebSocket(hostCfg.url,Config.tls(hostCfg));await once(host,'open');host.on('message',raw=>{const msg=JSON.parse(raw);calls.push(msg);host.send(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{ok:true}}));});});
test.after(async()=>{host.terminate();await broker.stop();});
test('same write sequence deduplicates; conflicting payload cannot execute twice',async()=>{
 const c=new BridgeClient(base);try{
  const args={sessionId:'synthetic-session',seq:1,url:'http://127.0.0.1/'};
  const first=await c.createTab(args);assert.deepEqual(await c.createTab(args),first);
  await assert.rejects(c.createTab({...args,url:'http://127.0.0.1/changed'}));
  assert.equal(calls.filter(x=>x.method==='createTab').length,1);
  assert.match(calls.find(x=>x.method==='createTab').params.clientId,/^script#[0-9a-f]{8}$/);
 }finally{c.close();await new Promise(r=>setTimeout(r,30));}
});
test('several agents can share one credential with isolated instances',async()=>{
 const a=new BridgeClient(base),b=new BridgeClient(base);try{
  calls=[];
  await Promise.all([a.createTab({sessionId:'shared',seq:1,url:'http://127.0.0.1/a'}),b.createTab({sessionId:'shared',seq:1,url:'http://127.0.0.1/b'})]);
  const ids=calls.filter(x=>x.method==='createTab').map(x=>x.params.clientId);
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);for(const id of ids)assert.match(id,/^script#/);
 }finally{a.close();b.close();await new Promise(r=>setTimeout(r,30));}
});
test('oversized incoming WSS frame closes connection',async()=>{
 const ws=new WebSocket(base.url,Config.tls(base));ws.on('error',()=>{});await once(ws,'open');
 const closed=once(ws,'close');ws.send('x'.repeat(512*1024+1));const[code]=await closed;assert.equal(code,1009);
});
test('oversized host forward rejects and cleans pending without losing host connection',async()=>{
 const pendingBefore=broker.pending.size;
 const oversized={data:'x'.repeat(512*1024)};
 await assert.rejects(broker.forward('oversizedProbe',{clientId:'probe',...oversized}),/payload_too_large/);
 assert.equal(broker.pending.size,pendingBefore);
 assert.equal(host.readyState,WebSocket.OPEN);
 const result=await broker.forward('smallProbe',{clientId:'probe'});
 assert.deepEqual(result,{ok:true});
 assert.ok(broker.pending.size<=pendingBefore);
});
test('heartbeat queue_full does not terminate the host',async()=>{
 const isolated=new Broker(config);
 const previousHost=isolated.host,previousClients=isolated.clients,previousForward=isolated.forward;
 let terminated=false;
 const stubHost={terminate:()=>{terminated=true;}};
 try{
  isolated.host=stubHost;
  isolated.clients=new Map([['client-instance',{}]]);
  isolated.forward=()=>Promise.reject(Error('queue_full'));
  isolated.heartbeat();
  await Promise.resolve();
  assert.equal(terminated,false);
 }finally{
  isolated.host=previousHost;
  isolated.clients=previousClients;
  isolated.forward=previousForward;
 }
});
test('oversized broker response sends an id-matched payload error',()=>{
 const sent=[];let closed=false;const ws={send:body=>sent.push(JSON.parse(body)),close:()=>{closed=true;}};
 broker.send(ws,{jsonrpc:'2.0',id:'response-1',result:{data:'x'.repeat(512*1024)}});
 assert.equal(closed,false);
 assert.deepEqual(sent,[{jsonrpc:'2.0',id:'response-1',error:{code:-32000,message:'payload_too_large'}}]);
});
test('host disconnect invalidates client connection',async()=>{
 const ws=new WebSocket(base.url,Config.tls(base));await once(ws,'open');const closed=once(ws,'close');host.close();const[code]=await closed;assert.equal(code,1011);
});
test('write without a browser is refused before its seq is recorded, so the same seq can run later',async()=>{
 await new Promise(r=>setTimeout(r,50));
 const c=new BridgeClient(base);try{
  const args={sessionId:'retry-session',seq:1,url:'http://127.0.0.1/retry'};
  await assert.rejects(c.createTab(args),/host_unavailable/);
  host=new WebSocket(hostCfg.url,Config.tls(hostCfg));await once(host,'open');calls=[];
  host.on('message',raw=>{const msg=JSON.parse(raw);calls.push(msg);host.send(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{ok:true}}));});
  const c2=new BridgeClient(base);try{assert.deepEqual(await c2.createTab(args),{ok:true});}finally{c2.close();}
  assert.equal(calls.filter(x=>x.method==='createTab').length,1);
 }finally{c.close();await new Promise(r=>setTimeout(r,30));}
});
