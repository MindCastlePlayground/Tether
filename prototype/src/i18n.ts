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
      fill: "Fill a selector with text",
      click: "Click a selector",
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
      fill: "在指定选择器中填入文本",
      click: "点击指定选择器",
      navigate: "导航会话中的页面",
      capabilities: "获取桥接支持的功能",
      availableTabs: "启用自动访问时列出已有的 HTTP(S) 标签页",
    },
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
