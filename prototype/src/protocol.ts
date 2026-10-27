export class Brand {
  static readonly Name = 'tether';
  static readonly Version = '1.4.0';
}
export class NativeStatus {
  static readonly Type = 'native.status';
  static readonly Connected = 'connected';
  static readonly Error = 'error';
  static readonly Config = 'host_config_failed';
  static readonly Origin = 'host_origin_mismatch';
  static readonly Offline = 'broker_unavailable';
  static readonly TLS = 'broker_tls_failed';
  static readonly Auth = 'broker_auth_failed';
  static readonly Closed = 'broker_disconnected';
  static readonly Frame = 'native_frame_invalid';
  static readonly Timeout = 5000;
  static readonly Refused = 'ECONNREFUSED';
  static readonly TLSCodes = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
  static readonly Pin = 'pin_mismatch';
}
export enum Action {
  Session='session', Available='availableTabs', Observe='observe', Fill='fill', Click='click',
  Navigate='navigate', Create='createTab', Close='closeTab'
}
export enum Effect { Allow='allow', Deny='deny', Ask='ask' }
export class PolicyKey {
  static readonly File='policy.json';static readonly Denied='policy_denied';static readonly Invalid='policy_invalid';
  static readonly Ask='_ask';static readonly Any='*';static readonly Wild='*.';
  static readonly Version='version';static readonly Default='default';static readonly Rules='rules';static readonly Summary='policy';
  static readonly Id='id';static readonly Client='client';static readonly Origin='origin';
  static readonly Actions='actions';static readonly Effect='effect';static readonly Missing='ENOENT';
  static readonly New='newGroup';static readonly Attach='attachExisting';
}
export enum Method {
  Request = 'requestSession', Status = 'approvalStatus', Tabs = 'listTabs', Create = 'createTab',
  Close = 'closeTab', Release = 'release', Observe = 'observe', Fill = 'fill', Click = 'click',
  Navigate = 'navigate', Capabilities = 'capabilities', Attach = 'cdpAttach', CDP = 'cdp',
  Detach = 'cdpDetach', Event = 'cdpEvent', Heartbeat = 'heartbeat', Lost = 'clientLost', Available = 'availableTabs',
  Snapshot = 'snapshot', Locate = 'locate'
}
export class Limit {
  static readonly Frame = 512 * 1024;
  static readonly Wait = 20_000;
  static readonly Heartbeat = 5_000;
  static readonly Records = 1000;
  static readonly Clients = 64;
}
export class Wire {
  static readonly Version = '2.0';
  static readonly Auth = 'authorization';
  static readonly Origin = 'origin';
  static readonly Bearer = 'Bearer ';
  static readonly Host = 'host';
  static readonly Path = '/bridge';
  static readonly Instance = '#';
  static readonly Busy = 'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n';
}
export type Params = Record<string, any>;
export interface RPC { jsonrpc: string; id?: string | number; method?: string; params?: Params; result?: any; error?: {code:number;message:string}; }
export type Forward = (method: string, params: Params) => Promise<any>;
export const PUBLIC = new Set<string>([Method.Request,Method.Status,Method.Tabs,Method.Create,Method.Close,Method.Release,Method.Observe,Method.Fill,Method.Click,Method.Navigate,Method.Capabilities,Method.Available,Method.Snapshot,Method.Locate]);
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
export class RuntimeFile {
  static readonly Location = 'extension-location.json';
  static readonly Folder = 'extension';
}
export class Wake {
  static readonly Flag = 'BB_BROWSER_WAKE';
  static readonly Browser = 'BB_BROWSER';
  static readonly Off = '0';
  static readonly Arg = '--no-startup-window';
  static readonly Budget = 15_000;
  static readonly Step = 500;
  static readonly Cooldown = 60_000;
  static readonly Missing = 'browser_not_connected';
  static readonly Chrome = 'chrome';
  static readonly Edge = 'edge';
  static readonly Paths: Record<string, string[]> = {
    chrome: ['Google', 'Chrome', 'Application', 'chrome.exe'],
    edge: ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  };
  static readonly Bases = ['LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)'];
  /** The request was never sent to the browser, so any call may be retried. */
  static readonly Unsent = new Set(['host_unavailable', 'connectionFailed', 'connectionTimeout']);
  /** The link dropped after sending; only side-effect free calls are retried. */
  static readonly Lost = new Set(['host_disconnected', 'connectionClosed']);
  /** Side-effect free calls that may be retried once after recovery. */
  static readonly Reads = new Set<string>([Method.Status, Method.Tabs, Method.Observe, Method.Available, Method.Snapshot, Method.Locate]);
}
export class BrokerControl {
  static readonly Type = 'broker.control';
  static readonly Status = 'broker.status';
  static readonly Mode = 'mode';
  static readonly Probe = 'probe';
  static readonly Auto = 'auto';
  static readonly On = 'on';
  static readonly Off = 'off';
  static readonly Modes = [BrokerControl.Auto, BrokerControl.On, BrokerControl.Off];
  static readonly Running = 'running';
  static readonly Stopped = 'stopped';
  static readonly Starting = 'starting';
  static readonly Backoff = 'backoff';
  static readonly Blocked = 'blocked';
  static readonly Port = 'broker_port_in_use';
  static readonly Failed = 'broker_start_failed';
  static readonly Error = 'broker_control_failed';
  static readonly Disabled = 'broker_stopped';
  static readonly Health = '/health';
  static readonly Stop = '/control/stop';
  static readonly Get = 'GET';
  static readonly Post = 'POST';
  static readonly Https = 'https:';
  static readonly StateFile = 'broker-state.json';
  static readonly Lock = 'broker-start.lock';
  static readonly HostFile = 'host.json';
  static readonly ReadLimit = 4096;
  static readonly ProbeMs = 700;
  static readonly StartMs = 5000;
  static readonly LockMs = 15000;
  static readonly Delays = [1000, 2000, 4000, 8000, 16000];
  static readonly Limit = 5;
  static readonly RetryMs = 1000;
  static readonly RetryMax = 30000;
  static readonly Extension = 'extension';
  static readonly Build = 'build';
  static readonly Manifest = 'manifest.json';
}
/** Element lookup used by snapshot, locate, fill and click. */
export class Find {
  /** Engine methods that run in Playwright, and the reads that share the observe policy action. */
  static readonly Engine = new Set<string>([Method.Observe, Method.Fill, Method.Click, Method.Snapshot, Method.Locate]);
  static readonly Reads = new Set<string>([Method.Snapshot, Method.Locate]);
  static readonly Wait = 3000;
  static readonly Step = 250;
  static readonly Chars = 30_000;
  static readonly Candidates = 10;
  static readonly RefEngine = 'tether';
  static readonly RefKey = 'tether.refs';
  static readonly RefLimit = 4096;
  static readonly ObserveMs = 3000;
  static readonly ObserveChars = 6000;
  static readonly Context = 'xpath=ancestor::*[self::tr or self::li or self::dialog or self::section or self::article or @role="row" or @role="listitem" or @role="dialog" or @role="region"][1]';
  static readonly Outline = new Set(['main','banner','navigation','complementary','contentinfo','region','dialog','alertdialog','form','table','list','heading','article']);
  static readonly Name = 80;
  static readonly Ref = /^[a-z0-9]{1,64}$/;
  static readonly Line = /^\s*- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?.*?\[ref=([a-z0-9]+)\]/;
  static readonly Head = /^- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?/;
  static readonly AI = 'ai' as const;
  static readonly Container =/^(\s*)- generic \[ref=[a-z0-9]+\]:$/;
  static readonly Leaf = /^\s*- generic \[ref=[a-z0-9]+\]$/;
  static readonly Quoted = /(?:text\(\)\s*,|text\(\)\s*=|has-text\(|contains\(|text=|normalize-space\(\.?\)\s*[=,])\s*(["'])((?:(?!\1).)+)\1/g;
  static readonly Bare = /[#.\[\]>=:()@\/*~+'"]/;
  static readonly Tag = /^(?:\(?\/\/|xpath=\/\/|css=)?([a-zA-Z][\w-]*)/;
  static readonly XPath = /^(?:\(*\/\/|xpath=)/;
  static readonly Body = 'body';
  static readonly Fillable = 'input:not([type=hidden]),textarea,select,[contenteditable=""],[contenteditable="true"]';
  static readonly Actionable = 'xpath=ancestor-or-self::*[self::button or self::a or self::summary or self::label or self::select or self::input or self::textarea or self::option or @onclick or @role="button" or @role="link" or @role="menuitem" or @role="menuitemcheckbox" or @role="menuitemradio" or @role="tab" or @role="checkbox" or @role="radio" or @role="switch" or @role="option" or @role="treeitem" or @role="combobox"][1]';
  static readonly Roles: Record<string, string> = { button: 'button', a: 'link', summary: 'button', select: 'combobox', textarea: 'textbox', input: 'textbox', option: 'option', h1: 'heading', h2: 'heading', h3: 'heading', li: 'listitem' };
  static readonly Tags = new Set(['input', 'textarea', 'select']);
}
export class FindCode {
  static readonly Missing = 'selector_not_found';
  static readonly Ambiguous = 'selector_ambiguous';
  static readonly Invalid = 'selector_invalid';
  static readonly Stale = 'ref_stale';
  static readonly Fill = 'not_fillable';
  static readonly Scope = 'scope_not_found';
  static readonly ScopeMany = 'scope_ambiguous';
  static readonly ScopeConflict = 'scope_conflict';
  static readonly Unchecked = 'uniqueness_unverified';
  static readonly Query = 'locate_query_empty';
}
export class Strategy {
  static readonly Selector = 'selector';
  static readonly Ref = 'ref';
  static readonly RefRole = 'ref-role-name';
  static readonly XPathText = 'xpath-normalize-space';
  static readonly Contains = 'jquery-contains';
  static readonly Role = 'role-name';
  static readonly Text = 'text';
  static readonly Label = 'label';
  static readonly Placeholder = 'placeholder';
  static readonly Visible = '+visible';
  static readonly Retarget = '+actionable-ancestor';
  static readonly Inner = '+inner-field';
}
export class FindHint {
  static readonly XPathText = 'XPath text() only matches text nodes that are direct children; the text is nested in descendants (span/div). Tether retried with normalize-space(.). Prefer a ref from snapshot or role=<role>[name="..."].';
  static readonly Fallback = 'A supported shorthand was resolved without dropping its scope or constraints. Prefer the returned ref for the next action.';
  static readonly Retarget = 'The match was a text node wrapper inside a control; Tether acted on its nearest actionable ancestor.';
  static readonly Missing = 'Nothing matched within the requested constraints. Call snapshot or locate with scope and text/role, then use a returned ref.';
  static readonly Ambiguous = 'Several visible elements match. Pick one candidate selector or a ref from snapshot; nothing was clicked or filled.';
  static readonly Stale = 'This ref is no longer available in this document. Call snapshot or locate again; same-name elements are never substituted.';
  static readonly Fill = 'The match is not an input, textarea, select or contenteditable element and contains no single field. Nothing was filled.';
  static readonly Invalid = 'The selector cannot be parsed by Playwright. Use CSS, XPath, role=<role>[name="..."], text="...", or a ref from snapshot.';
  static readonly Snapshot = 'Use the opaque ref with click/fill/locate, or scopeRef to expand a region. Refs retain element identity within a document; navigation or replacement invalidates them. At most 4096 recent refs are retained.';
  static readonly Truncated = 'Output was shortened. Expand a region with scopeRef, narrow scope, or increase maxChars (up to 30000).';
  static readonly Scope = 'Choose exactly one scope or scopeRef. Narrow a non-unique scope before retrying.';
}
