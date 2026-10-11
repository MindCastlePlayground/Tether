# 安装器验收

[English](INSTALL-VERIFICATION.md) · [安装指南](INSTALL.zh-CN.md)

2026-10-11，在 Windows、Node 24.9.0、Python 3.12 环境验证：

- `npm test`：14 项测试，覆盖五种宿主的路径/配置格式、JSONC/TOML 保留、幂等、冲突、备份、完整 Skill 复制、初始化期间改动检测、dry-run、浏览器触发计划和注册跳过选项。
- `npm pack` 加本地包 `npm exec`（等价于 npx）：在隔离的 `work/` home 中完成锁定依赖安装、TypeScript 构建、Python venv 初始化、本地凭据生成和 Windows 启动器编译。
- 五种项目配置与 Skill 均在隔离项目生成；重复安装成功复用已准备的 runtime。
- 官方 MCP Client 从其他工作目录启动已安装的 MCP 可执行文件；英文和简体中文均列出 12 个工具且 stderr 为空。未调用浏览器 RPC。
- 包清单未包含 `.local`、`.venv`、`node_modules`、`work`、`dist` 或 Python 缓存路径；已复制 Skill 内的相对链接均有效。
- 验证结束时默认 Broker 端口 18443 没有监听；安装器未启动 Broker。

全新安装使用 `--no-register` 保留当前机器的 Native Messaging 注册。注册调用/跳过逻辑和浏览器管理页路径已测试，没有实际打开浏览器；未通过本安装器实际手动加载 Chrome/Edge 扩展，也未在五种 Agent 应用内验收发现流程。这些结果证明产物生成及真实 MCP stdio 启动，不代表实时页面控制或跨平台安装已验收。

详细本地日志和 tarball 位于被忽略的 `work/`；含凭据的 runtime 文件不发布。根 npm 包尚未发布到 registry。
