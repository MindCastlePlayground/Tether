import{spawn}from'node:child_process';
import{resolve}from'node:path';
import{once}from'node:events';
import{writeFileSync,mkdirSync}from'node:fs';
import{BridgeClient,loadConfig}from'../dist/client.js';
const cfg=await loadConfig('.local/host.json');
const client=new BridgeClient(await loadConfig('.local/script.json'));
const result={at:new Date().toISOString(),scope:'real native executable, simulated extension peer',checks:[]};
let child;let buffer=Buffer.alloc(0);
try{
 if((await client.capabilities()).browserConnected)throw Error('real_host_already_connected_skip');
 child=spawn(resolve('.local/host.exe'),[`chrome-extension://${cfg.extensionId}/`],{stdio:'pipe'});
 child.stderr.on('data',()=>{});
 child.stdout.on('data',data=>{
  buffer=Buffer.concat([buffer,data]);
  while(buffer.length>=4){const n=buffer.readUInt32LE();if(n>512*1024)throw Error('native_framing_failed');if(buffer.length<n+4)return;
   const req=JSON.parse(buffer.subarray(4,n+4));buffer=buffer.subarray(n+4);
   const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:req.id,result:req.method==='requestSession'?{pendingId:'native-transport-probe',status:'pending'}:{ok:true}}));
   const head=Buffer.alloc(4);head.writeUInt32LE(body.length);
   // Deliberately fragmented input, including the length header.
   child.stdin.write(head.subarray(0,2));child.stdin.write(head.subarray(2));child.stdin.write(body);
  }
 });
 for(let i=0;i<30;i++){if((await client.capabilities()).browserConnected)break;await new Promise(r=>setTimeout(r,100));}
 const response=await client.requestSession({mode:'newGroup'});
 if(response.pendingId!=='native-transport-probe')throw Error('native_roundtrip_failed');
 result.checks.push({name:'native_length_prefixed_fragmented_roundtrip',pass:true});
 const exited=once(child,'exit');child.stdin.end();await exited;
 result.checks.push({name:'native_stdin_eof_stops_host',pass:true});
 const invalid=spawn(resolve('.local/host.exe'),['chrome-extension://invalid/'],{stdio:'pipe'});invalid.stderr.resume();invalid.stdout.resume();
 const[code]=await once(invalid,'exit');result.checks.push({name:'native_origin_mismatch_rejected',pass:code!==0});
}catch(e){result.error=e.message;process.exitCode=1;}finally{client.close();child?.stdin.destroy();mkdirSync('evidence',{recursive:true});writeFileSync('evidence/native.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
