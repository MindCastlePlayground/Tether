import { chromium, type Browser, type Page, type ConnectOverCDPTransport } from 'playwright-core';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Find, Limit, Method, type Params, type Forward } from './protocol.js';
import { Finder, Snapshot } from './locator.js';
import { Business, BusinessMethod } from './business.js';
import { Html } from './html.js';

interface Call { payload: boolean }

class CDP {
  static readonly Version='Browser.getVersion'; static readonly Auto='Target.setAutoAttach';
  static readonly Info='Target.getTargetInfo'; static readonly Targets='Target.getTargets';
  static readonly Attached='Target.attachedToTarget'; static readonly Detached='Target.detachedFromTarget';
  static readonly Focus='Emulation.setFocusEmulationEnabled';
}
/** One authorized page per in-process engine: no global browser target discovery. */
export class TabTransport implements ConnectOverCDPTransport {
  onmessage?: (message:object)=>void; onclose?: (reason?:string)=>void;
  readonly methods=new Set<string>();
  private closed=false; private attached=false;
  private childSessions=new Set<string>();
  readonly root='bb-page';
  constructor(private sendRPC:Forward, readonly grant:Params, private info:Params,private version:Params,private calls?:AsyncLocalStorage<Call>){}
  send(message:object):void { const call=this.calls?.getStore();queueMicrotask(()=>{void this.dispatch(message as Params,call);}); }
  private async dispatch(m:Params,call?:Call):Promise<void>{
    if(this.closed) return;
    this.methods.add(m.method);
    try {
      let result:unknown;
      if(!m.sessionId){
        switch(m.method){
          case CDP.Version: result=this.version;break;
          case CDP.Auto:
            if(!this.attached){this.attached=true;this.onmessage?.({method:CDP.Attached,params:{sessionId:this.root,targetInfo:{...this.info,attached:true},waitingForDebugger:false}});}
            result={};break;
          case CDP.Info: result={targetInfo:this.info};break;
          case CDP.Targets: result={targetInfos:[this.info]};break;
          default:throw Error('cdp_forbidden');
        }
      }else{
        if(m.sessionId!==this.root){if(!this.childSessions.has(m.sessionId))throw Error('unsupported_frame');result=await this.sendRPC(Method.CDP,{...this.grant,childSessionId:m.sessionId,method:m.method,params:m.params??{}});}
        else result=await this.sendRPC(Method.CDP,{...this.grant,method:m.method,params:m.params??{}});
      }
      if(!this.closed)this.onmessage?.({id:m.id,sessionId:m.sessionId,result});
    }catch(error){
      const payload=error instanceof Error&&error.message===Limit.Payload;
      if(payload&&call)call.payload=true;
      if(/^[A-Za-z]+\.[A-Za-z]+$/.test(m.method))process.stderr.write(`cdp_failed:${m.method}\n`);
      if(!this.closed)this.onmessage?.({id:m.id,sessionId:m.sessionId,error:{code:-32000,message:payload?Limit.Payload:'cdp_forbidden_or_failed'}});
    }
  }
  event(p:Params):void{
    if(this.closed)return;
    const sessionId=typeof p.childSessionId==='string'?p.childSessionId:this.root;
    if(p.method==='Target.attachedToTarget'&&p.params?.targetInfo?.type==='iframe'&&typeof p.params?.sessionId==='string')this.childSessions.add(p.params.sessionId);
    if(p.method==='Target.detachedFromTarget'&&typeof p.params?.sessionId==='string')this.childSessions.delete(p.params.sessionId);
    this.onmessage?.({sessionId,method:p.method,params:p.params});
  }
  close():void {if(!this.closed){this.closed=true;this.onclose?.();}}
}

export class Engine {
  private calls=new AsyncLocalStorage<Call>();
  private engines=new Map<string,{transport:TabTransport,browser:Browser,page:Page}>();
  private transports=new Map<string,TabTransport>();
  private connects=new Map<string,Promise<Page>>();
  private business=new Map<string,Business>();
  constructor(private forward:Forward,private observeAllowed:(p:Params,url:string)=>boolean=()=>true){}
  private redact(target:Params,value:string):void{
    // Text-derived metadata can contain a truncated or escaped previous value.
    // Fill returns identity and structural metadata; refs remain actionable.
    for(const key of ['text','name','selector','context','actionable'])delete target[key];
    target.selectorUnique=false;
  }
  private key(p:Params):string{return `${p.clientId}/${p.sessionId}/${p.pageId}`;}
  async page(p:Params):Promise<Page>{
    const key=this.key(p);const existing=this.engines.get(key);if(existing)return existing.page;
    const pending=this.connects.get(key);if(pending)return pending;
    const promise=this.connect(p);this.connects.set(key,promise);
    try{return await promise;}finally{this.connects.delete(key);}
  }
  private async connect(p:Params):Promise<Page>{
    const key=this.key(p);
    const grant={clientId:p.clientId,sessionId:p.sessionId,pageId:p.pageId};
    const attached=await this.forward(Method.Attach,grant);
    if(!attached.targetInfo?.targetId||!attached.version?.product)throw Error('invalid_browser_info');
    const transport=new TabTransport(this.forward,grant,attached.targetInfo,attached.version,this.calls);
    this.transports.set(key,transport);
    try{
      await this.forward(Method.CDP,{...grant,method:CDP.Focus,params:{enabled:true}});
      const browser=await chromium.connectOverCDP(transport,{noDefaults:true,timeout:15000});
      const page=browser.contexts()[0]?.pages()[0];if(!page)throw Error('engine_page_missing');
      page.setDefaultTimeout(8000);this.engines.set(key,{transport,browser,page});this.business.set(key,new Business(page,key));return page;
    }catch{this.transports.delete(key);transport.close();await this.forward(Method.Detach,grant).catch(()=>{});throw Error('engine_connect_failed');}
  }
  async run(method:string,p:Params):Promise<Params>{
    const call:Call={payload:false};
    return this.calls.run(call,async()=>{
      try{return await this.execute(method,p);}
      catch(error){
        const message=error instanceof Error?error.message:'';
        if(call.payload||message.includes(Limit.Payload))throw Error(Limit.Payload);
        throw error;
      }
    });
  }
  private async execute(method:string,p:Params):Promise<Params>{
    const page=await this.page(p);
    if([BusinessMethod.UploadStart,BusinessMethod.UploadChunk,BusinessMethod.UploadFinish,BusinessMethod.UploadDrop,BusinessMethod.DownloadStart,BusinessMethod.DownloadRead,BusinessMethod.DownloadDrop,BusinessMethod.Dialog].includes(method as any)){
      let service=this.business.get(this.key(p));if(!service){service=new Business(page,this.key(p));this.business.set(this.key(p),service);}
      return service.run(method,p);
    }
    if(method===Method.Html)return {...await Html.read(page,p),sideEffect:'none',engine:'playwright-core'};
    if(method===Method.Snapshot)return {...await Finder.snapshot(page,p),engine:'playwright-core'};
    if(method===Method.Locate)return {...await Finder.locate(page,p),engine:'playwright-core'};
    if(method!==Method.Fill&&method!==Method.Click)throw Error('unsupported_method');
    // Resolve to exactly one element first: a refusal here guarantees nothing was executed.
    const r=await Finder.resolve(page,p,method);
    if('fail' in r)return {...r.fail,engine:'playwright-core'};
    const url=page.url();
    const doc=p.observe ? await page.evaluateHandle(()=>document) : undefined;
    const target=await Finder.target(page,r.loc);
    if(method===Method.Fill)this.redact(target,p.value);
    const result:Params={sideEffect:'applied',target,strategy:r.how,...(r.hint?{hint:r.hint}:{}),engine:'playwright-core'};
    const handle=await r.loc.elementHandle();
    try{if(!handle)throw Error('target_detached');if(method===Method.Fill)await handle.fill(p.value);else{await page.bringToFront();await handle.click({noWaitAfter:true});}}
    catch{result.sideEffect='possible';result.error='outcome_unknown';}
    finally{await handle?.dispose();}
    if(p.observe){
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        const observe=async()=>{
          if(!this.observeAllowed(p,page.url()))throw Error('observation_denied');
          const snapshot=await Finder.snapshot(page,{...p.observe,maxChars:p.observe.maxChars??Find.ObserveChars});
          if(snapshot.error)throw Error(snapshot.error);
          const navigated=page.url()!==url||!(await doc!.evaluate(d=>d===document).catch(()=>false));
          const values=await page.locator(Find.Fillable).evaluateAll(elements=>elements.map(el=>(el as HTMLInputElement).value??el.textContent??''));
          if(method===Method.Fill)values.push(p.value);
          let after:Params={url:snapshot.url,title:snapshot.title,navigated,tree:snapshot.tree,truncated:snapshot.truncated};
          for(const value of [...new Set(values)].filter(Boolean).sort((a,b)=>b.length-a.length)){
            for(const key of ['url','title','tree']){
              const escaped=JSON.stringify(value).slice(1,-1);
              after[key]=after[key].split(/(\[ref=[a-z0-9]+\])/g).map((part:string)=>/^\[ref=/.test(part)?part:part.replaceAll(value,'[redacted]').replaceAll(escaped,'[redacted]')).join('');
            }
          }
          const cut=Snapshot.cut(after.tree,Math.min(p.observe.maxChars??Find.ObserveChars,Find.Chars));
          after.tree=cut.tree;after.truncated||=cut.truncated;
          if(!this.observeAllowed(p,page.url()))throw Error('observation_denied');
          return after;
        };
        result.after=await Promise.race([observe(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('observation_timeout')),Find.ObserveMs);})]);
        result.observed=true;
      }catch(error){result.observed=false;result.observationError=error instanceof Error&&['scope_not_found','scope_ambiguous','scope_conflict','ref_stale','observation_timeout','observation_denied'].includes(error.message)?error.message:'observation_failed';}
      finally{if(timer)clearTimeout(timer);await doc?.dispose();}
    }
    return result;
  }
  event(p:Params):void{if(p.method==='Page.javascriptDialogClosed'&&!p.childSessionId)this.business.get(this.key(p))?.closedDialog();this.transports.get(this.key(p))?.event(p);}
  drop(clientId?:string,sessionId?:string):void{
    for(const [key,t]of this.transports){if(clientId&&t.grant.clientId!==clientId)continue;if(sessionId&&t.grant.sessionId!==sessionId)continue;const page=this.engines.get(key)?.page;if(page)void Html.drop(page);t.close();this.business.get(key)?.close();this.business.delete(key);this.transports.delete(key);this.engines.delete(key);}
  }
}
