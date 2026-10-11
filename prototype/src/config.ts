import { readFileSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';
export class Config {
  static load(path: string): any { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
  static hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
  static privateIP(ip:string): boolean {
    if(isIP(ip)!==4) return false;
    const [a,b]=ip.split('.').map(Number);
    return ip==='127.0.0.1'||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
  }
  static tls(cfg:any): any {
    const url=new URL(cfg.url);
    if(url.protocol!=='wss:'||!Config.privateIP(url.hostname)||url.pathname!=='/bridge'||url.username||url.password||url.search) throw Error('invalid_endpoint');
    return {ca:readFileSync(cfg.caFile),rejectUnauthorized:true,agent:false,followRedirects:false,maxPayload:512*1024,
      headers:{authorization:`Bearer ${cfg.token}`},
      checkServerIdentity:(host:string,cert:any)=>{
        const err=checkServerIdentity(host,cert); if(err) return err;
        const key=new X509Certificate(cert.raw).publicKey.export({type:'spki',format:'der'});
        if(createHash('sha256').update(key).digest('base64')!==cfg.pin) return Error('pin_mismatch');
      }};
  }
}
