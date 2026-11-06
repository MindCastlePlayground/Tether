import { readFile } from 'node:fs/promises';
import type { NetworkParams, WaitParams, RecordsParams } from './client-constants.js';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { Config } from './config.js';
import { Rpc, type Method } from './client-constants.js';
export interface ClientConfig { url:string;token:string;caFile:string;pin:string }
export class ClientError extends Error {
  constructor(readonly code:string, readonly rpcCode?:number){super(code);this.name='ClientError';}
}
export class BridgeClient {
  private ws?:WebSocket;private opening?:Promise<void>;
  private pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  constructor(readonly config:ClientConfig){BridgeClient.validate(config);}
  static validate(c:ClientConfig):void{
    try{const u=new URL(c.url);if(u.protocol!=='wss:'||!Config.privateIP(u.hostname)||u.pathname!=='/bridge'||u.search||u.username||u.password||!c.token||!c.caFile||!/^[A-Za-z0-9+/]{43}=$/.test(c.pin))throw Error();}catch{throw new ClientError('invalidConfig');}
  }
  async connect():Promise<void>{
    if(this.ws?.readyState===WebSocket.OPEN)return;
    if(this.opening)return this.opening;
    this.opening=new Promise<void>((resolve,reject)=>{
      const ws=new WebSocket(this.config.url,Config.tls(this.config));this.ws=ws;
      const timer=setTimeout(()=>{ws.terminate();reject(new ClientError('connectionTimeout'));},10000);
      ws.once('open',()=>{clearTimeout(timer);resolve();});
      ws.on('error',(error)=>{clearTimeout(timer);const e=error as NodeJS.ErrnoException;const msg=error.message;const code=/CERT|certificate|self signed|unable to verify|pin_mismatch/i.test(msg)?'tls_failed':/server response: 403/i.test(msg)?'authentication_failed':/server response: 409/i.test(msg)?'broker_busy':['ECONNREFUSED','EHOSTUNREACH','ENETUNREACH'].includes(e.code??'')?'broker_unavailable':'connectionFailed';reject(new ClientError(code));});
      ws.on('close',()=>{this.opening=undefined;this.ws=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new ClientError('connectionClosed'));}this.pending.clear();});
      ws.on('message',data=>{try{const m=JSON.parse(data.toString());const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new ClientError(m.error.message,m.error.code));else p.resolve(m.result);}catch{ws.close(1008);}});
    }).catch(e=>{this.opening=undefined;throw e instanceof ClientError?e:new ClientError('invalidConfig');});return this.opening;
  }
  async call<T=any>(method:Method,params:Record<string,unknown>):Promise<T>{
    if(!(Rpc.METHODS as readonly string[]).includes(method))throw new ClientError('unsupportedMethod');
    await this.connect();const id=randomUUID();return new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new ClientError('outcome_unknown'));},25000);
      this.pending.set(id,{resolve,reject,timer});this.ws!.send(JSON.stringify({jsonrpc:Rpc.JSONRPC,id,method,params}));
    });
  }
  close():void{this.ws?.close();}
  requestSession(p:{mode:'newGroup'|'attachExisting';url?:string;tabId?:number;groupName?:string}){return this.call('requestSession',p);}
  availableTabs(){return this.call('availableTabs',{});}
  approvalStatus(p:{pendingId:string}){return this.call('approvalStatus',p);}
  listTabs(p:{sessionId:string}){return this.call('listTabs',p);}
  createTab(p:{sessionId:string;seq:number;url?:string}){return this.call('createTab',p);}
  closeTab(p:{sessionId:string;pageId:string;seq:number}){return this.call('closeTab',p);}
  release(p:{sessionId:string;seq:number}){return this.call('release',p);}
  html(p:{sessionId:string;pageId:string;offset?:number;maxChars?:number;captureId?:string}){return this.call('html',p);}
  fill(p:{sessionId:string;pageId:string;seq:number;selector?:string;ref?:string;value:string;observe?:{scope?:string;scopeRef?:string;maxChars?:number}}){return this.call('fill',p);}
  click(p:{sessionId:string;pageId:string;seq:number;selector?:string;ref?:string;observe?:{scope?:string;scopeRef?:string;maxChars?:number}}){return this.call('click',p);}
  snapshot(p:{sessionId:string;pageId:string;scope?:string;scopeRef?:string;outline?:boolean;depth?:number;maxChars?:number}){return this.call('snapshot',p);}
  locate(p:{sessionId:string;pageId:string;text?:string;role?:string;name?:string;exact?:boolean;selector?:string;ref?:string;scope?:string;scopeRef?:string}){return this.call('locate',p);}
  navigate(p:{sessionId:string;pageId:string;seq:number;url:string}){return this.call('navigate',p);}
  capabilities(){return this.call('capabilities',{});}
  network(p:NetworkParams){return this.call('network',{...p});}
  diagnose(){return this.call('diagnose',{});}
  wait(p:WaitParams){return this.call('wait',{...p});}
  assert(p:WaitParams){return this.call('assert',{...p});}
  records(p:RecordsParams={}){return this.call('records',{...p});}
}
export async function loadConfig(path:string):Promise<ClientConfig>{try{const c=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));BridgeClient.validate(c);return c;}catch{throw new ClientError('invalidConfig');}}
