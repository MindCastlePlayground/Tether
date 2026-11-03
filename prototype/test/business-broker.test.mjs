import test from 'node:test';
import assert from 'node:assert/strict';
import { Broker } from '../dist/broker.js';
import { Action, Effect } from '../dist/protocol.js';

class Fixture {
  broker=new Broker({});
  constructor(){
    this.broker.host={readyState:1};
    this.broker.clients.set('agent#test',{});
    this.broker.forward=async(method)=>method==='listTabs'?{pages:[{pageId:'p',url:'https://allowed.test'}]}:{};
  }
  call(method,params){return this.broker.handle('agent#test',{jsonrpc:'2.0',id:1,method,params:{sessionId:'s',...params}});}
}

test('dialog bypasses a blocked click while deduplication and subsequent write ordering remain intact',async()=>{
  const f=new Fixture();let unblock;const order=[];
  const blocked=new Promise(r=>unblock=r);
  f.broker.engine.run=async(method,p)=>{
    if(method==='click'){order.push('click');await blocked;order.push('clicked');return{sideEffect:'applied'};}
    if(method==='dialog'){if(p.action==='list')return{dialogs:[]};order.push('dialog');unblock();return{sideEffect:'applied'};}
    order.push('next');return{};
  };
  const click=f.call('click',{pageId:'p',seq:1,selector:'#alert'});
  await f.call('dialog',{pageId:'p',seq:2,action:'list'});
  await new Promise(r=>setTimeout(r,0));
  const dialog={pageId:'p',seq:3,action:'accept',dialogId:'d'};
  await f.call('dialog',dialog);
  await f.call('dialog',dialog);
  await f.call('uploadDrop',{pageId:'p',seq:4,uploadId:'u'});
  await click;
  assert.deepEqual(order,['click','dialog','clicked','next']);
});

test('popup discovery and adoption apply the candidate origin policy',async()=>{
  const f=new Fixture();let adopted=false;
  f.broker.policy={check:(_who,action,url)=>action===Action.Create&&url==='https://blocked.test'?Effect.Deny:Effect.Allow};
  f.broker.forward=async(method)=>{
    if(method==='popupCandidates')return{tabs:[{tabId:2,openerPageId:'p',url:'https://blocked.test'},{tabId:3,openerPageId:'p',url:'https://allowed.test'}]};
    if(method==='adoptPopup'){adopted=true;return{pageId:'new'};}
    return{};
  };
  assert.deepEqual((await f.call('popupCandidates',{})).tabs.map(t=>t.tabId),[3]);
  await assert.rejects(f.call('adoptPopup',{seq:1,tabId:2,openerPageId:'p'}),/policy_denied/);
  assert.equal(adopted,false);
  assert.equal((await f.call('adoptPopup',{seq:2,tabId:3,openerPageId:'p'})).pageId,'new');
});
