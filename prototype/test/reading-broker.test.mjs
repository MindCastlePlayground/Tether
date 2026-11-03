import test from 'node:test';
import assert from 'node:assert/strict';
import { Broker } from '../dist/broker.js';
import { Action, Effect, PUBLIC } from '../dist/protocol.js';
import { BridgeClient } from '../dist/client.js';

class Fixture {
  broker=new Broker({});
  url='https://allowed.test';
  reads=0;
  constructor(){
    this.broker.policy={check:(_id,action,url)=>action===Action.Observe&&url==='https://denied.test'?Effect.Deny:Effect.Allow};
    this.broker.forward=async()=>({pages:[{pageId:'p',url:this.url}]});
    this.broker.engine.run=async()=>{this.reads++;return{html:'<main>complete</main>'};};
  }
  call(method='html',params={}){return this.broker.handle('a#1',{jsonrpc:'2.0',id:1,method,params:{sessionId:'s',pageId:'p',...params}});}
}

test('text-only observe is absent from public API and SDK',async()=>{
  const f=new Fixture();
  assert.equal(PUBLIC.has('observe'),false);
  assert.equal(typeof BridgeClient.prototype.observe,'undefined');
  await assert.rejects(f.call('observe'),/invalid_request/);
  assert.equal(f.reads,0);
});

test('html applies observe policy before and after reading',async()=>{
  const f=new Fixture();
  assert.equal((await f.call()).html,'<main>complete</main>');
  f.url='https://denied.test';
  await assert.rejects(f.call(),/policy_denied/);
  assert.equal(f.reads,1);
  f.url='https://allowed.test';
  f.broker.engine.run=async()=>{f.url='https://denied.test';return{html:'private'};};
  await assert.rejects(f.call(),/policy_denied/);
});

test('html validates pagination and retains actionable capture errors',async()=>{
  const f=new Fixture();
  for(const p of [{offset:-1},{offset:1},{maxChars:30001},{maxChars:0},{captureId:''}])await assert.rejects(f.call('html',p),/invalid_params/);
  assert.equal(f.reads,0);
  f.broker.engine.run=async()=>{throw Error('html_capture_expired');};
  await assert.rejects(f.call('html',{captureId:'old',offset:20}),/html_capture_expired/);
});
