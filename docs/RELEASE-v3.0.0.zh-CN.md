# Tether 3.0.0

[English](RELEASE-v3.0.0.md) · [项目介绍](../README.zh-CN.md)

## 页面读取接口迁移

移除独立 `observe` RPC、MCP 工具和 Node SDK 方法。使用 `snapshot` 读取带 ref 的简易无障碍树；需要完整结构或属性时使用新增 `html`。这是公开接口的破坏性更新，按 `a.b.c` 规则升级主版本并同步安装器、运行时、扩展、沙箱源码、SDK 和 Skill。

`click`/`fill` 的 `observe:{...}` 选项继续返回带树的 `after`，策略动作名称 `observe` 保留。现有权限配置可以继续使用。`wait`/`assert` 的 text 条件检查 `snapshot.tree`；URL 条件仍为精确匹配。

## 完整 HTML

`html({sessionId,pageId,maxChars?,captureId?,offset?})` 首次捕获当前主文档 doctype 和 outerHTML；后续携带同一 `captureId`，沿 `nextOffset` 读取至 null。默认每页 16,000、最多 30,000 个 UTF-16 字符；最多 8 Mi 字符，超过返回 `html_too_large`。每份快照有效 60 秒，导航或重新捕获会使旧快照失效。

完整字符串保存在浏览器端对象中，分块经过 512 KiB 通信通道。返回范围为主文档；iframe 内文档和 shadow root 需单独支持。序列化 HTML 保留隐藏内容和脚本文本，动态表单值也可能与 HTML 属性不同。具体示例见 [SDK 用法](../skills/tether-browser/references/sdk.zh-CN.md)。

## 减少调用轮次

已更新 Skill，引导 Agent 复用动作结果树、在服务端等待条件、信息缺失时改读 HTML。进一步的动作＋等待＋树与可复用片段方案见[调用效率探索](CALL-EFFICIENCY.zh-CN.md)，本轮交付方案。

本轮更新源码与文档。现有安装与远端部署需另行同步升级；升级后重启 MCP 客户端以刷新工具列表。

## 验证

构建通过；安装器测试 68 项、运行时测试 146 项、Python SDK 测试 4 项通过。真实 Chrome 扩展、Native Host、Broker 与 MCP 链路读取 600,919 字符 HTML，共 21 段，验证隐藏结构、工具列表迁移及导航后快照过期。
