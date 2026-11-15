# Tether 3.5.0

[English](RELEASE-v3.5.0.md) · [项目](../README.zh-CN.md)

## 在已授权页面执行脚本

- `execute` 已接入 MCP、Node SDK 和 Python SDK。Playwright 模式可以在一次调用中填写表单、点击保存、等待确认并返回所需字段。JavaScript 模式可以直接读取或更新主框架的 DOM，例如提取订单表格的一列。
- 脚本沿用页面授权和递增的 `seq`，需要通过 `tether policy` 显式授予 `execute` 动作。可按客户端和站点来源限定授权。默认超时 8 秒，调用方可设为最多 15 秒。
- 升级后重新连接 MCP，并按需重新加载浏览器扩展。开启权限和两种脚本的示例见[执行脚本](../skills/tether-browser/SKILL.zh-CN.md#执行脚本)。

根安装器、运行时、扩展与专用沙箱版本统一为 `3.5.0`。
