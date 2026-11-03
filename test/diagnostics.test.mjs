import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Diagnostics } from '../installer/diagnostics.mjs';

class Fixture {
  static async probe(t, response, code) {
    const root=mkdtempSync(join(tmpdir(),'tether-diagnose-'));
    mkdirSync(join(root,'dist'));
    writeFileSync(join(root,'package.json'),'{"type":"module"}');
    writeFileSync(join(root,'dist','client.js'),`export class BridgeClient { async connect(){${code?`throw Object.assign(new Error(),{code:${JSON.stringify(code)}});`:''}} async call(){return ${JSON.stringify(response)};} close(){} } export async function loadConfig(){return {};}`);
    t.after(()=>rmSync(root,{recursive:true,force:true}));
    const report={valid:true};
    const output=[];
    const log=console.log;console.log=value=>output.push(value);
    try { return {status:await Diagnostics.online(root,{},report),report,output}; }
    finally {console.log=log;}
  }
}

test('online diagnostics succeeds only for a responsive matching browser',async t=>{
  const result=await Fixture.probe(t,{browser:'responsive',versionMatch:true,policy:{valid:true}});
  assert.equal(result.status,0);
  assert.equal(result.report.connection.authentication,'ok');
  assert.equal(result.output.length,1);
});

test('online diagnostics reports missing browser and mismatched version as failures',async t=>{
  assert.equal((await Fixture.probe(t,{browser:'unavailable'})).status,1);
  assert.equal((await Fixture.probe(t,{browser:'responsive',versionMatch:false})).status,1);
});

test('online diagnostics identifies authentication failures',async t=>{
  const result=await Fixture.probe(t,{},'authentication_failed');
  assert.equal(result.status,1);
  assert.equal(result.report.connection.authentication,'failed');
  assert.equal(result.report.valid,false);
});
