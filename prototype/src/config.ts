import { readFileSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';
import { connect, isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { RuntimeFile as F } from './protocol.js';
export class Config {
  static readonly Loopback = '127.0.0.1';
  static readonly LocalTransport = 'loopback';
  static readonly PlainWebSocket = 'ws:';
  static readonly SecureWebSocket = 'wss:';
  static load(path: string): any { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
  /** The loaded extension folder of the runtime that owns this .local config file. */
  static extension(file: string): string {
    const root = dirname(dirname(file));
    try { return Config.load(join(root, F.Location)).path ?? join(root, F.Folder); } catch { return join(root, F.Folder); }
  }
  static hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
  static privateIP(ip:string): boolean {
    if(isIP(ip)!==4) return false;
    const [a,b]=ip.split('.').map(Number);
    return ip===Config.Loopback||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
  }
  static endpoint(cfg:any): URL {
    const url=new URL(cfg.url);
    if(url.pathname!=='/bridge'||url.username||url.password||url.search||url.hash||typeof cfg.token!=='string'||!cfg.token) throw Error('invalid_endpoint');
    if(cfg.transport===Config.LocalTransport){
      if(url.protocol!==Config.PlainWebSocket||url.hostname!==Config.Loopback||!url.port) throw Error('invalid_endpoint');
    }else if(cfg.transport!==undefined||url.protocol!==Config.SecureWebSocket||!Config.privateIP(url.hostname)||!cfg.caFile||!/^[A-Za-z0-9+/]{43}=$/.test(cfg.pin)){
      throw Error('invalid_endpoint');
    }
    return url;
  }
  static connection(cfg:any): any {
    const url=Config.endpoint(cfg);
    const options={agent:false,followRedirects:false,maxPayload:512*1024,headers:{authorization:`Bearer ${cfg.token}`}};
    if(url.protocol===Config.PlainWebSocket) return options;
    return {...options,ca:readFileSync(cfg.caFile),rejectUnauthorized:true,
      checkServerIdentity:(host:string,cert:any)=>{
        const err=checkServerIdentity(host,cert); if(err) return err;
        const key=new X509Certificate(cert.raw).publicKey.export({type:'spki',format:'der'});
        if(createHash('sha256').update(key).digest('base64')!==cfg.pin) return Error('pin_mismatch');
      }};
  }
  static async prepare(cfg:any): Promise<void> {
    const url = Config.endpoint(cfg);
    if (url.protocol !== Config.SecureWebSocket || url.hostname !== Config.Loopback) return;
    const cert = new X509Certificate(readFileSync(cfg.caFile));
    if (cert.validToDate.getTime() > Date.now()) return;
    // Let Broker renew before the TLS client loads the replacement trust certificate.
    await new Promise<void>(resolve => {
      const socket = connect(Number(url.port || 443), url.hostname);
      socket.setTimeout(5000, () => socket.destroy());
      socket.once('connect', () => socket.end());
      socket.once('error', () => socket.destroy());
      socket.once('close', () => resolve());
    });
  }
}
