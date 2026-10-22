# 验收摘要

[English](VERIFICATION.md) · [运行指南](README.zh-CN.md)

更新日期：2026-10-22。本文汇总 v1.2.0 定位器验收（2026-10-22）、v1.0.0 发布验收（2026-10-18）、安装器 v1.1.0 验收（2026-10-19）和此前的浏览器验收记录。内容为已有检查摘要，不代表本次重新执行了测试。

| 范围 | 已记录结果 | 边界 |
| --- | --- | --- |
| 构建与自动化检查 | v1.0.0：TypeScript 构建、38 项安装器测试、61 项运行时/扩展测试和 5 项 Python 客户端测试通过。安装器 v1.1.0：44 项测试通过。 | 测试覆盖不同层面；单独通过测试不能证明浏览器验收完成。 |
| 安装与升级 | 隔离环境全新安装及从 v0.1.1 升级完成，既有 runtime 文件的 SHA-256 记录保持一致。v1.1.0 升级、重复/强制安装、全新 tarball 安装及独立升级均完成。 | 仅 Windows 主机。安装器检查选择不注册 Native Messaging；v1.1.0 安装器变更没有重做浏览器加载和实时页面 RPC。 |
| MCP 与 Native Messaging | 已安装的 MCP 可执行程序从其他工作目录启动，并以英文和简体中文提供 12 个工具，stderr 为空。v1.0.0 发布检查在真实 Chromium 中测试了 Native Messaging 和生命周期控制。 | 客户端启动和传输检查不能证明所有浏览器或 Agent 宿主均可用。 |
| 浏览器页面控制 | 此前的真实 Chrome 测试经 Node SDK 和 MCP 完成授权后的 observe、fill、click、导航和释放流程，也包括模型驱动的网站操作。 | 未覆盖 Edge、Python SDK 页面操作、全部工具及所有授权/生命周期场景。 |
| 元素快照与定位器（v1.2.0） | 104 项运行时/扩展测试（含 14 项基于无头 Chrome 的定位测试）和 44 项安装器测试通过。`scripts/locator-e2e.mjs` 在隔离 Chromium 中使用真实扩展、临时 Native Messaging 主机和 Broker 完成：`snapshot` ref、按 ref 点击 `button > div > span`、XPath `text()` 改写、嵌套文本回退、对歧义选择器以 `sideEffect:"none"` 拒绝、点击 `locate` 候选、按 label 文本填写。已安装 runtime 完成升级，MCP 提供 14 个工具。 | 本次运行中用户自己的 Chrome profile 未重新连上升级后的 Broker，因此未在该 profile 中重做实时 MCP 操作。开发检出中有 2 项 Python 传输测试因自签名证书报错，未改动的代码同样失败。 |
| 网络与隔离 | 运行时检查覆盖 TLS/pin 校验、认证、会话/页面授权和有限的网络端点采样。 | 未在第二台局域网机器测试。端点快照不是抓包，也不能证明整个浏览器 profile 没有外部流量。 |

证据摘要依据 [v1.2.0 发布说明](../docs/RELEASE-v1.2.0.zh-CN.md)、[v1.0.0 发布说明](../docs/RELEASE-v1.0.0.zh-CN.md)和[安装器验收记录](../docs/INSTALL-VERIFICATION.zh-CN.md)。检查在 Windows 和隔离测试数据下完成。结果不能证明跨平台支持、所有浏览器兼容或完全零外传。运行边界见[运行指南](README.zh-CN.md)。
