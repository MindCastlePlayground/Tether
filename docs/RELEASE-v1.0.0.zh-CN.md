# Tether v1.0.0

[English](RELEASE-v1.0.0.md)

**发布日期：** 2026-10-18

## 更新内容

- MCP 与 Native Host 为同一 runtime 共用 Broker 生命周期。扩展支持 `on`、`off` 和默认 `auto` 管理模式，持久化状态，并每 30 秒执行一次健康探测。
- Broker 启动失败设置 1、2、4、8、16 秒的最短退避时间，到期后在下一次周期探测时重试；连续失败 5 次后持久化为 `blocked`。Chrome 可能延后 30 秒的探测周期。手动切换为 `on` 或 `auto` 会重置失败次数。Native Host 独立重连，退避间隔最高为 30 秒。
- 健康检查和停止请求使用带认证的 HTTPS，并验证证书 pin。Tether 不会终止外部进程，也不会更改配置端口。
- 扩展包包含醒目的目录锚点，方便选择已解压的扩展目录。
- 弹窗 CSP 允许加载扩展自身的 JSON 语言模块，同时继续禁止外部连接。

## 升级

安装 v1.0.0 并重新加载浏览器扩展。扩展与 runtime 应一起升级。

升级前先停止旧 Broker 进程，在解压后的新包中执行 `node bin/tether.mjs upgrade --home <安装目录>`，然后重新加载已解压的扩展。0.x Broker 不提供带认证的生命周期端点，残留的旧进程会被视为端口占用。runtime 的证书与 pin 需保持配套。

## 验证

- TypeScript 构建；38 项安装器测试、61 项运行时/扩展测试、5 项 Python 客户端测试。
- 在当前 Windows 主机的隔离目录中，从 tarball 全新安装，覆盖依赖安装、证书生成及可执行启动器编译。
- 从已发布的 0.1.1 包真实升级；所有原有 `.local` 文件的 SHA-256 均保持一致。
- 中英文弹窗渲染、键盘焦点、偏好持久化及文档链接检查。
- 真实 Chromium、隔离 profile 与 Native Messaging 注册：实际 action 弹窗、默认守护、关闭后保持停止 31 秒、手动开启再切回自动、Broker 停止后的周期恢复，以及本地页面的授权 requestSession/observe/fill/click/release。临时注册和 Broker 均已清理。
