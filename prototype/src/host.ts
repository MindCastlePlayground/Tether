import { WebSocket } from 'ws';
import { Config } from './config.js';
import { Limit, NativeStatus as Status } from './protocol.js';
export class NativeHost {
  private input=Buffer.alloc(0);private ws:WebSocket;private queue:Buffer[]=[];private stopped=false;
  constructor(cfg:any,origin:string){
    if(origin!==`chrome-extension://${cfg.extensionId}/`)throw Error(Status.Origin);
    if(new URL(cfg.url).hostname!=='127.0.0.1')throw Error(Status.Config);
    this.ws=new WebSocket(cfg.url,{...Config.tls(cfg),handshakeTimeout:Status.Timeout});
    this.ws.on('open',()=>{NativeHost.status(Status.Connected);for(const body of this.queue)this.ws.send(body.toString('utf8'));this.queue=[];});
    this.ws.on('message',data=>{const body=Buffer.from(data.toString());if(body.length>Limit.Frame)return this.stop(Status.Frame);NativeHost.write(body);});
    this.ws.on('error',(err:NodeJS.ErrnoException)=>this.stop(err.code===Status.Refused?Status.Offline:Status.TLSCodes.has(err.code??'')||err.message===Status.Pin?Status.TLS:Status.Closed));
    this.ws.on('unexpected-response',(_req,response)=>{response.resume();this.stop(Status.Auth);});
    this.ws.on('close',()=>this.stop(Status.Closed));
    process.stdin.on('data',(data:Buffer)=>this.feed(data));process.stdin.on('end',()=>this.stop());
  }
  private feed(data:Buffer):void{
    this.input=Buffer.concat([this.input,data]);
    while(this.input.length>=4){const size=this.input.readUInt32LE(0);if(size===0||size>Limit.Frame)return this.stop(Status.Frame);if(this.input.length<size+4)return;
      const body=this.input.subarray(4,size+4);this.input=this.input.subarray(size+4);
      try{JSON.parse(body.toString('utf8'));}catch{return this.stop(Status.Frame);}
      if(this.ws.readyState===WebSocket.OPEN)this.ws.send(body.toString('utf8'));else if(this.queue.length<8)this.queue.push(body);else return this.stop(Status.Frame);
    }
  }
  private static write(body:Buffer,done?:()=>void):void{
    const head=Buffer.alloc(4);head.writeUInt32LE(body.length);process.stdout.write(Buffer.concat([head,body]),done);
  }
  private static status(state:string,code?:string,done?:()=>void):void{
    NativeHost.write(Buffer.from(JSON.stringify({type:Status.Type,state,code})),done);
  }
  private static fail(code:string):void{
    // Fixed codes only; never expose config paths, tokens or raw transport errors.
    process.stderr.write(`${code}\n`);NativeHost.status(Status.Error,code,()=>process.exit(1));
  }
  private stop(code?:string):void{
    if(this.stopped)return;this.stopped=true;this.ws.terminate();
    if(code)NativeHost.fail(code);else process.exit(0);
  }
  static run():void{
    process.stdout.on('error',()=>process.exit(1));
    try{new NativeHost(Config.load(process.argv[2]),process.argv[3]);}
    catch(err){NativeHost.fail(err instanceof Error&&err.message===Status.Origin?Status.Origin:Status.Config);}
  }
}
NativeHost.run();
