import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { BlockList } from 'node:net';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Policy } from './policy.js';
import { WebSocketServer, WebSocket } from 'ws';
import { Config } from './config.js';
import { Engine } from './engine.js';
import { Support, Journal, Conditions } from './support.js';
import { BusinessApi } from './business-api.js';
import { BusinessMethod } from './business.js';
import { Method, Limit, Wire, Action, Effect, PolicyKey, Brand, BrokerControl as Control, Find, PUBLIC, WRITES, type RPC, type Params } from './protocol.js';

interface Pending {resolve:(v:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout;}
interface Ledger {high:number; records:Map<number,{body:string,result:Promise<any>,at:number}>; tail:Promise<any>;}
export class Broker {
  static { for(const method of BusinessApi.Names){PUBLIC.add(method);if(method!==BusinessApi.PopupCandidates)WRITES.add(method);} }
  private journal=new Journal();
  private host?:WebSocket; private clients=new Map<string,WebSocket>();
  private pending=new Map<string,Pending>();private ledger=new Map<string,Ledger>();
  private engine=new Engine((m,p)=>this.forward(m,p),(p,url)=>this.policy.check(Broker.identity(p.clientId),Action.Observe,url)!==Effect.Deny);
  private servers:Server[]=[];private sockets=new Set<WebSocket>();
  private timer?:NodeJS.Timeout;
  private policy:Policy;
  constructor(private cfg:any,file?:string){this.policy=new Policy(cfg.policyFile??join(file?dirname(file):process.cwd(),PolicyKey.File));}
  async start():Promise<void>{
    const binds=[{ip:'127.0.0.1',port:this.cfg.port,cidrs:['127.0.0.1/32']}];
    if(this.cfg.lan){if(!Config.privateIP(this.cfg.lan.ip)||this.cfg.lan.ip==='127.0.0.1'||!this.cfg.lan.cidrs?.length)throw Error('invalid_lan');binds.push(this.cfg.lan);}
    try { for(const bind of binds){
      const allow=new BlockList();for(const cidr of bind.cidrs){const [ip,bits]=cidr.split('/');if(!Config.privateIP(ip)||!/^\d+$/.test(bits)||+bits<8||+bits>32)throw Error('invalid_cidr');allow.addSubnet(ip,+bits,'ipv4');}
      const server=createServer({key:readFileSync(this.cfg.keyFile),cert:readFileSync(this.cfg.certFile),minVersion:'TLSv1.2'},(req,res)=>this.control(req,res));
      const wss=new WebSocketServer({noServer:true,maxPayload:Limit.Frame,perMessageDeflate:false});
      server.on('upgrade',(req,socket,head)=>{
        const ip=req.socket.remoteAddress??'';const auth=req.headers[Wire.Auth];
        const token=typeof auth==='string'&&auth.startsWith(Wire.Bearer)?auth.slice(Wire.Bearer.length):'';
        const hash=Config.hash(token);const identity=Object.entries(this.cfg.tokens as Record<string,string>).find(([,v])=>v.length===hash.length&&timingSafeEqual(Buffer.from(v),Buffer.from(hash)))?.[0];
        if(req.url!==Wire.Path||req.headers[Wire.Origin]!==undefined||!allow.check(ip,'ipv4')||!identity||(identity===Wire.Host&&ip!=='127.0.0.1')){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
        if(identity===Wire.Host&&this.host){socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');return;}
        if(identity!==Wire.Host&&this.clients.size>=Limit.Clients){socket.end(Wire.Busy);return;}
        // Each client connection is its own instance, so several agents can share one credential.
        const id=identity===Wire.Host?identity:this.instance(identity);
        wss.handleUpgrade(req,socket,head,ws=>this.connected(ws,id));
      });
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(bind.port,bind.ip,()=>resolve());});this.servers.push(server);
    } } catch (err) { await this.stop(); throw err; }
    this.timer=setInterval(()=>{if(this.host)for(const clientId of this.clients.keys())void this.forward(Method.Heartbeat,{clientId}).catch(()=>{this.host?.terminate();});},Limit.Heartbeat);
  }
  private control(req:IncomingMessage,res:ServerResponse):void {
    const auth=req.headers[Wire.Auth];
    const token=typeof auth==='string'&&auth.startsWith(Wire.Bearer)?auth.slice(Wire.Bearer.length):'';
    const hash=Config.hash(token);
    const id=Object.entries(this.cfg.tokens as Record<string,string>).find(([,v])=>v.length===hash.length&&timingSafeEqual(Buffer.from(v),Buffer.from(hash)))?.[0];
    if(req.socket.remoteAddress!=='127.0.0.1'||req.headers[Wire.Origin]!==undefined||!id){res.writeHead(403);res.end();return;}
    const health=req.method===Control.Get&&req.url===Control.Health;
    const stop=req.method===Control.Post&&req.url===Control.Stop&&id===Wire.Host;
    if(!health&&!stop){res.writeHead(404);res.end();return;}
    res.writeHead(200);res.end(JSON.stringify({name:Brand.Name,version:Brand.Version}));
    if(stop)setImmediate(()=>void this.stop());
  }
  private connected(ws:WebSocket,identity:string):void{
    this.sockets.add(ws);ws.on('error',()=>{});
    if(identity===Wire.Host)this.host=ws;else this.clients.set(identity,ws);
    ws.on('message',data=>{
      let msg:RPC;try{msg=JSON.parse(data.toString());}catch{ws.close(1008);return;}
      if(identity===Wire.Host){
        if(msg.method===Method.Event){this.engine.event(msg.params??{});return;}
        const pending=this.pending.get(String(msg.id));if(!pending)return;clearTimeout(pending.timer);this.pending.delete(String(msg.id));
        if(msg.error)pending.reject(Error(/^[a-z_]+$/.test(msg.error.message)?msg.error.message:'extension_error'));else pending.resolve(msg.result);return;
      }
      void this.handle(identity,msg).then(result=>{if(ws.readyState===WebSocket.OPEN)this.send(ws,{jsonrpc:Wire.Version,id:msg.id,result});},e=>{
        if(ws.readyState===WebSocket.OPEN)this.send(ws,{jsonrpc:Wire.Version,id:msg.id,error:{code:-32000,message:/^[a-z_]+$/.test(e.message)?e.message:'request_failed'}});
      });
    });
    ws.on('close',()=>{
      this.sockets.delete(ws);
      if(identity===Wire.Host){this.host=undefined;this.engine.drop();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('host_disconnected'));}this.pending.clear();for(const c of this.clients.values())c.close(1011);}
      else{this.clients.delete(identity);this.engine.drop(identity);void this.forward(Method.Lost,{clientId:identity}).catch(()=>{});for(const key of this.ledger.keys())if(key.startsWith(identity+'/'))this.ledger.delete(key);}
    });
  }
  private instance(identity:string):string{let id:string;do id=identity+Wire.Instance+randomUUID().slice(0,8);while(this.clients.has(id));return id;}
  static identity(clientId:string):string{return clientId.split(Wire.Instance)[0];}
  private send(ws:WebSocket,msg:RPC):void{const body=JSON.stringify(msg);if(Buffer.byteLength(body)>Limit.Frame){ws.close(1009);return;}ws.send(body);}
  private forward(method:string,params:Params):Promise<any>{
    if(!this.host||this.host.readyState!==WebSocket.OPEN)return Promise.reject(Error('host_unavailable'));
    if(this.pending.size>=128)return Promise.reject(Error('queue_full'));
    const id=randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('outcome_unknown'));},Limit.Wait);
      this.pending.set(id,{resolve,reject,timer});this.send(this.host!,{jsonrpc:Wire.Version,id,method,params});
    });
  }
  async handle(clientId:string,msg:RPC):Promise<any>{
    const start=Date.now();
    try{const result=await this.dispatch(clientId,msg);this.journal.add(Broker.identity(clientId),msg.method??'invalid',start,result);return result;}
    catch(e){this.journal.add(Broker.identity(clientId),msg.method??'invalid',start,undefined,(e as Error).message);throw e;}
  }
  private async dispatch(clientId:string,msg:RPC):Promise<any>{
    if(msg.jsonrpc!==Wire.Version||msg.id===undefined||!msg.method||!(PUBLIC.has(msg.method)||Support.Methods.includes(msg.method))||!msg.params||typeof msg.params!=='object'||Array.isArray(msg.params)||Object.hasOwn(msg.params,'clientId'))throw Error('invalid_request');
    if(msg.method===Support.Records)return this.journal.read(Broker.identity(clientId),msg.params.op??'list');
    if(msg.method===Support.Diagnose){
      let browser;let code;try{browser=await this.forward(Method.Capabilities,{clientId});}catch(e){code=(e as Error).message;}
      const versionMatch=browser?.version?browser.version===Brand.Version:null;
      return {version:Brand.Version,extensionVersion:browser?.version??null,versionMatch,broker:'connected',nativeHost:this.host?'connected':'disconnected',browser:browser?'responsive':'unavailable',code,policy:this.policy.summary(),hint:versionMatch===false?'Update the runtime and reload the matching extension.':browser?'ready':'Load the matching extension and inspect Native Messaging status in its popup.'};
    }
    if(msg.method===Support.Wait||msg.method===Support.Assert)return Conditions.run({...msg.params,clientId},(method,p)=>this.dispatch(clientId,{jsonrpc:Wire.Version,id:msg.id,method,params:Object.fromEntries(Object.entries(p).filter(([k])=>k!=='clientId'))}));
    if(msg.method===Method.Capabilities)return {prototype:'M0',version:Brand.Version,browserConnected:!!this.host,engine:'playwright-core-1.64.0',available:[...PUBLIC,...Support.Methods],locators:['ref','selector','role','text','xpath-text-rewrite','actionable-ancestor'],unsupported:['rawCDP'],policy:this.policy.summary()};
    if(BusinessApi.Names.includes(msg.method))BusinessApi.valid(msg.method,msg.params);
    const params:Params={...msg.params,clientId};
    const who=Broker.identity(clientId);this.policy.check(who,null,null);
    const action=msg.method===Method.Request?Action.Session:Find.Reads.has(msg.method)||msg.method===Method.Network?Action.Observe:Object.values(Action).find(a=>a===msg.method)??null;
    let origin:string|null=null;let pages:Params[]|undefined;
    if(action===Action.Navigate||action===Action.Create||(action===Action.Session&&params.mode===PolicyKey.New))origin=params.url??null;
    else if([Action.Observe,Action.Fill,Action.Click,Action.Close].includes(action as Action)||(action===Action.Session&&params.mode===PolicyKey.Attach)){
      try{
        const tabs=await this.forward(action===Action.Session?Method.Available:Method.Tabs,{clientId,sessionId:params.sessionId});
        pages=Array.isArray(tabs)?tabs:(tabs?.pages??tabs?.tabs??[]);
        origin=pages?.find(v=>action===Action.Session?v.tabId===params.tabId:v.pageId===params.pageId)?.url??null;
      }catch{}
    }
    const effect=this.policy.check(who,action,origin);
    if(effect===Effect.Deny)throw Error(PolicyKey.Denied);
    delete params[PolicyKey.Ask];if(effect===Effect.Ask)params[PolicyKey.Ask]=true;
    if(!WRITES.has(msg.method))return this.run(msg.method,params,pages);
    // Writes re-read pages inside the queue so earlier writes in the session are reflected.
    if(typeof params.sessionId!=='string'||!Number.isSafeInteger(params.seq)||params.seq<=0)throw Error('invalid_seq');
    // Refuse before recording the seq, so host_unavailable always means "not executed" and is safe to retry.
    if(!this.host||this.host.readyState!==WebSocket.OPEN)throw Error('host_unavailable');
    const key=`${clientId}/${params.sessionId}`;let l=this.ledger.get(key);
    if(!l){l={high:0,records:new Map(),tail:Promise.resolve()};this.ledger.set(key,l);}
    const body=JSON.stringify([msg.method,Object.entries(msg.params).sort(([a],[b])=>a.localeCompare(b))]);
    const old=l.records.get(params.seq);
    if(old){if(Date.now()-old.at>300000)throw Error('request_expired');if(old.body!==body)throw Error('request_conflict');return old.result;}
    if(params.seq<=l.high)throw Error('request_expired');
    if(l.records.size>=Limit.Records)throw Error('queue_full');
    // Dialog handling must unblock an in-flight click instead of waiting behind it.
    const dialog=msg.method===BusinessMethod.Dialog;
    // A dialog may arrive while the earlier click is still checking page policy.
    // Reserve its sequence without expiring that earlier request.
    if(!dialog)l.high=params.seq;
    const result=(dialog?Promise.resolve():l.tail.catch(()=>{})).then(()=>{if(!this.clients.has(clientId))throw Error('client_disconnected');return this.run(msg.method!,params);});
    l.tail=dialog?Promise.allSettled([l.tail,result]).then(()=>{}):result;l.records.set(params.seq,{body,result,at:Date.now()});return result;
  }
  private async run(method:string,p:Params,known?:Params[]):Promise<any>{
    if(method===BusinessApi.PopupCandidates||method===BusinessApi.AdoptPopup){
      const candidates=await this.forward(BusinessApi.PopupCandidates,{clientId:p.clientId,sessionId:p.sessionId});
      const tabs=(candidates.tabs??[]).filter((tab:Params)=>this.policy.check(Broker.identity(p.clientId),Action.Create,tab.url??null)!==Effect.Deny);
      if(method===BusinessApi.PopupCandidates)return {tabs};
      if(!tabs.some((tab:Params)=>tab.tabId===p.tabId&&tab.openerPageId===p.openerPageId))throw Error(PolicyKey.Denied);
      return this.forward(method,p);
    }
    if(BusinessApi.Names.includes(method)){
      const tabs=await this.forward(Method.Tabs,{clientId:p.clientId,sessionId:p.sessionId});
      const page=(tabs.pages??tabs).find((v:Params)=>v.pageId===p.pageId);
      if(!page)throw Error('page_forbidden');
      const action=method.startsWith('upload')?Action.Fill:method===BusinessMethod.Dialog?Action.Click:Action.Observe;
      if(this.policy.check(Broker.identity(p.clientId),action,page.url??null)===Effect.Deny)throw Error(PolicyKey.Denied);
      return this.engine.run(method,p);
    }
    if(method===Method.Network){
      const tabs=await this.forward(Method.Tabs,{clientId:p.clientId,sessionId:p.sessionId});
      const pages:Params[]=Array.isArray(tabs)?tabs:(tabs.pages??tabs.tabs??[]);
      const page=pages.find(v=>v.pageId===p.pageId);if(!page)throw Error('page_forbidden');
      if(this.policy.check(Broker.identity(p.clientId),Action.Observe,page.url??null)===Effect.Deny)throw Error(PolicyKey.Denied);
      const result=await this.forward(method,p);
      // Navigation or policy changes during a body read must not bypass observe rules.
      const current=await this.forward(Method.Tabs,{clientId:p.clientId,sessionId:p.sessionId});
      const now:Params[] = Array.isArray(current)?current:(current.pages??current.tabs??[]);
      const active=now.find(v=>v.pageId===p.pageId);if(!active)throw Error('page_forbidden');
      if(this.policy.check(Broker.identity(p.clientId),Action.Observe,active.url??null)===Effect.Deny)throw Error(PolicyKey.Denied);
      return result;
    }
    if(Find.Engine.has(method)){
      // Ask authority on every request, even when reusing an engine. Queued writes re-check policy on fresh state.
      let pages:Params[]=known??[];
      if(!known||WRITES.has(method)){const tabs=await this.forward(Method.Tabs,{clientId:p.clientId,sessionId:p.sessionId});pages=Array.isArray(tabs)?tabs:(tabs.pages??tabs.tabs??[]);}
      const page=pages.find((v:Params)=>v.pageId===p.pageId);if(!page)throw Error('page_forbidden');
      if(this.policy.check(Broker.identity(p.clientId),Find.Reads.has(method)?Action.Observe:method as Action,page.url??null)===Effect.Deny)throw Error(PolicyKey.Denied);
      Broker.validate(method,p);
      if(method===Method.Html){
        const result=await this.engine.run(method,p);
        const current=await this.forward(Method.Tabs,{clientId:p.clientId,sessionId:p.sessionId});
        const active=(Array.isArray(current)?current:current.pages??[]).find((v:Params)=>v.pageId===p.pageId);
        if(!active)throw Error('page_forbidden');
        if(this.policy.check(Broker.identity(p.clientId),Action.Observe,active.url??null)===Effect.Deny)throw Error(PolicyKey.Denied);
        return result;
      }
      try{return await this.engine.run(method,p);}catch{if(!WRITES.has(method))throw Error('engine_failed');return {sideEffect:'possible',error:'outcome_unknown'};}
    }
    const result=await this.forward(method,p);
    if(method===Method.Release)this.engine.drop(p.clientId,p.sessionId);
    return result;
  }
  static validate(method:string,p:Params):void{
    if(method===Method.Html){
      if(typeof p.sessionId!=='string'||!p.sessionId||typeof p.pageId!=='string'||!p.pageId||
        p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||p.offset<0)||
        p.maxChars!==undefined&&(!Number.isSafeInteger(p.maxChars)||p.maxChars<1||p.maxChars>30000)||
        p.captureId!==undefined&&(typeof p.captureId!=='string'||!p.captureId||p.captureId.length>100)||
        (p.offset??0)>0&&!p.captureId)throw Error('invalid_params');
      return;
    }
    const text=(v:unknown,max=2000)=>v===undefined||(typeof v==='string'&&v.length>0&&v.length<=max);
    const ref=p.ref===undefined||(typeof p.ref==='string'&&Find.Ref.test(p.ref));
    const scoped=(scope:unknown,scopeRef:unknown)=>text(scope)&& (scopeRef===undefined||typeof scopeRef==='string'&&Find.Ref.test(scopeRef))&&!(scope!==undefined&&scopeRef!==undefined);
    const observe=(v:unknown)=>v===undefined||!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['scope','scopeRef','maxChars'].includes(k))&&scoped((v as Params).scope,(v as Params).scopeRef)&&((v as Params).maxChars===undefined||Number.isSafeInteger((v as Params).maxChars)&&(v as Params).maxChars as number>0);
    let ok=text(p.selector)&&ref;
    if(method===Method.Fill||method===Method.Click)ok&&=(p.selector===undefined)!==(p.ref===undefined)&&observe(p.observe)&&(method!==Method.Fill||(typeof p.value==='string'&&p.value.length<=16000));
    if(method===Method.Locate)ok&&=text(p.text)&&text(p.role,64)&&text(p.name)&&(p.exact===undefined||typeof p.exact==='boolean')&&scoped(p.scope,p.scopeRef)&&[p.selector,p.ref,p.role,p.text].some(v=>v!==undefined);
    if(method===Method.Snapshot)ok&&=scoped(p.scope,p.scopeRef)&&(p.outline===undefined||typeof p.outline==='boolean')&&[p.depth,p.maxChars].every(v=>v===undefined||Number.isSafeInteger(v)&&v>0);
    if(!ok)throw Error('invalid_params');
  }
  async stop():Promise<void>{if(this.timer)clearInterval(this.timer);this.engine.drop();for(const ws of this.sockets)ws.terminate();await Promise.all(this.servers.map(s=>new Promise<void>(r=>s.close(()=>r()))));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const app=new Broker(Config.load(process.argv[2]),process.argv[2]);app.start().then(()=>process.stderr.write('broker_ready\n')).catch(()=>{process.stderr.write('broker_start_failed\n');process.exitCode=1;});
  process.on('SIGINT',()=>void app.stop());process.on('SIGTERM',()=>void app.stop());
}
