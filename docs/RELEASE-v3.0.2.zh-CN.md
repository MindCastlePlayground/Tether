# Tether 3.0.2

[English](RELEASE-v3.0.2.md) · [项目介绍](../README.zh-CN.md)

本次补丁版本修复了浏览器自动化的可靠性问题。Refs 批量分配减少了 snapshot 中逐元素往返。Broker 心跳遇到队列已满时不再断开主机；超大请求会清理 pending 状态，超大响应返回 `payload_too_large`。扩展对超大响应也会返回错误，同时保持 native port 打开。

为适配当前集成，将 Playwright 固定为 1.64.0。

测试命令兼容 Node 22；Linux 测试夹具隔离用户目录和 Windows 安装流程的环境假设。设计文档的参考说明不再链接到仓库外文件。

iframe 表单控件可使用与上传相同的 frame 选择器，引用保持文档作用域，元素替换后会安全拒绝旧引用。CDP 适配层保留超大响应错误，后续请求独立处理。专用沙箱会等待 Chrome 完成扩展重载、启用解包扩展，并将 JavaScript 对话框留给 Tether 响应。

## 验证

2026-11-06：构建、根测试 68 项、运行时测试 156 项及中英文档检查通过。Grok 4.7 通过真实 Chromium、扩展、Native Messaging、Broker 与 MCP 驱动十种本地业务模拟，同一次完整运行 10/10 通过，包含会话清理。复跑命令和场景见[完整业务验证](../sandbox/README.md#完整业务验证)。
