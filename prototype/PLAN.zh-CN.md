# M0 实现与验收计划

[English](PLAN.md) · [原型指南](README.zh-CN.md)

范围：仅支持现有 Chrome/Edge、MV3 Native Messaging 扩展、本机 TLS WebSocket Broker/Host、隔离的工作区授权、TypeScript/Python 客户端和 stdio MCP。不启动浏览器或 profile；不下载浏览器。实时检查仅操作本机合成测试页。本原型不是完整 M1。

阶段：实现 → 本地安全/集成测试 → 注册 Native Host 并在现有浏览器加载扩展 → 用户在弹窗批准 → 实时标签/分组/操作/隔离测试 → 报告准确证据和剩余门槛。

职责：主代理负责共享协议、Broker/Host、安装、Playwright 引擎适配和最终集成。扩展代理仅负责 extension/ 与扩展测试。客户端代理仅负责 src/client.ts、src/mcp.ts、python/、examples/client.ts 和客户端测试。

## 线协议

Node 端常量/枚举位于 src/protocol.ts；扩展在 extension/protocol.js 中维护对应线协议常量。使用认证 WSS 承载 JSON-RPC。客户端配置 JSON：{url, token, caFile, pin}；pin 是 DER SPKI 的 SHA256 Base64。Authorization Bearer token 请求头；不接受 Origin。客户端 URL 必须是数字形式的回环或显式 RFC1918 地址；验证 TLS 和 pin；不走代理。请求 {jsonrpc:'2.0',id,method,params}；响应为 {jsonrpc:'2.0',id,result} 或错误 {code:-32000,message:enum}。公开 RPC 不开放任意 CDP。

公开方法：requestSession({mode:'newGroup'|'attachExisting',url?})、approvalStatus({pendingId})、listTabs({sessionId})、createTab({sessionId,seq,url})、closeTab({sessionId,pageId,seq})、release({sessionId,seq})、observe({sessionId,pageId})、fill({sessionId,pageId,seq,selector,value})、click({sessionId,pageId,seq,selector})、navigate({sessionId,pageId,seq,url})、capabilities({})。请求使用不透明 session/page ID。M0 仅提供最小选择器操作，不实现完整 ref 协议。SDK 提供通用 call(method,params) 和带类型的便捷封装；不隐式重试。

Broker 为每个请求添加可信 clientId（拒绝公开 clientId）。Native Host WSS 使用独立 host token 认证，并通过固定配置使用 role=host；只允许一个 Host 连接。Host 通过 Native Messaging 向扩展转发相同 JSON-RPC。Broker 将 ID 替换为不透明 UUID；扩展返回相同 ID。扩展接收 {method,params:{...userParams,clientId}}，并作为授权权威。

扩展的 requestSession 创建 pendingId，120 秒后过期并显示徽标。用户通过工具栏弹窗连接 Native Host；弹窗列出本地待批准请求，并且仅为 attachExisting 本地枚举 http(s) 标签。弹窗通过内部 runtime message 批准，绝不通过 Native RPC 批准。请求先返回 pending；approvalStatus 返回 {status:'pending'|'approved'|'denied'|'expired',sessionId?,pages?:[{pageId,url}],groupId?}。弹窗必须拒绝 sender.url 不完全等于自身 popup.html 或存在 sender.tab 的消息；不提供网页批准页。Native 命令不能批准请求。approvalStatus 会校验所属关系。

扩展授权表按 clientId/sessionId/pages 管理。批准 newGroup 时依次执行空白页→分组→注册→导航，并在每次 await 后复核；组名为 BB-短随机 ID，每组最多 10 页。attachExisting 由用户选择页面；保留原分组/位置。拖入不授权，分组页面拖出则撤权；空任务组可重建。closeTab 仅可关闭本会话创建的页面；release 撤销授权并 detach，但保留页面/分组。Native 断连撤销所有授权；debugger detach 撤销页面授权，禁止隐式重连。仅允许 HTTP(S) 页面；本会话创建的空白页可导航/关闭。clientLost 内部方法撤销该客户端授权；heartbeat 内部租约为 15 秒。

内部引擎方法（非公开 RPC）：cdpAttach({clientId,sessionId,pageId}) → {tabId,targetInfo,version}；cdp({clientId,sessionId,pageId,method,params,childSessionId?}) → CDP 结果；cdpDetach 使用相同 ID。扩展校验授权、范围及严格审查过的 CDP 白名单。事件通知为 {method:'cdpEvent',params:{clientId,sessionId,pageId,method,params,childSessionId?}}。拒绝上游全 profile Cookie/Storage/Browser 命令。M0 不支持 OOPIF 子会话，必须 fail closed。Playwright 公开的进程内 transport 处理 observe/fill/click，不提供直接 evaluation 回退。Chrome debugger 不支持 Browser domain，因此版本元数据取自扩展 navigator.userAgent；revision/jsVersion 明确未知。CDP 失败日志只含方法名。

Native 帧最大为含 envelope 的 UTF-8 JSON 512 KiB，使用小端长度前缀。M0 双向拒绝超长帧，明确暂缓分块，不允许部分执行。错误只用枚举，不记录原始异常/URL/正文。副作用返回 {sideEffect:'applied'|'none'|'possible',...}；不重放结果不确定的写入。Broker 按 session 维护 seq 高水位和近期精确请求去重；扩展校验 client 所属关系。断连清除授权/结果。

验收证据必须区分 Fake Chrome API 测试、真实 TLS/Native 进程、实际 Chrome 扩展、实际 Agent MCP Client 和网络观察。不依赖外部遥测/模型；安装开发依赖可联网，运行必须离线可用。环境故障记录在 work/prototype-failures.md。
