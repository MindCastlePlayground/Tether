<p align="center">
  <img src="assets/logo.png" alt="Tether 标志" width="180">
</p>

<h1 align="center">Tether</h1>

<p align="center"><strong>连接你的浏览器。</strong></p>

[English](README.md) · [完整原型指南（英文）](prototype/README.md) · [完整原型指南（简体中文）](prototype/README.zh-CN.md) · [验收记录](prototype/VERIFICATION.md)

Tether 通过浏览器扩展和本机 TLS WebSocket Broker，让经过授权的本地客户端控制已运行 Chrome 中明确授予的页面。它不会启动浏览器，也不要求使用独立浏览器 profile。

## 功能

- 提供 Node.js、Python 客户端及 stdio MCP 服务。
- 可新建任务标签组（`newGroup`），也可接管客户端明确指定的一个已有 HTTP(S) 标签（`attachExisting`）。
- 按会话授予页面权限，并提供客户端认证、TLS 证书与 SPKI pin 校验、请求序号去重。
- 默认仅监听本机；局域网监听需要显式配置，并为每个客户端配置匹配的凭据。

## 架构

```text
已运行的 Chrome → Tether MV3 扩展 → Native Messaging → 本机 TLS WebSocket Broker
                                                               ├─ Node.js SDK
                                                               ├─ Python SDK
                                                               └─ stdio MCP
```

## 快速开始

前置条件、首次初始化、加载浏览器扩展、客户端配置和安全边界见[原型操作指南](prototype/README.zh-CN.md)。在 `Tether/prototype` 目录首次初始化：

```powershell
npm ci
python -m pip install -r python/requirements.txt
python scripts/setup.py
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/launchers.ps1
& ./scripts/register.ps1
npm run build
```

指南还说明了如何启动本机 Broker 和注册 Native Messaging。生成的 `.local/` 凭据与私钥应留在本机。

## 品牌

Logo 以青绿色连接环绕过深蓝色竖笔，形成小写 t。[品牌资源](assets/README.md)包含透明原图和扩展图标。

<img src="assets/popup-preview.png" alt="使用模拟扩展数据渲染的 Tether 授权弹窗" width="380">

*弹窗预览使用模拟数据，不连接运行中的 Broker。*

## 目录

- `assets/` — Tether 品牌资源。
- `prototype/` — 当前扩展、Broker、SDK、MCP 服务、初始化脚本和验收证据。
- `prototype/README.md` — 完整英文操作指南。
- `prototype/README.zh-CN.md` — 完整简体中文操作指南。

## 状态

仓库包含可运行原型，以及构建、模拟、协议和真实 Chrome 验收记录。具体通过项与未验证项见[验收记录](prototype/VERIFICATION.md)。Edge、第二台局域网机器和若干 M0 项仍未验收或未实现；现有证据不足以证明整个浏览器 profile 完全没有外部流量。
