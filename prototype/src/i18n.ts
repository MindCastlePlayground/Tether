export class Language {
  static readonly EN = "en";
  static readonly ZH_CN = "zh-CN";
}

export class McpText {
  static readonly TOOLS = {
    en: {
      requestSession: "Request a session under the extension policy; specify tabId to attach an existing tab",
      approvalStatus: "Check a pending session request",
      listTabs: "List session tabs",
      createTab: "Create a tab in the session",
      closeTab: "Close a session-created tab",
      release: "Release a browser session",
      observe: "Read the visible page state",
      fill: "Fill a field by ref (from snapshot) or selector; refuses with candidates instead of guessing when the target is missing or ambiguous",
      click: "Click an element by ref (from snapshot) or selector; nested text such as button > div > span is resolved to the clickable control",
      snapshot: "Get a simplified accessibility tree of the page with role, name and [ref=eN] for each element; use refs with click/fill/locate",
      locate: "Find elements by text, role+name, selector or ref and return each match with a verified unique selector and its actionable ancestor",
      navigate: "Navigate a session page",
      capabilities: "Get supported bridge capabilities",
      availableTabs: "List existing HTTP(S) tabs when automatic access is enabled",
    },
    "zh-CN": {
      requestSession: "按扩展程序策略请求会话；指定 tabId 可连接现有标签页",
      approvalStatus: "检查待处理的会话请求",
      listTabs: "列出会话中的标签页",
      createTab: "在会话中创建标签页",
      closeTab: "关闭由会话创建的标签页",
      release: "释放浏览器会话",
      observe: "读取当前可见的页面状态",
      fill: "按 ref（来自 snapshot）或选择器填写字段；目标缺失或有歧义时返回候选而不是猜测",
      click: "按 ref（来自 snapshot）或选择器点击元素；button > div > span 等嵌套文本会解析到可点击的控件",
      snapshot: "获取页面的简易无障碍树，每个元素带角色、名称和 [ref=eN]；ref 可直接用于 click/fill/locate",
      locate: "按文本、角色+名称、选择器或 ref 查找元素，返回每个匹配的唯一选择器及其可操作祖先",
      navigate: "导航会话中的页面",
      capabilities: "获取桥接支持的功能",
      availableTabs: "启用自动访问时列出已有的 HTTP(S) 标签页",
    },
  } as const;
}

export class McpHint {
  /** $1 is the extension folder to load. */
  static readonly BROWSER = {
    en: "browser_not_connected: no browser with the Tether extension is connected. Tether tried to start Chrome/Edge in the background. Open the browser, make sure the Tether extension is enabled (Load unpacked: $1), then retry.",
    "zh-CN": "browser_not_connected：没有已连接的浏览器扩展。Tether 已尝试在后台启动 Chrome/Edge。请打开浏览器并确认 Tether 扩展已启用（加载已解压的扩展程序：$1），然后重试。",
  } as const;
}

export class I18n {
  static select(explicit?: string, systemLocale?: string): typeof Language.EN | typeof Language.ZH_CN {
    if (explicit !== undefined) {
      if (explicit === Language.ZH_CN || explicit === Language.EN) return explicit;
      return Language.EN;
    }
    return systemLocale?.toLowerCase().startsWith("zh") ? Language.ZH_CN : Language.EN;
  }

  static language(): typeof Language.EN | typeof Language.ZH_CN {
    return this.select(process.env.BB_LANGUAGE, Intl.DateTimeFormat().resolvedOptions().locale);
  }
}
