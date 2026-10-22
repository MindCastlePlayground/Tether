# Tether v1.2.0

[简体中文](RELEASE-v1.2.0.zh-CN.md)

**Release date:** 2026-10-22

## Element snapshot and precise locators

- `snapshot({sessionId,pageId,scope?,depth?,maxChars?})` returns a compact accessibility tree. Each element line carries its role, accessible name and `[ref=eN]`; anonymous div/span wrappers are folded away.
- `click` and `fill` accept `ref` as an alternative to `selector`. Refs stay valid across `locate` calls and target descriptions. When a ref is stale, Tether re-matches the snapshot's role and name.
- `locate({sessionId,pageId,text?|role+name?|selector?|ref?})` lists matches, each with a selector verified to match only that element, plus the actionable ancestor when the text sits in an inner element.
- Policy rules treat `snapshot` and `locate` as `observe`. The MCP server exposes 14 tools.

## More robust click and fill

- Before acting, `click`/`fill` resolve the target to exactly one element. When the selector finds nothing, they try a `normalize-space(.)` rewrite of XPath `text()` (which only matches direct text nodes), `:contains()` → `:has-text()`, role+name, and visible text. `fill` also tries label and placeholder.
- A click on nested text (`button > div > span`) lands on the nearest actionable ancestor. A fill on a wrapper uses the only field inside it.
- A missing, ambiguous, invalid, stale or non-fillable target now returns `sideEffect:"none"` with `selector_not_found`, `selector_ambiguous`, `selector_invalid`, `ref_stale` or `not_fillable`, plus candidates. Previously these surfaced as `outcome_unknown`.
- Successful actions report `strategy`, `target` (role, name, unique selector) and a `hint` when a fallback was used.

## Upgrade

Run `tether upgrade` (or `install --upgrade`). Restart agent sessions so they load the new MCP tool list; the extension reloads itself when idle.

See [verification](../prototype/VERIFICATION.md).
