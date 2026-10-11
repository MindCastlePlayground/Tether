# Tether 品牌验收

[English](branding-verification.md) · [品牌资源](README.zh-CN.md)

日期：2026-10-11。

这是历史品牌验收记录。文档国际化修改不增加新的测试证据。

- TypeScript 构建：通过（`npm run build`）。
- 扩展行为：18 项既有 FakeChrome 模拟测试通过（`node --test --test-reporter=dot test/extension.test.mjs`）。
- Python 初始化脚本：AST 语法检查通过；未执行初始化。
- Logo：透明 1254 × 1254 PNG 原图，另有 256px 文档图及 16/32/48/128px 扩展图。
- 弹窗：隔离的无头 Chrome 使用模拟扩展 runtime 渲染实际弹窗源码。Logo 加载、视口溢出、开关消息/响应、键盘焦点和无页面错误均通过。见 `popup-preview.png` 和 `preview-verification.json`。
- 文档：检查了五份 Markdown，30 个本地文档/图片引用均可解析，JSON 配置示例有效。英文原型指南没有重复中文正文。
- 本轮未重新加载或控制真实浏览器扩展；未启动 Native Host 和 Broker。现有运行及浏览器验收记录见 [../prototype/VERIFICATION.zh-CN.md](../prototype/VERIFICATION.zh-CN.md)，与本品牌检查分开。

使用内置 imagegen 工具生成；提示词记录在本目录的 [README.zh-CN.md](README.zh-CN.md)。PNG 尺寸导出使用同一原图。公开品牌名称为 Tether；内部 Native Messaging 标识为兼容已有注册而保留。
