import { WebSocket } from 'ws';
import { Config } from './config.js';
import { Limit } from './protocol.js';
export class NativeHost {
  private input=Buffer.alloc(0);private ws:WebSocket;private queue:Buffer[]=[];
  constructor(cfg:any,origin:string){
    if(origin!==`chrome-extension://${cfg.extensionId}/`)throw Error('invalid_origin');
    if(new URL(cfg.url).hostname!=='127.0.0.1')throw Error('host_endpoint_forbidden');
    this.ws=new WebSocket(cfg.url,Config.tls(cfg));
    this.ws.on('open',()=>{for(const body of this.queue)this.ws.send(body.toString('utf8'));this.queue=[];});
    this.ws.on('message',data=>{const body=Buffer.from(data.toString());if(body.length>Limit.Frame)return this.stop();const head=Buffer.alloc(4);head.writeUInt32LE(body.length);process.stdout.write(Buffer.concat([head,body]));});
    this.ws.on('error',()=>this.stop());this.ws.on('close',()=>this.stop());
    process.stdin.on('data',(data:Buffer)=>this.feed(data));process.stdin.on('end',()=>this.stop());
  }
  private feed(data:Buffer):void{
    this.input=Buffer.concat([this.input,data]);
    while(this.input.length>=4){const size=this.input.readUInt32LE(0);if(size===0||size>Limit.Frame)return this.stop();if(this.input.length<size+4)return;
      const body=this.input.subarray(4,size+4);this.input=this.input.subarray(size+4);
      try{JSON.parse(body.toString('utf8'));}catch{return this.stop();}
      if(this.ws.readyState===WebSocket.OPEN)this.ws.send(body.toString('utf8'));else if(this.queue.length<8)this.queue.push(body);else return this.stop();
    }
  }
  private stop():void{this.ws.terminate();process.exit(0);}
}
try{new NativeHost(Config.load(process.argv[2]),process.argv[3]);}catch{process.stderr.write('host_start_failed\n');process.exitCode=1;}
