export class Rpc {
  static readonly JSONRPC = "2.0";
  static readonly AUTH = "Authorization";
  static readonly BEARER = "Bearer";
  static readonly METHODS = ["requestSession", "approvalStatus", "listTabs", "createTab", "closeTab", "release", "html", "fill", "click", "navigate", "capabilities", "availableTabs", "snapshot", "locate", "network", "diagnose", "wait", "assert", "records", "trace", "preset", "uploadStart", "uploadChunk", "uploadFinish", "uploadDrop", "downloadStart", "downloadRead", "downloadDrop", "dialog", "popupCandidates", "adoptPopup"] as const;
}

export class SupportMethod { static readonly Diagnose='diagnose'; static readonly Wait='wait'; static readonly Assert='assert'; static readonly Records='records'; static readonly Trace='trace'; static readonly Preset='preset'; static readonly Conditions=['text','url','visible','hidden','request'] as const; static readonly RecordOps=['list','export','clear'] as const; static readonly TraceOps=['list','export','clear'] as const; static readonly PresetOps=['save','get','list','delete','export','run'] as const; static readonly PresetKinds=['navigate','click','fill','check'] as const; }
export interface WaitParams { sessionId:string; pageId:string; condition:typeof SupportMethod.Conditions[number]; value:string; timeoutMs?:number }
export interface RecordsParams { op?:typeof SupportMethod.RecordOps[number] }

export class NetworkOp {
  static readonly Start = 'start';
  static readonly List = 'list';
  static readonly Detail = 'detail';
  static readonly Body = 'body';
  static readonly Stop = 'stop';
  static readonly Clear = 'clear';
  static readonly Http = 'http';
  static readonly All = [NetworkOp.Start, NetworkOp.List, NetworkOp.Detail, NetworkOp.Body, NetworkOp.Stop, NetworkOp.Clear, NetworkOp.Http] as const;
}
export interface NetworkParams {
  sessionId: string; pageId: string; op: typeof NetworkOp.All[number];
  requestId?: string; url?: string; type?: string; offset?: number; limit?: number; maxChars?: number;
}

export type Method = typeof Rpc.METHODS[number];
