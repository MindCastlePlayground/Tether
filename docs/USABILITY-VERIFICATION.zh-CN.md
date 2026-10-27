# Tether 易用性改进：实现与自动验收

[English](USABILITY-VERIFICATION.md)

2026-10-27。三批改进已实现，版本为 **1.3.0**，本机安装已自动升级。源码和安装目录中的版本均通过了真实扩展及 MCP 链路验收。

## 使用上的变化

- **先看目录，再展开区域**：`snapshot({…,outline:true})` 返回目录；将其中的 ref 传给 `snapshot({…,scopeRef})` 查看该区域。`scope` 和 `scopeRef` 二选一。
- **同名按钮更容易区分**：`locate` 返回所属行、列表项或区域的上下文，以及可直接操作的 ref。`count` 是总匹配数，`shown` 是本次候选数，`truncated` 表示还有未显示的候选；最多显示 10 个。
- **不再越出选择器范围自动点击**：只保留能保持范围的局部改写。裸文本请改用 `locate({…,text})`，然后使用返回的 ref；选择器形式可以用 `text=…`。
- **引用跟随实际元素**：同一元素在重新快照、改名或同文档路由变化后保持 ref。导航或元素替换后，旧 ref 返回 `ref_stale`，不会改点同名新元素。每个文档最多保留 4096 个最近使用的引用。
- **动作后可自动查看结果**：给 `click` 或 `fill` 添加 `observe:{maxChars:6000}`。返回 URL、标题、是否导航、简洁树和截断状态；这些是页面事实，不表示业务操作已经成功。
- **填写内容不随结果回显**：动作后的观察会隐藏字段值；填写操作返回的目标信息仅保留引用、角色、标签等结构信息，省略文本描述，避免已有长文本或转义内容泄露。直接调用普通 `snapshot` 仍用于查看页面内容。

## 自动验收结果

| 验收 | 结果 |
|---|---|
| TypeScript 构建 | 通过 |
| 安装器与根目录测试 | 58 项通过 |
| 完整运行时回归 | 117 项通过 |
| 最后一次定位专项回归 | 27 项通过，包含随后补充的 textarea 已有值脱敏测试；与完整回归有重叠 |
| 最终脱敏修正专项回归 | 8 项通过，包含已有长文本及动作后观察；与上述回归有重叠 |
| 源码端到端验收 | SDK 和真实 MCP stdio 均通过 Broker、Native Host、扩展操作页面 |
| 已安装版本端到端验收 | 使用安装目录的代码重复上述链路，通过 |
| 安装内容核对 | 8 个相关源码文件与仓库一致；安装标记 ready；Native Host 注册指向安装目录 |
| 自动清理 | 测试专用 Native Host 注册项已移除 |

覆盖场景包括：原范围内查找失败、超过 20 个匹配项的歧义、检查未完成时拒绝、同名元素替换、跨文档导航、目录展开、候选上下文与截断计数、候选 ref 操作、观察失败和超时不重试写操作、`outcome_unknown` 保持不变、观察遵守读取策略，以及填写脱敏。

## 无需手动安装的方式

本机直接复用了现有受管安装目录 `C:\Users\74756\AppData\Local\Tether\runtime`。通过安装器原地更新源码、依赖、构建结果和扩展目录，没有重新生成凭据；首次升级前后核对了三份连接配置的文件哈希，结果一致。

升级前的代码备份位于 `C:\Users\74756\AppData\Local\Tether\backups\usability-20261027-012945`。保留当前 `.local` 配置，可以用该备份恢复代码和构建文件。

端到端测试自动发现已安装的 Playwright Chromium / Chrome for Testing，创建独立的无界面浏览器配置，自动加载测试扩展和临时 Native Host。它不需要打开扩展管理页，也不需要在日常浏览器里手动加载扩展。

本次验收使用隔离浏览器和本地测试网页；未把它写成日常浏览器中所有网站的实际验收。现有安装仍使用原扩展目录，扩展空闲时会按已有机制自动重载；已启动的旧 MCP 进程需要重新连接才能载入新工具定义。

## 复跑与记录

在仓库根目录使用以下命令，验证源码或指定安装目录。脚本需要目标运行目录已有 `.local` 配置，以及支持自动加载扩展的 Chromium。

```powershell
node prototype/scripts/locator-e2e.mjs
$env:TETHER_QA_RUNTIME = "$env:LOCALAPPDATA/Tether/runtime"
node prototype/scripts/locator-e2e.mjs
```

摘要记录位于 `outputs/usability-implementation/`：`runtime-tests-final.log`、`locator-tests-final.log`、`root-tests.log`、`extension-e2e-final.log`、`installed-result.json`、`installed-check.json` 和 `upgrade-result.json`。

实现中修复了真实 CDP 连接与普通浏览器测试之间的选择器注册差异；此适配随当前固定的 `playwright-core 1.64.0` 一并验收。升级该依赖时应复跑真实扩展测试。

原方案及取舍见[易用性改进方案](USABILITY-PLAN.zh-CN.md)。
