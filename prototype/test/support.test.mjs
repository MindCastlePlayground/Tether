import assert from 'node:assert/strict';
import { Conditions, Journal } from '../dist/support.js';

class Cases {
  static async run() {
    const journal = new Journal();
    journal.add('a', 'snapshot', Date.now(), { sideEffect: 'none' });
    assert.equal(journal.read('a', 'export').mimeType, 'application/json');
    journal.drop('a');
    assert.deepEqual(journal.read('a', 'list').records, []);
    assert.equal((await Conditions.run({condition:'hidden',sessionId:'s',pageId:'p',value:'x',timeoutMs:0}, async () => ({truncated:true,candidates:[]}))).passed, false);
    await assert.rejects(Conditions.run({condition:'request',sessionId:'s',pageId:'p',value:'x',timeoutMs:0}, async () => ({})), /invalid_response/);
    let calls=0;
    const matched=await Conditions.run({condition:'text',sessionId:'s',pageId:'p',value:'Saved',timeoutMs:1000},async()=>({tree:++calls===2?'Saved':'Saving'}));
    assert.equal(matched.passed,true);
    assert.equal(calls,2);
    await assert.rejects(Conditions.run({condition:'url',sessionId:'s',pageId:'p',value:'https://example.com',timeoutMs:0},async()=>{throw Error('policy_denied');}),/policy_denied/);
    assert.equal((await Conditions.run({condition:'request',sessionId:'s',pageId:'p',value:'save',timeoutMs:0},async()=>({requests:[{finished:true,failed:true}]}))).passed,false);
    for(let i=0;i<205;i++)journal.add('a','click',Date.now(),{error:'outcome_unknown'});
    journal.add('a','https://private.example',Date.now(),undefined,'secret value');
    const exported=JSON.parse(journal.read('a','export').text);
    assert.equal(exported.records.length,200);
    assert.equal(exported.records.at(-1).code,'request_failed');
    assert.equal(exported.records.at(-1).method,'invalid');
    assert.deepEqual(journal.read('other','list').records,[]);
  }
}
await Cases.run();
