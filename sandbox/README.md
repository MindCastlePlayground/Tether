# Messenger 浏览器扩展测试沙箱

此沙箱在 Messenger 的独立 Docker 容器中运行 Chromium、Tether 扩展和 MCP 服务，供 Codex 通过 SSH stdio 操作。部署目录为 `/srv/deploy/tether-sandbox`，容器名为 `tether-sandbox`，MCP 仅绑定 Messenger 的 `127.0.0.1:18780`。浏览器数据保存在独立 Docker volume `/data`。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `sandbox_status` | 查看浏览器状态、扩展 ID、Native Messaging broker 状态和页面 URL。 |
| `sandbox_browser` | `start`、`stop`、`restart` 或 `reset` 浏览器；可传额外解包扩展目录列表。 |
| `sandbox_exec` | 在容器内运行 Bash 命令，最长 300 秒，输出保留末尾 100,000 字符。 |
| `sandbox_files` | 在容器内 `read`、`write`、`list` 文件；`/data` 跨容器重启保留。 |
| `sandbox_eval` | 执行异步 JavaScript，提供 Playwright 的 `context`、`browser`、`chromium`。 |
| `sandbox_screenshot` | 获取页面截图；`pageIndex` 对应状态中的页面列表，默认最后一页。 |
| `sandbox_cdp` | 执行 Chrome DevTools Protocol 命令；可指定 target 操作扩展弹窗、service worker、iframe 等。 |
| `tether` | 通过真实扩展 Native Messaging 调用 Tether Broker。 |

典型 Tether 会话先调用 `tether` 的 `requestSession`，参数如 `{ "mode": "newGroup", "url": "https://example.com" }`，后续用返回的 `sessionId` 和页面 `pageId`。变更操作带递增的 `seq`。结束时调用 `release`。

### 加载额外解包扩展

用 `sandbox_files` 将扩展的 `manifest.json` 和其他文件写入 `/data`，例如 `/data/extensions/my-addon/`。随后调用 `sandbox_browser`：

```json
{"op":"restart","extensions":["/data/extensions/my-addon"]}
```

扩展目录必须包含 `manifest.json`。Tether 扩展会继续加载。移除额外扩展时传 `"extensions": []` 并重启。

### 操作真实工具栏弹窗

Playwright 的 `context.pages()` 不包含扩展工具栏弹窗。先从 `sandbox_status` 取得 `extensionId`，用 `sandbox_eval` 找到对应 service worker 并打开真实 popup：

```js
const extensionId = 'ojofdihdmmgpnaedmomclpmdkhnmbjln'; // Tether；其他扩展使用其实际 ID
const worker = context.serviceWorkers().find(w => w.url().includes(extensionId));
await worker.evaluate(() => chrome.action.openPopup());
```

接着以 `sandbox_cdp` 调用 `Target.getTargets`，找到 URL 为 `chrome-extension://<extensionId>/popup.html` 的 target，再对该 `targetId` 调用 `Runtime.evaluate` 与 `Target.closeTarget`。弹窗页面的 DOM 交互可通过 `Runtime.evaluate` 执行。

### 查看网页网络记录

使用 `tether` 的 `network` 方法，并传入 `sessionId`、`pageId`：先 `op: "start"` 开始记录，再按需查询：

- `list`：请求列表，支持 `offset`、`limit`。
- `detail`：指定 `requestId` 查看请求详情、头部和事件。
- `body`：读取响应体，支持 `offset`、`maxChars` 分段。
- `stop`：停止记录。
- `clear`：清除记录。

## 配置 Codex

项目连接器 `sandbox/connect.py` 通过 Paramiko SSH 登录 Messenger，再执行 `docker exec -i tether-sandbox node /app/sandbox/proxy.mjs`，以 stdio 转发到容器内 MCP。首次部署需将 Messenger 主机公钥加入系统 known_hosts 或 `sandbox/.local/known_hosts`；连接器使用 `RejectPolicy` 校验主机密钥。SSH 参数从 Windows 用户环境变量 `MESSENGER_SERVER_HOST`、`MESSENGER_SERVER_PORT`、`MESSENGER_SERVER_USER`、`MESSENGER_SERVER_PASSWORD` 读取。

在 `D:\Code\data\codex\config.toml` 配置服务器名 `messenger_sandbox`，示例：

```toml
[mcp_servers.messenger_sandbox]
command = "D:\\Code\\env\\Python\\Python312\\python.exe"
args = ["H:\\Documents\\Abyss\\plugins\\Tether\\sandbox\\connect.py"]
startup_timeout_sec = 30
tool_timeout_sec = 360
enabled = true
default_tools_approval_mode = "approve"
```

此配置已安装，并通过相同命令和参数实测工具发现与调用。连接器也会从 Windows 当前用户环境读取未被旧进程继承的变量。新会话载入 MCP 配置；已经运行的会话工具列表可能需重新加载。密码和 `/data/mcp-token` 保留在各自环境及受保护文件内。

## 构建与部署

在 Windows 项目根目录执行：

```powershell
cd H:\Documents\Abyss\plugins\Tether
cd prototype
npm run build
cd ..
python sandbox\package.py
python sandbox\remote.py put outputs\sandbox.tar.gz /srv/deploy/tether-sandbox/sandbox.tar.gz
python sandbox\remote.py exec "cd /srv/deploy/tether-sandbox && tar -xzf sandbox.tar.gz && cp sandbox/compose.yaml compose.yaml && docker compose -p tether-sandbox up -d --build"
```

Compose 配置将端口限制在 `127.0.0.1:18780`，并挂载专用 `sandbox-data` volume 到 `/data`。健康检查地址为容器内 `http://127.0.0.1:18780/health`。部署后可通过 Codex 的 `messenger_sandbox` 调用 `sandbox_status` 查看连接情况。

## 数据、重置与资源

`/data/profile` 是 Chromium 的独立持久 profile，容器重启后保留 cookies 和站点存储。`sandbox_browser` 的 `restart` 保留 profile；`reset` 删除并重建该 profile。`reset` 不清理 `/data` 中的其他文件或 MCP token。额外扩展列表在服务进程内保存，容器重建后重新指定。删除测试文件可使用 `sandbox_exec`。

Compose 对容器限制为 2 CPU、2304 MiB 内存、512 MiB `/dev/shm` 和 512 个进程，并丢弃 Linux capabilities、启用 `no-new-privileges`。容器未挂载宿主机文件系统或 Docker socket。`sandbox_exec` 在容器内执行 Bash，单次超时上限 300 秒；大输出或文件应保存到 `/data`，工具输出仅保留末尾 100,000 字符。

## 验收状态

2026-11-02，最终镜像重建后，`sandbox/acceptance.mjs` 六组真实端到端测试全部通过：MCP 工具与容器文件/命令；真实工具栏弹窗及自动授权开关；会话与标签页操作；HTTP/POST/重定向/SSE/WebSocket 网络记录及响应体分页；对话框/弹窗/iframe/上传/下载/截图/CDP；额外扩展加载、浏览器重启和 profile reset。整个测试没有人工交互。

复跑：`docker exec tether-sandbox node /app/sandbox/acceptance.mjs`。测试会重置专用浏览器 profile，运行前保存需要保留的测试登录态。验收日志在 `/data/acceptance.log`，Chrome 日志在 `/data/chrome.log`；服务日志用 `docker logs tether-sandbox`。

Beacon 服务标识为 `local/docker/tether-sandbox`，健康检查与版本已接入；管理入口为 [Beacon](http://192.168.3.23)。MCP 经 SSH 使用，服务卡片关闭自动生成的 HTTP 入口。

## 完整业务验证

`business-flows.mjs` 在专用浏览器中通过 Tether 的真实扩展、Native Messaging、Broker 和 MCP 执行业务动作，再独立核对服务端数据与页面结果。模拟站点覆盖购物车下单、资料持久化、工单、预约取消、分页表格、文件上传下载、JavaScript 对话框、弹窗接管、跨进程 iframe 表单，以及动态长页面和超大响应恢复。所有业务数据均为本地合成数据。

部署最新沙箱后运行：

```bash
docker exec tether-sandbox node /app/sandbox/business-flows.mjs
```

程序会重启专用浏览器，保留 profile，并在每个场景结束时关闭该场景创建的标签、释放会话。失败返回非零退出码；日志应有十条 `PASS` 和 `SUMMARY passed=10 failed=0`。机器摘要写入容器 `/tmp/business-summary.json`。只复查失败场景时，可传入逗号分隔的名称，例如：

```bash
docker exec -e TETHER_BUSINESS_SCENARIOS=dialog,iframe,recovery tether-sandbox node /app/sandbox/business-flows.mjs
```

验证开始时启动 `tether-sandbox`，结束后停止容器；通过 Beacon 管理时同时标记停止。
