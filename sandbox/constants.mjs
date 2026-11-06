export class Paths {
  static Data = '/data';
  static Profile = '/data/profile';
  static Extension = '/app/prototype/extension';
  static ExtensionStamp = '/data/extension-build';
  static Client = '/data/.local/agent.json';
  static Token = '/data/mcp-token';
}
export class Wire {
  static Port = 18780;
  static Url = 'http://127.0.0.1:18780/mcp';
  static Version = '3.1.0';
  static Status = 'sandbox_status';
  static Browser = 'sandbox_browser';
  static Exec = 'sandbox_exec';
  static Files = 'sandbox_files';
  static Eval = 'sandbox_eval';
  static Screenshot = 'sandbox_screenshot';
  static Cdp = 'sandbox_cdp';
  static Tether = 'tether';
  static Timeout = 120000;
}
