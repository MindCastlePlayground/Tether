export class Brand {
  static readonly Name = 'tether';
  static readonly Version = '0.1.0';
}
export enum Method {
  Request = 'requestSession', Status = 'approvalStatus', Tabs = 'listTabs', Create = 'createTab',
  Close = 'closeTab', Release = 'release', Observe = 'observe', Fill = 'fill', Click = 'click',
  Navigate = 'navigate', Capabilities = 'capabilities', Attach = 'cdpAttach', CDP = 'cdp',
  Detach = 'cdpDetach', Event = 'cdpEvent', Heartbeat = 'heartbeat', Lost = 'clientLost', Available = 'availableTabs'
}
export class Limit {
  static readonly Frame = 512 * 1024;
  static readonly Wait = 20_000;
  static readonly Heartbeat = 5_000;
  static readonly Records = 1000;
}
export class Wire {
  static readonly Version = '2.0';
  static readonly Auth = 'authorization';
  static readonly Origin = 'origin';
  static readonly Bearer = 'Bearer ';
  static readonly Host = 'host';
  static readonly Path = '/bridge';
}
export type Params = Record<string, any>;
export interface RPC { jsonrpc: string; id?: string | number; method?: string; params?: Params; result?: any; error?: {code:number;message:string}; }
export type Forward = (method: string, params: Params) => Promise<any>;
export const PUBLIC = new Set<string>([Method.Request,Method.Status,Method.Tabs,Method.Create,Method.Close,Method.Release,Method.Observe,Method.Fill,Method.Click,Method.Navigate,Method.Capabilities,Method.Available]);
export const WRITES = new Set<string>([Method.Create,Method.Close,Method.Release,Method.Fill,Method.Click,Method.Navigate]);
export class Autostart {
  static readonly Client = 'BB_CLIENT_CONFIG';
  static readonly Flag = 'BB_BROKER_AUTOSTART';
  static readonly Off = '0';
  static readonly Broker = 'broker.json';
  static readonly Script = 'broker.js';
  static readonly Host = '127.0.0.1';
  static readonly Port = 'port';
  static readonly Step = 200;
  static readonly Budget = 10_000;
  static readonly Max = 65535;
  static readonly Ignore = 'ignore' as const;
  static readonly Timeout = 'broker_autostart_timeout\n';
}
