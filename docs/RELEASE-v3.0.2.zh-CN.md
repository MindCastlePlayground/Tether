# Tether 3.0.2

[English](RELEASE-v3.0.2.md) · [项目介绍](../README.zh-CN.md)

本版本针对浏览器自动化、Broker 通信、iframe 操作、专用沙箱和开发检查中的具体故障进行修复。

## 修复内容

### 1. Snapshot 引用批量分配

- **问题：** 大页面 snapshot 创建引用时会触发大量 CDP 往返，控件多时可能超过 128 个 pending 请求的上限。
- **根因：** 原实现通过 `Promise.all` 逐元素发放 refs，并在不同执行上下文间转换元素句柄。
- **方案：** 使用 `Refs.batch` 在同一 injected 选择器上下文批量发放；复用包含 ARIA refs 的 isolated/utility world，并将 Playwright 固定为 `1.64.0` 以匹配适配方式。
- **影响：** 大页面 snapshot 减少逐元素通信，引用分配保持在其所属执行上下文；Playwright 升级需遵循集成兼容性约束。

### 2. Broker 队列满时的心跳处理

- **问题：** 高并发读取期间队列已满会导致 Broker 断开仍可用的主机连接。
- **根因：** 心跳处理把所有错误都当作主机掉线；异步错误也可能作用到后来建立的新连接。
- **方案：** `queue_full` 不再终止 host；异步错误只处理发起该心跳时对应的 host 连接。
- **影响：** 队列压力不会单独中断现有会话，后续连接也不会被旧心跳错误误断开。

### 3. 超过 512 KiB 的消息

- **问题：** 超大消息可能关闭 WebSocket、让扩展静默丢弃回复，或使请求一直等待；CDP payload 错误还可能表现为 8 秒超时。
- **根因：** 发送失败时未清理 pending 请求；扩展与 Broker 未返回关联 RPC 的明确错误；Playwright 重试会隐藏底层 payload 错误。
- **方案：** 发送失败时清理 timer 和 pending 状态；超大响应返回匹配 RPC id 的 `payload_too_large`，并保留 native port 和会话。`Engine.run` 使用 `AsyncLocalStorage` 记录当前调用的底层错误，准确返回且隔离并发及后续调用。
- **影响：** 超限请求立即得到可识别错误，连接和会话保持可用。512 KiB 限制不变；写操作结果不确定时仍返回 `outcome_unknown`，不自动重放。

### 4. iframe 控件定位与引用

- **问题：** 普通控件定位和 refs 只覆盖主文档，iframe 内控件无法按框架作用域稳定操作。
- **根因：** Locator 缺少 frame 路径，Refs 只在主文档查找；OOPIF 鼠标坐标换算需要的 `DOM.getFrameOwner` 未列入 CDP 允许列表。
- **方案：** 支持 `frame=iframe#vendor >> input` 形式的 Locator、框架作用域 ref 及 `scopeRef` snapshot 映射；元素身份固定，替换后拒绝旧 ref；在现有页面授权限制下允许 `DOM.getFrameOwner`。
- **影响：** iframe 控件可填写、点击和引用。此项不改变网络采集范围，也不代表 iframe HTML 或网络数据全面支持。

### 5. 弹窗标签页点击

- **问题：** 后台弹窗中的点击因可见性、启用状态或稳定性检查停滞而在 8 秒后超时。
- **根因：** 后台标签页中的弹窗动画帧和稳定性检查无法正常推进。
- **方案：** 点击前调用 `page.bringToFront`，并在现有授权范围内允许会话调用 `Page.bringToFront`；继续使用真实鼠标点击。
- **影响：** click 会将目标授权标签页置于前台，这是可见的浏览器行为变化。

### 6. 新建分组授权时的空白标签页

- **问题：** `newGroup approve` 偶发 `denied`，即使 Chrome 随后已创建目标标签页。
- **根因：** 授权检查读取到 `pendingUrl=about:blank` 时立即校验 URL 和分组；`createTab` 有等待流程，`approve` 当时没有。
- **方案：** 增加有界的 `BlankWait`/`BlankPoll`，等待期间复查 pending 状态，再检查实际 URL 和分组。
- **影响：** 标签页创建时序变化时，授权仍按实际 URL 和分组检查，减少随机拒绝。

### 7. 专用沙箱中的扩展重载

- **问题：** 专用沙箱重载扩展后可能残留 `DISABLE_RELOAD=4`，或遇到 `unsupportedDeveloperExtension`，导致扩展未就绪。
- **根因：** 持久 profile 缓存旧模块，过早终止 Chrome 会中断重载；profile 未启用 developer mode。
- **方案：** 按源内容签名检测变化，通过 `chrome://extensions` 的 `developerPrivate.reload` 发起重载并等待完成；专用 profile 启用 developer mode 和 Tether，先连接 CDP 处理扩展，再等待 Native ready。
- **影响：** 专用沙箱能在保留 profile 和数据卷的情况下完成扩展重载与 Native 初始化；此修复作用于专用沙箱。

### 8. 沙箱 JavaScript 对话框

- **问题：** 沙箱中的 Playwright 检查会默认关闭 JavaScript 对话框，和 Tether 的响应处理争用同一对话框。
- **根因：** 检查连接没有注册 dialog 监听器，Playwright 对未处理对话框采用默认 dismiss 行为。
- **方案：** 注册仅观察对话框的监听器；接受或取消仍由已授权的 Tether 会话处理。
- **影响：** 沙箱中的真实 `prompt`/`confirm` 由 Tether 会话响应。

### 9. Node 22 与测试环境隔离

- **问题：** Node 22 不支持原测试命令使用的隔离参数；Linux 测试还会因用户目录差异和 Windows 安装器布局假设失败。
- **根因：** 测试命令沿用 Node 22 不识别的参数，Linux 的 `HOME` 与 `USERPROFILE` 不一致，安装器测试依赖 Windows 平台和 npm 目录结构。
- **方案：** 调整根测试参数，运行时测试逐文件串行隔离并统一 `HOME`；Windows 安装逻辑在测试中使用局部替身。
- **影响：** Node 22 和 Linux 环境可以运行对应开发检查；这不表示 Windows 安装器已支持在 Linux 原生运行。

### 10. 十种本地业务模拟的验证收尾

- **问题：** 合成业务页面已写入数据时，DOM 仍在异步更新，断言会过早失败；HTTP 残余连接会拖住服务关闭。
- **根因：** 断言未等待页面明确确认，服务关闭前未清理活动连接，关闭或资源释放失败也未计入失败结果。
- **方案：** 等待页面确认后再断言；断言结束调用 `closeAllConnections`，并将 close/release 失败计为验证失败。
- **影响：** 十种场景验证结果对应页面确认状态，清理失败会反映在退出结果中。

### 11. 设计文档引用

- **问题：** `docs:check` 因设计文档引用仓库外相对路径而失败。
- **根因：** 文档依赖本地仓库之外的资料路径。
- **方案：** 将外部路径引用改为对本地资料的文字说明。
- **影响：** 设计文档可在独立检出的仓库中检查和阅读。

## 验证

2026-11-06：构建、根测试 68 项、运行时测试 156 项及中英文档检查通过。Grok 4.7 通过真实 Chromium、扩展、Native Messaging、Broker 与 MCP 驱动十种本地业务模拟，同一次完整运行 10/10 通过，包含会话清理。复跑命令和场景见[完整业务验证](../sandbox/README.md#完整业务验证)。
