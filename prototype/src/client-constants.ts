export class Rpc {
  static readonly JSONRPC = "2.0";
  static readonly AUTH = "Authorization";
  static readonly BEARER = "Bearer";
  static readonly METHODS = ["requestSession", "approvalStatus", "listTabs", "createTab", "closeTab", "release", "observe", "fill", "click", "navigate", "capabilities", "availableTabs"] as const;
}

export type Method = typeof Rpc.METHODS[number];
