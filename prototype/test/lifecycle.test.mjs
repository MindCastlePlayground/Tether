import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { request } from 'node:https';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BrokerLifecycle } from '../dist/lifecycle.js';
import { Autostart } from '../dist/autostart.js';
import { Config } from '../dist/config.js';
import { BrokerControl as C, PolicyKey } from '../dist/protocol.js';
import { BridgeClient } from '../dist/client.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

class Fixture {
  static async create(t){
    const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
    const root=mkdtempSync(resolve('work/life-'));
    const broker={...Config.load('.local/broker.json'),port};delete broker.lan;
    for(const role of ['agent','host'])writeFileSync(join(root,`${role}.json`),JSON.stringify({...Config.load(`.local/${role}.json`),url:`wss://127.0.0.1:${port}/bridge`}));
    writeFileSync(join(root,'broker.json'),JSON.stringify(broker));
    const life=new BrokerLifecycle(join(root,'agent.json'));
    const host=new BrokerLifecycle(join(root,'host.json'));
    t.after(async()=>{await host.set(C.Off);await new Promise(r=>setTimeout(r,150));rmSync(root,{recursive:true,force:true});});
    return {root,port,life,host};
  }
  static async wait(fn){const end=Date.now()+7000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,25));}throw Error('wait_timeout');}
  static control(cfg,path,method='GET',headers={}){return new Promise((resolve,reject)=>{const url=new URL(cfg.url);url.protocol='https:';url.pathname=path;const req=request(url,{...Config.tls(cfg),method,headers:{...Config.tls(cfg).headers,...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});}
}
test('lifecycle reports the policy summary without starting Broker',()=>{
  mkdirSync('work',{recursive:true});
  const root=mkdtempSync(resolve('work/life-policy-'));
  try{
    const policy=join(root,PolicyKey.File);
    writeFileSync(join(root,'broker.json'),JSON.stringify({port:1,policyFile:policy}));
    writeFileSync(policy,JSON.stringify({version:1,default:'deny',rules:[{id:'one',client:'*',origin:'*',actions:['*'],effect:'deny'}]}));
    const life=new BrokerLifecycle(join(root,'host.json'));
    assert.deepEqual(life.policy(),{[PolicyKey.Default]:'deny',[PolicyKey.Rules]:1});
    writeFileSync(policy,'{');
    assert.equal(life.policy(),undefined);
    rmSync(policy);
    assert.deepEqual(life.policy(),{[PolicyKey.Default]:'allow',[PolicyKey.Rules]:0});
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('MCP and host share startup; off prevents MCP respawn; explicit on restarts',async t=>{
  const f=await Fixture.create(t);
  const starts=await Promise.all([f.life.ensure(),f.host.ensure(),f.life.ensure()]);
  assert.ok(starts.every(s=>s.state===C.Running));
  await Fixture.wait(async()=>((await f.life.ensure()).state===C.Running));
  const client=new BridgeClient(Config.load(join(f.root,'agent.json')));
  assert.equal((await client.capabilities()).browserConnected,false);client.close();
  assert.equal((await f.host.set(C.Off)).state,C.Stopped);
  await Autostart.run({env:{BB_CLIENT_CONFIG:join(f.root,'agent.json')}});
  assert.equal((await f.life.ensure()).mode,C.Off);
  await new Promise(r=>setTimeout(r,150));
  assert.equal((await f.host.set(C.On)).state,C.Running);
});

test('real stdio MCP starts the Broker and serves tools without an extension',async t=>{
  const f=await Fixture.create(t);
  const client=new Client({name:'release-check',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/mcp.js')],env:{...process.env,BB_CLIENT_CONFIG:join(f.root,'agent.json')},stderr:'pipe'});
  try{
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length,14);
    const result=await client.callTool({name:'capabilities',arguments:{}});
    assert.equal(result.isError,undefined);
    assert.equal(JSON.parse(result.content[0].text).browserConnected,false);
    assert.equal(f.life.state().state,C.Running);
  }finally{await client.close();}
});
test('occupied foreign port backs off, blocks, survives repeated probes and never kills owner',async t=>{
  const f=await Fixture.create(t);
  const owner=createServer(sock=>{sock.on('error',()=>{});sock.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n',()=>sock.destroy());});
  await new Promise(r=>owner.listen(f.port,'127.0.0.1',r));
  t.after(()=>new Promise(r=>owner.close(r)));
  for(let i=1;i<=C.Limit;i++){
    if(i>1){const s=f.life.state();writeFileSync(join(f.root,C.StateFile),JSON.stringify({...s,retryAt:0}));}
    const s=await f.life.ensure();assert.equal(s.attempt,i);assert.equal(s.code,C.Port);
    assert.equal(s.state,i===C.Limit?C.Blocked:C.Backoff);
    assert.equal((await f.host.ensure()).attempt,i);assert.equal(owner.listening,true);
  }
  assert.equal((await f.life.ensure()).state,C.Blocked);
  assert.equal((await new BrokerLifecycle(join(f.root,'host.json')).ensure()).attempt,C.Limit);
  await new Promise(r=>owner.close(r));
  assert.equal((await f.life.ensure()).state,C.Blocked);
  assert.equal((await f.host.set(C.Auto)).state,C.Running);
});
test('management endpoint requires local authenticated host for stop and rejects webpage Origins',async t=>{
  const f=await Fixture.create(t);await f.life.ensure();
  const agent=Config.load(join(f.root,'agent.json'));
  assert.equal(await Fixture.control(agent,C.Health),200);
  assert.equal(await Fixture.control(agent,C.Stop,'POST'),404);
  assert.equal(await Fixture.control(agent,C.Health,'GET',{origin:'https://example.test'}),403);
  assert.equal(await Fixture.control({...agent,token:'wrong'},C.Health),403);
  assert.equal((await f.life.ensure()).state,C.Running);
  await Fixture.control(Config.load(join(f.root,'host.json')),C.Stop,'POST');
  await new Promise(r=>setTimeout(r,150));
  assert.equal((await f.life.ensure()).state,C.Running);
});
test('real native host starts Broker, stops it, keeps control port alive and starts again',async t=>{
  const f=await Fixture.create(t);
  const cfg=Config.load(join(f.root,'host.json'));
  const child=spawn(process.execPath,['dist/host.js',join(f.root,'host.json'),`chrome-extension://${cfg.extensionId}/`],{stdio:'pipe',windowsHide:true});
  const exited=once(child,'close');t.after(async()=>{child.kill();await exited;});
  let raw=Buffer.alloc(0);const frames=[];
  child.stdout.on('data',data=>{raw=Buffer.concat([raw,data]);while(raw.length>=4&&raw.length>=raw.readUInt32LE()+4){const n=raw.readUInt32LE();frames.push(JSON.parse(raw.subarray(4,4+n)));raw=raw.subarray(4+n);}});
  const send=msg=>{const b=Buffer.from(JSON.stringify(msg));const h=Buffer.alloc(4);h.writeUInt32LE(b.length);child.stdin.write(Buffer.concat([h,b]));};
  await Fixture.wait(()=>frames.some(f=>f.type==='native.status'&&f.state==='connected'));
  send({type:C.Type,action:C.Mode,mode:C.Off});
  await Fixture.wait(()=>frames.some(f=>f.type===C.Status&&f.mode===C.Off));
  assert.equal(child.exitCode,null);
  await Autostart.run({env:{BB_CLIENT_CONFIG:join(f.root,'agent.json')}});assert.equal(f.life.state().mode,C.Off);
  frames.length=0;send({type:C.Type,action:C.Mode,mode:C.Auto});
  await Fixture.wait(()=>frames.some(f=>f.type==='native.status'&&f.state==='connected'));
  send({type:C.Type,action:C.Probe});
  await Fixture.wait(()=>frames.some(f=>f.type===C.Status&&f.state===C.Running));
});
