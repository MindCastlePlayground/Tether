import { WebSocket } from 'ws';
import { dirname, join } from 'node:path';
import { Config } from './config.js';
import { BrokerLifecycle } from './lifecycle.js';
import { Limit, NativeStatus as Status, BrokerControl as C, PolicyKey } from './protocol.js';

export class NativeHost {
  private input=Buffer.alloc(0);
  private ws?:WebSocket;
  private queue:Buffer[]=[];
  private stopped=false;
  private task=Promise.resolve();
  private life:BrokerLifecycle;
  private retry?:NodeJS.Timeout;
  private delay:number=C.RetryMs;
  private root:string;
  constructor(private cfg:any,origin:string,file:string){
    if(origin!==`chrome-extension://${cfg.extensionId}/`)throw Error(Status.Origin);
    if(new URL(cfg.url).hostname!=='127.0.0.1')throw Error(Status.Config);
    Config.tls(cfg);
    this.life=new BrokerLifecycle(file);
    this.root=dirname(dirname(file));
    process.stdin.on('data',(data:Buffer)=>this.feed(data));
    process.stdin.on('end',()=>this.stop());
    this.enqueue(()=>this.cycle());
  }
  private enqueue(fn:()=>Promise<void>):void {
    this.task=this.task.then(fn).catch(()=>NativeHost.status(Status.Error,C.Error));
  }
  private async cycle(mode?:string,restore=false):Promise<void>{
    if(this.stopped)return;
    const prior=this.life.state();
    const change=mode&&(!restore||mode!==prior.mode);
    const state=change ? await this.life.set(mode!) : prior.mode===C.Auto ? await this.life.ensure() : await this.life.inspect();
    const policy=this.life.policy();const build=this.build();
    NativeHost.write(Buffer.from(JSON.stringify({type:C.Status,...state,...(policy?{[PolicyKey.Summary]:policy}:{}),...(build?{[C.Extension]:{[C.Build]:build}}:{})})));
    if(state.state===C.Running){this.connect();return;}
    if(state.mode!==C.Off)this.later();
    if(state.state===C.Starting&&this.ws?.readyState===WebSocket.OPEN)return;
    if(this.ws){this.ws.terminate();this.ws=undefined;}
    this.queue=[];
    NativeHost.status(Status.Error,state.code??(state.mode===C.Off?C.Disabled:Status.Offline));
  }
  private connect():void {
    if(this.stopped||this.ws?.readyState===WebSocket.OPEN||this.ws?.readyState===WebSocket.CONNECTING)return;
    const ws=new WebSocket(this.cfg.url,{...Config.tls(this.cfg),handshakeTimeout:Status.Timeout});this.ws=ws;
    ws.on('open',()=>{if(this.ws!==ws)return;this.delay=C.RetryMs;NativeHost.status(Status.Connected);for(const body of this.queue)ws.send(body.toString('utf8'));this.queue=[];});
    ws.on('message',data=>{const body=Buffer.from(data.toString());if(body.length>Limit.Frame)return this.stop(Status.Frame);NativeHost.write(body);});
    let reported=false;
    const failed=(code:string)=>{if(this.ws!==ws)return;this.ws=undefined;this.queue=[];reported=true;NativeHost.status(Status.Error,code);ws.terminate();this.later();};
    ws.on('error',(err:NodeJS.ErrnoException)=>failed(err.code===Status.Refused?Status.Offline:Status.TLSCodes.has(err.code??'')||err.message===Status.Pin?Status.TLS:Status.Closed));
    ws.on('unexpected-response',(_req,response)=>{response.resume();failed(Status.Auth);});
    ws.on('close',()=>{if(!reported)failed(Status.Closed);});
  }
  // The build on disk lets an already loaded extension notice an upgrade and reload itself.
  private build():string|undefined{
    try{
      let dir=join(this.root,C.Folder);
      try{dir=Config.load(join(this.root,C.Location)).path??dir;}catch{/* Default extension folder. */}
      const m=Config.load(join(dir,C.Manifest));const b=m.version_name??m.version;
      return typeof b==='string'?b:undefined;
    }catch{return undefined;}
  }
  // Recover on our own after a Broker restart; older extensions never send probes.
  private later():void{
    if(this.stopped||this.retry)return;
    this.retry=setTimeout(()=>{this.retry=undefined;this.enqueue(()=>this.cycle());},this.delay);
    this.delay=Math.min(this.delay*2,C.RetryMax);
  }
  private feed(data:Buffer):void{
    this.input=Buffer.concat([this.input,data]);
    while(this.input.length>=4){
      const size=this.input.readUInt32LE(0);if(size===0||size>Limit.Frame)return this.stop(Status.Frame);if(this.input.length<size+4)return;
      const body=this.input.subarray(4,size+4);this.input=this.input.subarray(size+4);
      let msg:any;try{msg=JSON.parse(body.toString('utf8'));}catch{return this.stop(Status.Frame);}
      if(msg?.type===C.Type){
        if(msg.action===C.Mode&&C.Modes.includes(msg.mode))this.enqueue(()=>this.cycle(msg.mode,msg.restore===true));
        else if(msg.action===C.Probe)this.enqueue(()=>this.cycle());
        else NativeHost.status(Status.Error,C.Error);
        continue;
      }
      if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(body.toString('utf8'));
      else if(this.ws?.readyState===WebSocket.CONNECTING&&this.queue.length<8)this.queue.push(body);
      else NativeHost.status(Status.Error,Status.Offline);
    }
  }
  private static write(body:Buffer,done?:()=>void):void{
    const head=Buffer.alloc(4);head.writeUInt32LE(body.length);process.stdout.write(Buffer.concat([head,body]),done);
  }
  private static status(state:string,code?:string,done?:()=>void):void{NativeHost.write(Buffer.from(JSON.stringify({type:Status.Type,state,code})),done);}
  private static fail(code:string):void{process.stderr.write(`${code}\n`);NativeHost.status(Status.Error,code,()=>process.exit(1));}
  private stop(code?:string):void{
    if(this.stopped)return;this.stopped=true;clearTimeout(this.retry);this.ws?.terminate();
    if(code)NativeHost.fail(code);else process.exit(0);
  }
  static run():void{
    process.stdout.on('error',()=>process.exit(1));
    try{new NativeHost(Config.load(process.argv[2]),process.argv[3],process.argv[2]);}
    catch(err){NativeHost.fail(err instanceof Error&&err.message===Status.Origin?Status.Origin:Status.Config);}
  }
}
NativeHost.run();
