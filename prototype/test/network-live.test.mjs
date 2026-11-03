import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { ExtensionController } from '../extension/controller.js';
import { Broker } from '../dist/broker.js';

test('real Chrome traffic: start before observe, POST, redirect, large response, stop and release', async () => {
  const body = 'network-body-'.repeat(10000);
  const server = createServer((req,res) => {
    if (req.url === '/redirect') { res.writeHead(302,{location:'/large'}); res.end(); }
    else if (req.url === '/large') { res.writeHead(200,{'content-type':'text/plain','x-fixture':'yes'}); res.end(body); }
    else if (req.url === '/post') { let data='';req.on('data',x=>data+=x);req.on('end',()=>{res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({received:data}));}); }
    else { res.writeHead(200,{'content-type':'text/html'});res.end('<title>Network fixture</title><main>Network fixture</main>'); }
  });
  let browser;
  const broker = new Broker({});
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    browser = await chromium.launch({channel:'chrome',headless:true});
    const page = await browser.newPage();
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    const cdp = await page.context().newCDPSession(page);
    let attaches=0;
    const controller = new ExtensionController({
      debugger:{attach:async()=>{attaches++;},detach:async()=>{},sendCommand:(_target,method,params)=>cdp.send(method,params)},
      tabs:{get:async()=>({id:1,url:page.url(),title:await page.title(),groupId:-1})},
    },Date.now,()=> 'Chrome/145.0.0.0');
    controller.publishSessions=()=>{};
    const grant = {clientId:'test',sessionId:'s',pageId:'p'};
    controller.sessions.set('s',{...grant,expires:Date.now()+60000,pages:new Set(['p']),owned:new Set()});
    controller.pages.set('p',{...grant,tabId:1,groupId:-1,owned:false,attached:false,url});
    broker.forward = (method,params)=>controller.dispatch(method,params);
    controller.reply = message=>broker.engine.event(message.params);
    // Real browser CDP events travel through the extension controller and broker engine.
    const send = cdp.emit.bind(cdp);
    cdp.emit = (method,...args)=>{if(typeof method==='string') controller.event({tabId:1},method,args[0]);return send(method,...args);};
    let id=0;
    const call=(method,params={})=>broker.handle('test',{jsonrpc:'2.0',id:++id,method,params:{sessionId:'s',pageId:'p',...params}});
    const net=p=>call('network',p);
    await net({op:'start'});
    assert.equal((await call('snapshot')).title,'Network fixture');
    assert.equal(attaches,1);
    await page.evaluate(async()=>{ await fetch('/post',{method:'POST',headers:{'content-type':'text/plain'},body:'fixture-post'}).then(r=>r.text());await fetch('/redirect').then(r=>r.text()); });
    await assert.doesNotReject(async()=>{
      for(let n=0;n<50;n++) { const list=await net({op:'list',url:'/large'}); if(list.requests.some(x=>x.finished)) return; await new Promise(r=>setTimeout(r,20)); }
      throw Error('network_completion_timeout');
    });
    const list=await net({op:'list'});
    const post=list.requests.find(x=>x.url.endsWith('/post'));
    assert.equal(post.status,201);
    assert.equal((await call('wait',{condition:'request',value:'/post',timeoutMs:1000})).passed,true);
    assert.equal((await call('assert',{condition:'text',value:'Network fixture',timeoutMs:0})).passed,true);
    assert.equal((await call('assert',{condition:'url',value:url+'/missing',timeoutMs:0})).error,'condition_timeout');
    assert.equal((await net({op:'detail',requestId:post.requestId})).request.request.postData,'fixture-post');
    const hops=list.requests.filter(x=>x.url.endsWith('/redirect')||x.url.endsWith('/large'));
    assert.equal(hops.length,2);assert.notEqual(hops[0].requestId,hops[1].requestId);
    assert.equal(hops[0].status,302);assert.equal(hops[1].status,200);
    let text='',offset=0;
    do { const part=await net({op:'body',requestId:hops[1].requestId,offset,maxChars:30000}); text+=part.body;offset=part.nextOffset; } while(offset!==null);
    assert.equal(text,body);
    await net({op:'stop'});
    assert.equal((await call('snapshot')).title,'Network fixture');
    await page.evaluate(()=>fetch('/after-stop').then(r=>r.text()));
    assert.equal((await net({op:'list',url:'/after-stop'})).total,0);
    await controller.revoke('s');
    assert.equal(controller.network.pages.size,0);
    await assert.rejects(net({op:'list'}));
  } finally { broker.engine.drop(); await browser?.close(); await new Promise(r=>server.close(r)); }
});
