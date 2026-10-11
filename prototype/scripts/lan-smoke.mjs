import{networkInterfaces}from'node:os';
import{writeFileSync,mkdirSync}from'node:fs';
import{Broker}from'../dist/broker.js';
import{Config}from'../dist/config.js';
import{BridgeClient}from'../dist/client.js';
const ip=Object.values(networkInterfaces()).flat().find(x=>x?.family==='IPv4'&&!x.internal&&x.address==='192.168.3.7')?.address;
const evidence={at:new Date().toISOString(),scope:'same Windows machine via explicit LAN interface; not a second machine',checks:[]};
let broker;
try{
 if(!ip)throw Error('expected_lan_interface_unavailable');
 const cfg=Config.load('.local/broker.json');cfg.port=18450;cfg.lan={ip,port:18450,cidrs:[`${ip}/32`]};
 broker=new Broker(cfg);await broker.start();
 const base=Config.load('.local/script.json');base.url=`wss://${ip}:18450/bridge`;
 const c=new BridgeClient(base);try{const r=await c.capabilities();evidence.checks.push({name:'pinned_tls_lan_capabilities',pass:r.prototype==='M0'});}finally{c.close();}
 const hostCfg=Config.load('.local/host.json');const h=new BridgeClient({...hostCfg,url:base.url});
 try{await h.capabilities();evidence.checks.push({name:'native_host_role_forbidden_from_lan',pass:false});}catch{evidence.checks.push({name:'native_host_role_forbidden_from_lan',pass:true});}finally{h.close();}
 await broker.stop();broker=undefined;
 cfg.lan.cidrs=['192.168.3.254/32'];broker=new Broker(cfg);await broker.start();
 const denied=new BridgeClient(base);try{await denied.capabilities();evidence.checks.push({name:'source_cidr_rejected',pass:false});}catch{evidence.checks.push({name:'source_cidr_rejected',pass:true});}finally{denied.close();}
}catch(e){evidence.error=e.message;process.exitCode=1;}finally{await broker?.stop();mkdirSync('evidence',{recursive:true});writeFileSync('evidence/lan.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}
