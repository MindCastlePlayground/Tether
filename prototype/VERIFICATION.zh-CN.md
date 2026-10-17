# M0 验收记录

[English](VERIFICATION.md) · [原型指南](README.zh-CN.md)

日期：2026-10-11。本文随真实浏览器测试更新；构建和模拟通过不代表端到端通过。以下是当日记录的历史证据，不代表本次文档国际化修改执行了新测试。

| 项目 | 当前证据 | 结论 |
|---|---|---|
| 构建 | TypeScript 编译成功 | 通过 |
| Node 综合测试 | `evidence/node-tests.txt`，30/30；包括 fake Chrome 授权测试、默认自动新建/接管/开关/撤销、真实 TLS、限帧、请求去重、传输异步回复 | 通过，部分为模拟 |
| Python SDK | `evidence/python-tests.json`，5/5；真实 Broker 连续调用、坏凭据、发送 HTTP 前校验证书 pin、代理绕过 | 通过 |
| MCP | `evidence/mcp.json`；真实 `.local/mcp.exe` + 官方 MCP Client，列出 12 工具并调用 capabilities；下述真实页面流程也通过 | 通过 |
| Native Messaging 可执行程序 | `evidence/native.json`；真实 EXE、长度前缀分片、往返、EOF 退出、错误来源拒绝；扩展对端模拟 | 传输通过 |
| 现有 Chrome 扩展连接 | 用户加载扩展后，真实 Broker 返回 `browserConnected: true`；没有启动浏览器或 profile；自动接管原有标签成功 | 通过 |
| 新建标签组 / 已有标签 / MCP 页面控制 | `evidence/live-{newGroup,attachExisting}-{node,mcp}.json`；4 条流程均成功：默认自动授权、读取、填表、点击并检查保存文本、附加页创建/关闭、释放 | 真实 Chrome 通过 |
| 已有页面生命周期 | 两个 attachExisting 实测均保留原分组；释放后同一 tabId 仍存在 | 通过 |
| 授权隔离 | 真实 Chrome 拒绝其他 client 使用本会话/page，拒绝另一个 client 同时接管已占用 tab，释放后观察拒绝；模拟另覆盖组迁移、popup 来源、断线、租约和工具栏撤销 | 真实核心隔离通过；部分边界仅模拟 |
| LAN 接口 | `evidence/lan.json`；本机经 `192.168.3.7:18450` 调用成功，错误源 CIDR、LAN 上的 Native Host 角色拒绝 | 同机 LAN 路径通过；第二台机器未验 |
| 无预期外传 | `evidence/network-sample.json`；4 次原型 Broker/Host/SDK TCP 快照，回环外连接为 0；同时检查扩展 CSP、数字内网地址、证书 pin、禁代理/重定向 | 有限证据通过；完整零外传未验收 |

## 实测发现并修复

1. Node SDK 每次请求关闭连接会导致授权随即丢失：改成持久连接。
2. TLS pin 必须在发送 Authorization 前校验：Node/Python 均已验证失败 pin 不产生 HTTP 字节/upgrade。
3. Python TLS 重复包装：已修复并真实往返测试。
4. Windows .NET 启动器在 stdin 管道前写入 UTF-8 BOM，MCP 无法解析：设置无 BOM 编码、二进制流转发并刷新；真实 EXE 握手通过。
5. popup sender 取值、重复批准、组迁移、撤销时序、断连重连：已修复并模拟验证。
6. Chrome debugger 不支持 Browser domain：版本改取扩展环境 userAgent，未知 revision/jsVersion 留空，需要重新加载扩展才能用于真实验收。
7. 实际创建标签组成功后，Playwright 因同步 transport 回复先于内部回调登记而断言退出。改为 microtask 异步分发，回归和最终真实页面操作均通过。
8. Playwright 点击前需要 `DOM.scrollIntoViewIfNeeded`：加入页面级白名单。
9. `noDefaults` 关闭了 Playwright 默认页面焦点模拟，后台页点击等待稳定性超时：在已授权页面显式设置 `Emulation.setFocusEmulationEnabled`，四条真实浏览器流程随后通过。未启用浏览器全局默认配置，未使用 force 点击绕过检查。

第 6、7 项修复均已随最终真实浏览器测试复验通过。新建及已有标签默认放行是用户明确更新的策略，仍要求有效客户端凭据；关闭开关会停止自动批准及标签枚举，但不会自动撤销已有会话。M0 开关未持久化，扩展重新加载恢复默认开启。

## 不算已验证的内容

- Python SDK 已通过真实 Broker 安全/连续调用测试；Python 直接执行页面动作尚未单独验收。页面动作验收入口为 Node SDK 和官方 MCP Client。
- 没有通过另一台 LAN 主机实测，没有修改防火墙，没有公网监听。
- TCP 采样不是抓包，未覆盖短暂连接、UDP、所有依赖内部路径或浏览器本体同步/上报。不能据此承诺整个现有浏览器 profile 严格零外传。
- 未验证真实 Edge、Chrome 重启/扩展 service worker 崩溃残留、真实拖入拖出、Debugger 争用、工具栏手动关闭开关及撤销的完整真实 UI 流程、OOPIF；M0 不开放 OOPIF 自动连接、文件和弹窗自动授权。
- 2026-10-11 的测试没有向真实模型发送网页内容；当时“Agent 调用”指实际 MCP 工具协议调用。下方真实模型测试补充了后续证据。模型侧外传策略由 Agent 部署方式决定。

## 复跑与安全

见[原型指南](README.zh-CN.md)。原有浏览器自动测试脚本只操作本地合成页 `http://127.0.0.1:18444/`；后续模型驱动的公共网站测试另记于下方。按用户更新要求，新建组及指定已有页默认自动批准；测试代码不直接调用批准函数。真实标签枚举只用于在客户端内找到合成页，不将其他页面列表写入证据。FakeChrome 单元测试里的批准不会影响真实浏览器。

本目录 `.local/` 含凭据和私钥，只保留本机当前用户/SYSTEM ACL。报告与日志没有凭据；证据仅含合成数据及操作状态。

## OpenCode 1.2.27 真实浏览器验收 — 2026-10-17

隔离安装官方 `opencode-windows-x64@1.2.27`，二进制实际返回版本 `1.2.27`。配置和 XDG 目录均位于本地 `work/`，保留现有 OpenCode 安装及用户配置。已配置的文本模型（`deepseek-v4-flash`）经 stdio、Broker、Native Messaging 和手动加载的 Chrome 扩展执行真实 Tether MCP 调用。本次使用 Node 启动 `dist/mcp.js`，未使用生成的 MCP EXE 启动器。凭据从本地配置及环境变量读取。

| 流程 | 实际工具证据 | 结论 |
|---|---|---|
| 连接 | `mcp list` 显示 Tether connected；加载扩展后 `capabilities` 返回 `browserConnected: true` | 通过 |
| 本地页面 | 8 次调用全部 completed：capabilities、requestSession、observe、fill、click、observe、closeTab、release。填写 `#name`、点击 `#save` 均返回 applied；观察读回 `saved: TETHER_OPENCODE_1_2_27` | 通过 |
| 真实网站 | 9 次调用全部 completed：capabilities、requestSession、observe、fill、observe、click、observe、closeTab、release。在 `https://www.wikipedia.org/` 的 `#searchInput` 输入 `Python`，点击 `button[type=submit]`；观察确认跳转至 `https://zh.wikipedia.org/wiki/Python`，返回条目标题及 16000 字符可见文本 | 通过 |
| 清理与结束 | 两次运行均关闭测试标签、释放会话并返回 ok=true；最终 step_finish reason=stop，无 error 事件 | 通过 |

公共首页的选择器在模型运行前经过独立检查。上述页面读取、填写和点击均由 OpenCode 通过 Tether MCP 完成，证明真实网页读取、输入和导航可用，但未验证任意页面全部控件的自动发现能力。observe 最多返回 16000 字符可见正文，条目结果不代表全文提取。本次未覆盖 Edge、全部工具及所有授权和生命周期边界。

精简事件证据见 [OpenCode 浏览器实测](evidence/opencode-1.2.27-browser.json)。原始事件、本地测试配置及临时运行脚本保留于被忽略的 `work/opencode-1.2.27/`。本次合成及公共页面内容实际发送给了已配置模型，不属于零外传验收。
