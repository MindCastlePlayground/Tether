import en from './_locales/en/messages.json' with { type: 'json' };
import zh from './_locales/zh_CN/messages.json' with { type: 'json' };

export class Text {
  static NativeConnected = 'nativeConnected';
  static NativeWaiting = 'nativeWaiting';
  static NativeHost = 'nativeHost';
  static Title = 'title';
  static Tagline = 'tagline';
  static Footer = 'footer';
  static Loading = 'loading';
  static Language = 'language';
  static Auto = 'auto';
  static English = 'english';
  static Chinese = 'chinese';
  static AutoApproval = 'autoApproval';
  static AutoOn = 'autoOn';
  static AutoOff = 'autoOff';
  static AutoHint = 'autoHint';
  static Pending = 'pending';
  static NoPending = 'noPending';
  static NewGroup = 'newGroup';
  static Attach = 'attach';
  static AccessHint = 'accessHint';
  static Deny = 'deny';
  static Approve = 'approve';
  static Choose = 'choose';
  static Sessions = 'sessions';
  static NoSessions = 'noSessions';
  static Revoke = 'revoke';
  static ChooseHint = 'chooseHint';
  static NoTabs = 'noTabs';
  static Back = 'back';
  static Error = 'error';
  static Broker = 'broker';
  static BrokerOn = 'brokerOn';
  static BrokerOff = 'brokerOff';
  static BrokerAuto = 'brokerAuto';
  static BrokerPortBusy = 'brokerPortBusy';
  static BrokerStartFailed = 'brokerStartFailed';
  static BrokerStopped = 'brokerStopped';
  static BrokerRunning = 'brokerRunning';
  static BrokerStarting = 'brokerStarting';
  static BrokerBackoff = 'brokerBackoff';
  static BrokerBlocked = 'brokerBlocked';
}

export class Locale {
  static Auto = 'auto';
  static English = 'en';
  static Chinese = 'zh-CN';
  static Key = 'language';
  static Catalogs = { en, 'zh-CN': zh };

  constructor(api, language = navigator.language) {
    this.api = api;
    this.system = api.i18n?.getUILanguage() || language;
    this.choice = Locale.Auto;
  }

  static normalize(value) { return /^zh(?:[-_]|$)/i.test(value) ? Locale.Chinese : Locale.English; }
  static valid(value) { return [Locale.Auto, Locale.English, Locale.Chinese].includes(value); }
  get language() { return Locale.normalize(this.choice === Locale.Auto ? this.system : this.choice); }
  get(key) { return (Locale.Catalogs[this.language][key] || en[key])?.message || key; }

  async load() {
    try {
      const data = await this.api.storage.local.get(Locale.Key);
      if (Locale.valid(data[Locale.Key])) this.choice = data[Locale.Key];
    } catch { /* Use the browser language when preferences are unavailable. */ }
  }

  async set(value) {
    if (!Locale.valid(value)) return;
    this.choice = value;
    try { await this.api.storage.local.set({ [Locale.Key]: value }); } catch { /* Keep the choice for this popup. */ }
  }
}
