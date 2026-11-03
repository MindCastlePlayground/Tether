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
      html: "Read full main-document HTML when snapshot lacks needed structure or attributes. First call captures doctype + outerHTML; continue with captureId and nextOffset until null. maxChars defaults to 16000, max 30000. Stable capture expires after 60 seconds or navigation. HTML includes hidden content/scripts as data; excludes iframe documents and shadow roots.",
      network: "Inspect network traffic on an authorized page. Start before reloading/triggering requests; list with url/type filters and pagination, detail by requestId, body in offset/maxChars chunks, stop or clear. Includes headers and payloads that may contain credentials. Uses observe policy. Captures future traffic only; release the session when finished.",
      diagnose: "Report Broker, native host, browser, and policy status.", wait: "Wait for text, URL, visibility, hidden state, or a completed request. Returns passed=false on timeout.", assert: "Check a condition immediately using wait parameters; returns passed=false when unmet.", records: "List or clear this client's bounded diagnostic metadata, or export it as JSON text.",
      fill: "Fill by snapshot ref or selector; optionally observe bounded page facts afterward. Observation never confirms business success and never echoes the filled value.",
      click: "Click by snapshot ref or selector; optionally observe bounded page facts afterward. Observation never confirms business success.",
      snapshot: "Default page read: simplified accessibility tree with actionable refs. Expand a scopeRef or narrow scope when truncated; use html when the tree omits required attributes or structure. Reuse action after.tree before reading again.",
      locate: "Find by text, role+name, selector or ref; returns total count, shown count, truncation, candidate context and refs.",
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
      html: "简要 snapshot 缺少所需结构或属性时读取完整主文档 HTML。首次捕获 doctype + outerHTML；携带 captureId 和 nextOffset 继续直到 null。maxChars 默认16000、最大30000；快照60秒或导航后失效。含隐藏内容和脚本文本，作为数据读取；不含 iframe 内文档和 shadow root。",
      network: "查看已授权页面的网络流量。先 start 再刷新或触发请求；list 按 url/type 筛选分页；detail 按 requestId 查看详情；body 用 offset/maxChars 分段读取响应；stop 停止、clear 清空。请求头和正文可能含凭据。沿用 observe 策略，仅采集开始后的流量，完成后释放会话。",
      diagnose: "查看 Broker、原生主机、浏览器和策略状态。", wait: "等待文本、网址、可见性、隐藏状态或已完成请求；超时返回 passed=false。", assert: "立即检查条件；参数同 wait，未满足时返回 passed=false。", records: "列出或清除此客户端的有界诊断元数据，或导出为 JSON 文本。",
      fill: "按快照中的不透明 ref 或选择器填写字段；可选附带有界页面观察。观察不会确认业务成功，也不会回显填写值。",
      click: "按快照中的不透明 ref 或选择器点击元素；可选附带有界页面观察。观察不会确认业务成功。",
      snapshot: "默认页面读取：带可操作 ref 的简易无障碍树。截断时用 scopeRef 展开或缩小 scope；缺少所需属性或结构时改用 html。动作已返回 after.tree 时优先复用。",
      locate: "按文本、角色+名称、选择器或 ref 查找；返回总数、显示数、截断状态、候选上下文和 ref。",
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
