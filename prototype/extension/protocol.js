export class Wire {
  static Host = 'com.freebird.browser_bridge';
  static Version = '2.0';
  static MaxBytes = 512 * 1024;
  static SessionRequest = 'requestSession';
  static ApprovalStatus = 'approvalStatus';
  static ListTabs = 'listTabs';
  static CreateTab = 'createTab';
  static CloseTab = 'closeTab';
  static Release = 'release';
  static Observe = 'observe';
  static Fill = 'fill';
  static Click = 'click';
  static Navigate = 'navigate';
  static Capabilities = 'capabilities';
  static AvailableTabs = 'availableTabs';
  static Attach = 'cdpAttach';
  static Cdp = 'cdp';
  static Detach = 'cdpDetach';
  static ClientLost = 'clientLost';
  static Heartbeat = 'heartbeat';
  static Event = 'cdpEvent';
  static Pending = 'pending';
  static Approved = 'approved';
  static Denied = 'denied';
  static Expired = 'expired';
}

export class SessionMode {
  static NewGroup = 'newGroup';
}

export class PopupMessage {
  static Status = 'popup.status';
  static Port = 'popup';
  static Pending = 'popup.pending';
  static Tabs = 'popup.tabs';
  static Approve = 'popup.approve';
  static Deny = 'popup.deny';
  static Sessions = 'popup.sessions';
  static Revoke = 'popup.revoke';
  static RevokeAll = 'popup.revokeAll';
  static Focus = 'popup.focus';
  static Error = 'popup.error';
  static AutoApproval = 'popup.autoApproval';
  static SetAutoApproval = 'popup.setAutoApproval';
  static BrokerStatus = 'popup.brokerStatus';
  static SetBrokerMode = 'popup.setBrokerMode';
}

export class Storage {
  static AutoApprove = 'autoApprove';
  static BrokerMode = 'brokerMode';
}

export class Broker {
  static Control = 'broker.control';
  static Status = 'broker.status';
  static Auto = 'auto';
  static On = 'on';
  static Off = 'off';
  static Probe = 'probe';
  static ModeAction = 'mode';
  static StateRunning = 'running';
  static StateStopped = 'stopped';
  static StateBackoff = 'backoff';
  static StateBlocked = 'blocked';
  static StateStarting = 'starting';
  static Alarm = 'broker-probe';
  static PortInUse = 'broker_port_in_use';
  static StartFailed = 'broker_start_failed';
}

export class NativeStatus {
  static Type = 'native.status';
  static Connected = 'connected';
  static Error = 'error';
  static Waiting = 'waiting';
  static Host = 'native_host_failed';
  static Hints = Object.freeze({
    host_config_failed: 'nativeConfig', host_origin_mismatch: 'nativeOrigin',
    broker_unavailable: 'nativeOffline', broker_tls_failed: 'nativeTLS',
    broker_auth_failed: 'nativeAuth', broker_disconnected: 'nativeClosed',
    native_frame_invalid: 'nativeFrame', native_host_failed: 'nativeHost',
    broker_stopped: 'brokerStopped', broker_control_failed: 'brokerStartFailed',
    broker_port_in_use: 'brokerPortBusy', broker_start_failed: 'brokerStartFailed'
  });
}

export class Failure {
  static Invalid = 'invalid_request';
  static Forbidden = 'not_authorized';
  static Missing = 'resource_unavailable';
  static Busy = 'debugger_busy';
  static GroupFull = 'group_full';
  static Unsupported = 'unsupported_operation';
  static Failed = 'operation_failed';
}

export class CdpMethod {
  static Allowed = new Set([
    'Accessibility.getFullAXTree', 'Accessibility.getPartialAXTree',
    'DOM.describeNode', 'DOM.disable', 'DOM.enable', 'DOM.getBoxModel', 'DOM.getContentQuads',
    'DOM.getDocument', 'DOM.querySelector', 'DOM.querySelectorAll', 'DOM.resolveNode', 'DOM.scrollIntoViewIfNeeded',
    'Emulation.clearDeviceMetricsOverride', 'Emulation.setDeviceMetricsOverride', 'Emulation.setFocusEmulationEnabled',
    'Input.dispatchKeyEvent', 'Input.dispatchMouseEvent', 'Input.insertText',
    'Log.disable', 'Log.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Page.captureScreenshot',
    'Page.createIsolatedWorld', 'Page.disable', 'Page.enable', 'Page.getFrameTree',
    'Page.navigate', 'Page.reload', 'Page.setLifecycleEventsEnabled', 'Page.stopLoading',
    'Network.enable', 'Network.setCacheDisabled',
    'Performance.disable', 'Performance.enable', 'Runtime.callFunctionOn', 'Runtime.disable',
    'Runtime.enable', 'Runtime.evaluate', 'Runtime.getProperties', 'Runtime.releaseObject',
    'Runtime.runIfWaitingForDebugger', 'Target.setAutoAttach'
  ]);
  static Internal = new Set(['Browser.getVersion', 'Target.getTargetInfo']);
  static NoChildTargets = 'Target.setAutoAttach';
}

export class BrowserAction {
  static NewTab = 'about:blank';
  static Http = 'http:';
  static Https = 'https:';
  static BadgeColor = '#b45309';
  static BadgePending = '!';
  static DebuggerVersion = '1.3';
}

export class Limits {
  static MaxBytes = 512 * 1024;
  static PendingMs = 120_000;
  static LeaseMs = 15_000;
  static GroupTabs = 10;
  static Dedupe = 64;
  static GroupPrefix = 'Tether-';
}
