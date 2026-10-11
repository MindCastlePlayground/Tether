import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import WebSocket from 'ws';
import {Policy} from '../dist/policy.js';
import {Action,Effect,PolicyKey as K,Method,Wire} from '../dist/protocol.js';
import {Broker} from '../dist/broker.js';
import {Config} from '../dist/config.js';
const dir=mkdtempSync(join(tmpdir(),'tether-policy-')),file=join(dir,K.File);
const rule={id:'bank',client:K.Any,origin:'https://*.bank.com',actions:[Action.Fill],effect:Effect.Deny};
const put=(rules=[],effect=Effect.Allow)=>writeFileSync(file,JSON.stringify({version:1,default:effect,rules}));
test.after(()=>rmSync(dir,{recursive:true,force:true}));
test('missing file allows; origins, ports, order, unknown origins and reload',()=>{
 const p=new Policy(file);assert.equal(p.check('script',Action.Fill,null),Effect.Allow);
 put([rule]);
 for(const url of ['https://bank.com/a','https://a.bank.com','HTTPS://A.BANK.COM:443/a'])assert.equal(p.check('script',Action.Fill,url),Effect.Deny);
 for(const url of ['https://evilbank.com','http://bank.com','https://bank.com:444',null])assert.equal(p.check('script',Action.Fill,url),Effect.Allow);
 assert.equal(p.check('other',Action.Click,'https://bank.com'),Effect.Allow);
 put([{...rule,effect:Effect.Allow},rule]);assert.equal(p.check('script',Action.Fill,'https://bank.com'),Effect.Allow);
 put([rule,{...rule,origin:K.Any,actions:[K.Any]}]);assert.equal(p.check('script',Action.Click,null),Effect.Deny);
 put([{...rule,client:'other'}]);assert.equal(p.check('script',Action.Fill,'https://bank.com'),Effect.Allow);
});
test('ask only for exactly session; broken JSON fails closed and recovers',()=>{
 const p=new Policy(file);
 for(const actions of [[Action.Fill],[K.Any],[Action.Session,Action.Fill]]){
  put([{...rule,actions,effect:Effect.Ask}]);assert.throws(()=>p.check('script',Action.Session,null),new RegExp(K.Invalid));assert.equal(p.summary().valid,false);
 }
 writeFileSync(file,'{');assert.throws(()=>p.check('script',null,null),new RegExp(K.Invalid));
 put([{...rule,origin:K.Any,actions:[Action.Session],effect:Effect.Ask}]);assert.equal(p.check('script',Action.Session,null),Effect.Ask);
});
test('broker mock host gets ask; denial does not consume sequence; invalid policy rejects nonactions',async()=>{
 put([{...rule,origin:K.Any,actions:[Action.Session],effect:Effect.Ask},rule]);
 const cfg=Config.load('.local/broker.json');cfg.port=18449;cfg.policyFile=file;
 const hc=Config.load('.local/host.json');hc.url='wss://127.0.0.1:18449/bridge';
 const broker=new Broker(cfg);let host;const calls=[];
 try{
  await broker.start();host=new WebSocket(hc.url,Config.tls(hc));await once(host,'open');
  host.on('message',raw=>{const m=JSON.parse(raw);calls.push(m);host.send(JSON.stringify({jsonrpc:Wire.Version,id:m.id,result:m.method===Method.Tabs?[{pageId:'p',url:'https://bank.com/a'}]:{ok:true}}));});
  await broker.handle('script',{jsonrpc:Wire.Version,id:1,method:Method.Request,params:{mode:K.New}});
  assert.equal(calls.find(m=>m.method===Method.Request).params[K.Ask],true);
  const msg={jsonrpc:Wire.Version,id:2,method:Method.Fill,params:{sessionId:'s',pageId:'p',seq:1,selector:'input',value:'x'}};
  await assert.rejects(broker.handle('script',msg),new RegExp(K.Denied));assert.equal(broker.ledger.size,0);
  assert.equal(calls.filter(m=>m.method===Method.Tabs).length,1);
  writeFileSync(file,'{');await assert.rejects(broker.handle('script',{...msg,method:Method.Status}),new RegExp(K.Invalid));
  const cap=await broker.handle('script',{...msg,method:Method.Capabilities});assert.equal(cap.policy.valid,false);assert.equal(JSON.stringify(cap).includes(file),false);
 }finally{host?.terminate();await broker.stop();}
});
test('queued write re-checks policy against the page origin at execution time',async()=>{
 put([rule]);
 const cfg=Config.load('.local/broker.json');cfg.port=18450;cfg.policyFile=file;
 const hc=Config.load('.local/host.json');hc.url='wss://127.0.0.1:18450/bridge';
 const broker=new Broker(cfg);let host;let tabs=0;
 try{
  await broker.start();host=new WebSocket(hc.url,Config.tls(hc));await once(host,'open');
  host.on('message',raw=>{const m=JSON.parse(raw);const url=m.method===Method.Tabs&&tabs++>0?'https://bank.com/':'https://shop.com/';host.send(JSON.stringify({jsonrpc:Wire.Version,id:m.id,result:m.method===Method.Tabs?[{pageId:'p',url}]:{ok:true}}));});
  broker.clients.set('script',{});
  const msg={jsonrpc:Wire.Version,id:3,method:Method.Fill,params:{sessionId:'s',pageId:'p',seq:1,selector:'input',value:'x'}};
  await assert.rejects(broker.handle('script',msg),new RegExp(K.Denied));assert.equal(tabs,2);
 }finally{host?.terminate();broker.clients.clear();await broker.stop();}
});
