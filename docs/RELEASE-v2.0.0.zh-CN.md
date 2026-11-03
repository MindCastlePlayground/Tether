# Tether 2.0.0

[English](RELEASE-v2.0.0.md) · [项目介绍](../README.zh-CN.md) · [运行指南](../prototype/README.zh-CN.md) · [浏览器 Skill](../skills/tether-browser/SKILL.zh-CN.md)

## 版本与安装

版本号使用 `a.b.c`：大功能或破坏性更新递增 `a`，兼容功能递增 `b`，修复递增 `c`。大版本必须同步更新所有配套组件和文档。根目录 npm 包版本为 `2.0.0`，从检出目录或本地 tarball 安装，尚未发布到 npm。

仓库有意不提交 lockfile。运行 `npm install`（或 `npm install --package-lock=false`），npm 会使用本机配置的 registry 或镜像解析依赖。例如：

```powershell
npm install --package-lock=false
node bin/tether.mjs install
```

## 新增运行时工具

`diagnose({})` 报告连接和策略状态。`wait` 等待条件，`assert` 在同样的超时范围内重试断言：

```js
await client.call('wait', { sessionId, pageId, condition: 'text', value: '已保存', timeoutMs: 3000 });
await client.call('assert', { sessionId, pageId, condition: 'url', value: 'https://example.com/done' });
```

`records({op:'list'|'export'|'clear'})` 管理当前认证身份的内存诊断元数据，最多 200 条。记录不含 URL、页面正文、选择器或值。同一身份的不同连接共享对应记录，其他身份相互隔离；Broker 重启后日志清空。CLI 使用已配置 Agent 身份导出：

```powershell
node bin/tether.mjs records --runtime "$env:LOCALAPPDATA\Tether\runtime" --output .\tether-diagnostics.json
```

业务工具新增文件输入框上传、页面同源 GET 下载、JavaScript 对话框处理，以及弹窗显式发现/接管。上传最多 8 个文件，每个 16 MiB、总计 32 MiB；下载上限 16 MiB。下载由页面执行 fetch，不会捕获任意浏览器下载。参数示例和限制见[运行指南](../prototype/README.zh-CN.md)及[浏览器 Skill](../skills/tether-browser/SKILL.zh-CN.md)。弹窗需要先调用 `popupCandidates`，再对选中的标签显式调用 `adoptPopup`。

## 范围与状态

回放支持已有[设计文档](REPLAY-DESIGN.zh-CN.md)，参考 MinimumWebAuto，包含可复用片段、运行时参数、动作与断言、录制草稿、网络模式和诊断产物；本轮交付设计。

2026-11-03 验证结果：根目录安装器测试 68 项、运行时测试 137 项、Python 错误契约测试 4 项通过。真实 Chromium 扩展、Native Messaging、Broker 与 MCP 链路通过：70 KB 跨进程 iframe 上传、90 KB 分块下载、点击后处理 JavaScript 对话框、后台标签弹窗发现/接管/显式关闭，以及 MCP 工具发现、等待、快照、点击后观察和填写脱敏。

浏览器集成脚本在 `prototype/scripts/locator-e2e.mjs`；业务专项可设置 `TETHER_QA_BUSINESS_ONLY=1`，浏览器路径可通过 `TETHER_QA_CHROME` 指定。页面导航后先等待业务条件，再进行操作。较早版本的证据保留在带日期的[验收摘要](../prototype/VERIFICATION.zh-CN.md)。

本轮更新源码与文档，现有安装和信使部署保持原版本。升级需同步运行时与扩展；扩展新增 `webNavigation` 权限，用于确认后台页面打开弹窗的真实来源。`release` 结束授权并保留标签页，关闭已接管弹窗使用 `closeTab`。
