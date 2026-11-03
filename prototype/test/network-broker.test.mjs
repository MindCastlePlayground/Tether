import test from 'node:test';
import assert from 'node:assert/strict';
import { Broker } from '../dist/broker.js';
import { Action, Effect, Method, Wire } from '../dist/protocol.js';

class Fixture {
  broker = new Broker({});
  calls = [];
  url = 'https://example.test';
  pages = true;
  constructor() {
    this.broker.policy = { check: (_client, action, url) => action === Action.Observe && url === 'https://denied.test' ? Effect.Deny : Effect.Allow };
    this.broker.forward = async (method, params) => {
      this.calls.push({method, params});
      if (method === Method.Tabs) return {pages:this.pages ? [{pageId:'p',url:this.url}] : []};
      return {body:'fixture'};
    };
  }
  run(op = 'body') { return this.broker.handle('script#test', {jsonrpc:Wire.Version,id:1,method:Method.Network,params:{sessionId:'s',pageId:'p',op,requestId:'r'}}); }
}

test('network follows observe policy and retains authenticated client identity', async () => {
  const f = new Fixture();
  assert.deepEqual(await f.run(), {body:'fixture'});
  assert.equal(f.calls.find(c => c.method === Method.Network).params.clientId, 'script#test');
  f.url = 'https://denied.test'; f.calls = [];
  await assert.rejects(f.run('start'), /policy_denied/);
  assert.equal(f.calls.some(c => c.method === Method.Network), false);
});

test('network refuses foreign pages and rechecks authorization after an async body read', async () => {
  const f = new Fixture(); f.pages = false;
  await assert.rejects(f.run(), /page_forbidden/);
  f.pages = true;
  const forward = f.broker.forward;
  f.broker.forward = async (method, params) => { const result = await forward(method,params); if (method === Method.Network) f.url = 'https://denied.test'; return result; };
  await assert.rejects(f.run(), /policy_denied/);
});
