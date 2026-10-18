import test from 'node:test';
import assert from 'node:assert/strict';
import { Autostart } from '../dist/autostart.js';
import { Autostart as Opt } from '../dist/protocol.js';

test('MCP startup delegates to the shared lifecycle with its exact config',async()=>{
  const seen=[];
  await Autostart.run({env:{[Opt.Client]:'runtime/agent.json'},ensure:async path=>seen.push(path)});
  assert.deepEqual(seen,['runtime/agent.json']);
});
test('explicit MCP opt-out and missing config do not start a Broker',async()=>{
  let calls=0;
  for(const env of [{},{[Opt.Client]:'agent.json',[Opt.Flag]:Opt.Off}])await Autostart.run({env,ensure:async()=>{calls++;}});
  assert.equal(calls,0);
});
