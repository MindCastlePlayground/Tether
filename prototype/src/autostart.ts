import { BrokerLifecycle } from './lifecycle.js';
import { Autostart as Opt } from './protocol.js';

export class Autostart {
  static async run(io: { env?: Record<string,string|undefined>; ensure?: (path:string)=>Promise<unknown> } = {}): Promise<void> {
    const env=io.env??process.env;
    const path=env[Opt.Client];
    if(!path||env[Opt.Flag]===Opt.Off)return;
    try { await (io.ensure??(file=>new BrokerLifecycle(file).ensure()))(path); }
    catch { process.stderr.write(Opt.Timeout); }
  }
}
