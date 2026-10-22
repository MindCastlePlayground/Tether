# Tether v1.2.0

[English](RELEASE-v1.2.0.md)

**发布日期：** 2026-10-22

## 元素快照与精确定位器

- `snapshot({sessionId,pageId,scope?,depth?,maxChars?})` 返回简易无障碍树：每个元素一行，带角色、可访问名称和 `[ref=eN]`，匿名 div/span 包装层已折叠。
- `click`、`fill` 可用 `ref` 代替 `selector`。调用 `locate` 或描述目标后 ref 依然有效；ref 失效时按快照中的角色与名称重新匹配。
- `locate({sessionId,pageId,text?|role+name?|selector?|ref?})` 列出所有匹配，每项带经校验唯一的选择器；文字位于内层元素时附带可操作祖先。
- 策略规则把 `snapshot`、`locate` 视为 `observe`。MCP 服务提供 14 个工具。

## 更稳健的点击与填写

- `click`/`fill` 在动作前先把目标解析为恰好一个元素。选择器无匹配时，依次尝试：把 XPath `text()`（只匹配直接文本子节点）改写为 `normalize-space(.)`、`:contains()` → `:has-text()`、角色+名称、可见文本；`fill` 还会尝试 label 与 placeholder。
- 点击嵌套文字（`button > div > span`）会落到最近的可操作祖先；填写包装层时使用其中唯一的输入框。
- 目标缺失、有歧义、选择器非法、ref 失效或不可填写时，返回 `sideEffect:"none"` 及 `selector_not_found`、`selector_ambiguous`、`selector_invalid`、`ref_stale`、`not_fillable` 和候选列表，而不再表现为 `outcome_unknown`。
- 成功的动作返回 `strategy`、`target`（角色、名称、唯一选择器），使用回退时附带 `hint`。

## 升级

执行 `tether upgrade`（或 `install --upgrade`）。重启 Agent 会话以加载新的 MCP 工具列表；扩展会在空闲时自动重新加载。

参见[验收摘要](../prototype/VERIFICATION.zh-CN.md)。
