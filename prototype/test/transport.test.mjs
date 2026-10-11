import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import {createServer}from'node:https';
import {once}from'node:events';
import {randomUUID}from'node:crypto';
import WebSocket from 'ws';
import {Broker}from'../dist/broker.js';
import {Config}from'../dist/config.js';
import {BridgeClient}from'../dist/client.js';
import {TabTransport}from'../dist/engine.js';
const cfg=Config.load('.local/broker.json');cfg.port=18445;
const base=Config.load('.local/script.json');base.url='wss://127.0.0.1:18445/bridge';
const broker=new Broker(cfg);
test('transport replies after caller registers its protocol callback',async()=>{
 const t=new TabTransport(async()=>({}),{},{targetId:'T'},{product:'Chrome/1'});
 let registered=false;
 const reply=new Promise((resolve,reject)=>{t.onmessage=()=>registered?resolve():reject(Error('synchronous_response'));});
 t.send({id:1,method:'Browser.getVersion'});registered=true;
 await reply;t.close();
});
test.before(async()=>broker.start());test.after(async()=>broker.stop());
test('real TLS WSS client keeps authenticated connection across requests',async()=>{
 const c=new BridgeClient(base);try{assert.equal((await c.capabilities()).prototype,'M0');assert.equal((await c.capabilities()).prototype,'M0');}finally{c.close();await new Promise(r=>setTimeout(r,30));}
});
test('wrong token rejected',async()=>{const c=new BridgeClient({...base,token:'wrong'});await assert.rejects(c.capabilities());c.close();});
test('wrong certificate pin rejected before authenticated upgrade',async()=>{
 let upgrades=0;const server=createServer({key:readFileSync(cfg.keyFile),cert:readFileSync(cfg.certFile)});server.on('upgrade',(_,s)=>{upgrades++;s.destroy();});await new Promise(r=>server.listen(18446,'127.0.0.1',r));
 const c=new BridgeClient({...base,url:'wss://127.0.0.1:18446/bridge',pin:'A'.repeat(43)+'='});await assert.rejects(c.capabilities());assert.equal(upgrades,0);c.close();await new Promise(r=>server.close(r));
});
test('webpage Origin rejected despite valid token',async()=>{
 const ws=new WebSocket(base.url,{...Config.tls(base),headers:{authorization:`Bearer ${base.token}`,origin:'http://127.0.0.1'}});await once(ws,'error');ws.terminate();
});
test('public client cannot invoke cdp or inject clientId',async()=>{
 const ws=new WebSocket(base.url,Config.tls(base));await once(ws,'open');
 for(const req of [{method:'cdp',params:{}},{method:'requestSession',params:{mode:'newGroup',clientId:'host'}}]){ws.send(JSON.stringify({jsonrpc:'2.0',id:randomUUID(),...req}));const [raw]=await once(ws,'message');assert.equal(JSON.parse(raw).error.message,'invalid_request');}ws.close();await once(ws,'close');
});
test('browser-wide and unknown target commands rejected by in-process transport',async()=>{
 let forwarded=0;const t=new TabTransport(async()=>{forwarded++;return{}},{clientId:'A',sessionId:'S',pageId:'P'},{targetId:'T'},{product:'Chrome/1',userAgent:'Chrome'});
 for(const m of [{id:1,method:'Browser.close'},{id:2,sessionId:'foreign',method:'Runtime.evaluate'},{id:3,method:'Storage.getCookies'}]){const response=await new Promise(r=>{t.onmessage=r;t.send(m);});assert.ok(response.error);}assert.equal(forwarded,0);t.close();
});
