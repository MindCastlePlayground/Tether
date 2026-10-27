# Tether Usability Improvement Plan

[简体中文](USABILITY-PLAN.zh-CN.md)

- **Date**: 2026-10-27
- **Status**: All three batches are implemented, the local installation is upgraded, and automated acceptance has passed. See the [implementation and acceptance record](USABILITY-VERIFICATION.md).
- **Author**: Written by Claude Opus 5.5 (medium), with review and tradeoffs by Codex.

---

## 1. Background and goals

Tether already provides the following capabilities:

- Page snapshots (`snapshot`): supports `scope`, `depth`, `maxChars`, and refs.
- Element lookup (`locate`): supports lookup by text, role and name, selector, or ref, and returns at most 10 candidates.
- Uniqueness checks: checks uniqueness before actions; recognized ambiguity is rejected with `sideEffect:none`, but the truncation check described below may still produce false results.

Three problems remain in day-to-day use:

1. **Lookup can escape its scope**: text fallback in the source may go beyond the original scope; its frequency has not been measured in this round.
2. **Large pages are hard to browse**: candidate lists lack context, so same-named buttons are hard to distinguish; a full-page snapshot is too long and has no table of contents for browsing by section.
3. **Results are hard to confirm**: after an action, users must take another snapshot manually to see what happened.

This plan addresses these issues in three batches. The order is **first prevent misclicks, then make targets easier to find, and finally make results easier to see**.

---

## 2. Current behavior and proposed changes

| Scenario | Current | Proposed |
|---|---|---|
| A selector with a parent scope (such as `.modal button:has-text("OK")`) finds no element | Text fallback may search the whole page and click an OK button outside the dialog | Fallback results must satisfy every restriction in the original selector; if this cannot be proven, return candidates only and do not execute |
| Many elements match, and only a later one is visible | Visibility is checked only for the first 20, which may be incorrectly treated as unique | Decide based on all results when the check is complete; reject the action when the check is incomplete, and never treat truncated results as unique |
| Reusing an old ref after navigation | There is a risk of accidentally matching a same-named ref on the new page (not reproduced yet) | Refs carry a document generation; after cross-document navigation, return `ref_stale` |
| Same-named buttons appear in multiple areas | Candidates include role, name, label, selector, and other details, but lack context for their row or area | Add context such as the containing row, list item, dialog, or region, plus a ref that can be used directly for actions |
| Large page | Only the whole page can be viewed, or a scope must be written manually | View an outline first, then expand areas as needed |
| Confirming results after an action | Requires another snapshot | Optionally include a bounded observation in the same call |

These findings come from source review (tests were not run). Relevant issues include text fallback in `Rewrite.all`, the 20-element limit in `visible()`, selectors returned by `unique()` without validation, and inconsistent visibility criteria between `describe` and `visible()`.

---

## 3. Batch A: lookup correctness and ref lifecycle

This batch fixes lookup behavior and changes the ref format without adding a standalone tool. Ref protocol validation, the SDK, MCP documentation, and usage documentation must be updated together.

### 1. Do not escape the original scope during fallback

This plan does not implement a general-purpose selector parser. The rules are:

- **Rewrite in place**: for example, replace `:contains` with `:has-text`. Keep this path only when semantic equivalence is confirmed.
- **Fallback results must satisfy every restriction in the original target**, including parent scope, tag, and attributes. For example, a fallback for `input[name=q]` must not return a `button` in the same area. “Same scope but different type” is not correct.
- **Complex selectors**: if the original selector contains combinators, XPath predicates, or other constructs, and fallback cannot be proven to preserve its scope, do not broaden the semantics. Return `selector_not_found` with candidates for the user to confirm.
- When users need to restrict the scope, prefer an explicit `scope` constraint (see Batch B).

### 2. Consistent visibility criteria

- Use the engine's visibility semantics consistently for counts and descriptions. Filtering by visibility before counting is acceptable.
- If resource limits prevent checking every match, return “check incomplete” and reject the action. This plan sets no fixed upper threshold; determine a suitable limit through measurement.
- If the check is complete and confirms exactly one visible element, the action may proceed.
- If `unique()` cannot verify uniqueness, candidates must be clearly marked “uniqueness not verified.”

### 3. Ref lifecycle

Accidentally matching a new element with an old ref after navigation is a **risk that has not yet been reproduced**. This batch implements it as a lifecycle requirement and includes acceptance criteria:

- Refs returned externally become **opaque identifiers that include a generation**; this document does not prescribe their exact encoding. If the server records a generation but a request still uses a bare `e12`, the server cannot tell which document it belongs to, so the generation must be part of the ref itself.
- **Within the same document**, a ref for the same element remains stable.
- **After cross-document navigation**, an old ref returns `ref_stale` and is not resolved by falling back to a role or name on the new page.
- **SPA URL changes only**: if the original element remains on the page, the ref does not have to become stale. If the element has been replaced, do not silently switch to another target based only on a same-name match across the page.
- Keep old mappings bounded; do not let them accumulate indefinitely.

---

## 4. Batch B: candidate context, unified scope, browsing by area, actionable error guidance

### 1. Unified scope parameters

`snapshot` and `locate` share two scope parameters: `scope` (a selector) and `scopeRef` (a ref from a snapshot or outline). They are mutually exclusive; supplying both returns a parameter error. `click` and `fill` do not add scope parameters; use the ref returned by `locate` directly.

### 2. Candidate context

- Each candidate includes the **nearest meaningful container** (row, listitem, dialog, or region), adding an associated heading when needed, rather than only the button's own name.
- If the page has no semantic structure, leave the context empty rather than inventing a name.
- Context has a length limit, while preserving identifying clues such as an order number or username in the row.
- A candidate's ref can be used for an action as soon as it is returned. If a precise selector's uniqueness cannot be verified, mark that clearly rather than claiming it is unique.

### 3. Candidate count

- Return at most 10 candidates by default, and report the total count, number shown, and whether results were truncated.
- When results are truncated, guide users to narrow the scope with `scope`. If the area itself is large, they can further filter within it by text or role.
- **Do not add pagination** in this batch. A head-and-tail hash cannot detect changes in the middle; decide whether pagination is needed when a real use case arises.

### 4. Page outline

- `outline` extracts region entry points from **one** semantic page snapshot. Users can then expand a region with `scopeRef`.
- The raw ARIA tree may omit unnamed regions, so the outline does not guarantee an entry for every DOM node. Such regions can still be viewed with a `scope` selector.
- Prefer refs for higher-level regions in the outline. When there are too many child regions, retain the parent region's entry and let users inspect the next level by expanding it. The outline is also subject to a length limit; if the budget is too small to fit an entry, clearly prompt for a larger `maxChars` or a `scope`. Do not return an unusable message such as “several more regions.”
- The snapshot's ref count includes only refs actually returned in this response; it does not include refs from collapsed subtrees.

### 5. Actionable error guidance

Error messages should tell users what they can do next. For example, ambiguity should suggest “use `scopeRef` to limit the area,” and a stale ref should suggest “take a new snapshot.”

---

## 5. Batch C: on-demand observation after an action

- This applies only when the user explicitly enables `observe`. After the action, perform one bounded observation and report this evidence: URL, whether navigation occurred, local content, and newly appearing prompt text.
- Report only what was observed; do not infer whether the business operation succeeded. Call something “new” only when before-and-after observation provides evidence; without prior evidence, say only “currently visible.”
- There is no guarantee of capturing every brief toast. Determine the wait duration through measurement; do not promise a fixed one second.
- **Observation failure**: leave the action result unchanged and do not repeat the write operation.
- **Action result is `outcome_unknown`**: do not change it to `applied`, even if observation succeeds.
- **Navigation invalidates the `scopeRef` used for observation**: report that it is stale; do not broaden the scope to another area.
- By default, `fill` does not echo the entered value, to avoid exposing sensitive fields.

---

## 6. Proposed output examples (illustrative, not measured)

**Example 1: `locate` returns candidates with context** (only two items are shown; `selectorUnique` indicates only whether the selector attached to the candidate is unique, not whether the ref is usable.)

```json
{
  "count": 23, "shown": 2, "truncated": true,
  "candidates": [
    { "ref": "<opaque-ref-A>", "role": "button", "name": "Delete",
      "context": "row ‘Order #10231 · Zhang San’", "selectorUnique": true },
    { "ref": "<opaque-ref-B>", "role": "button", "name": "Delete",
      "context": null, "selectorUnique": false }
  ],
  "hint": "Results were truncated; use scopeRef to limit the search to the target row or list"
}
```

**Example 2: `outline`**

```
- region “Filters”  ref=<ref-R1>
- table “Order list”  ref=<ref-R2>  subtree collapsed; can be expanded
- dialog “Edit order”  ref=<ref-R3>
3 refs returned. To view the order list: snapshot({…, scopeRef:"<ref-R2>"})
```

**Example 3: `click` with observation**

```json
{
  "sideEffect": "applied",
  "observed": true,
  "after": {
    "url": "https://example.test/orders",
    "navigated": false,
    "newTexts": ["Saved"],
    "excerpt": "row ‘Order #10231’ status: shipped"
  }
}
```

---

## 7. Proposed interface fields summary

| Field / return value | Applies to | Description |
|---|---|---|
| `scope` / `scopeRef` | snapshot, locate | Mutually exclusive |
| `outline` | snapshot | Returns a region outline |
| `count` / `shown` / `truncated` | locate | Total count, number shown, and whether results were truncated |
| Candidate `ref` / `context` / `selectorUnique` | locate | Can be used directly for actions; `selectorUnique:false` means only that selector uniqueness was not verified, while the ref still identifies the candidate element |
| `observe` | click, fill | Optional; observe after the action when enabled |
| `observed` / `after` | click, fill | Observation result; does not affect `sideEffect` |
| `ref_stale` | all ref inputs | Cross-document navigation or element replacement |
| Visibility check incomplete | action | Reject the action with `sideEffect:none` |

---

## 8. Compatibility and migration

- New scope, outline, and observation parameters are all optional. Existing methods remain available, but Batch A tightens automatic fallback and changes the ref format; callers that depend on old fallback behavior or validate the old ref format must migrate.
- After refs change to include a generation, **not every old ref can be made compatible automatically**. Bare legacy refs are not mapped automatically to the new format; callers must obtain a new snapshot after upgrading and use the opaque refs it returns. The new implementation must not map a bare legacy ref to a new target across snapshots or navigation.

---

## 9. Acceptance checklist (future acceptance criteria; none have been run)

**Batch A**
- [x] A same-named button exists both inside and outside a dialog: a selector scoped to the parent matches only the button inside the dialog; if a complex selector's scope cannot be proven, return candidates only and do not execute.
- [x] Fallback for `input[name=q]` does not match an element of another type in the same area.
- [x] One of the first 20 matches is visible, and the 25th is also visible: reject the action.
- [x] When resource limits leave the check incomplete, reject the action and report that the check is incomplete.
- [x] Snapshot → cross-document navigation → click with an old ref: return `ref_stale` and leave the page unchanged.
- [x] Across multiple snapshots in the same document, the same element retains the same ref.
- [x] After an SPA route change, if the original element remains, its ref still works; if it was replaced, do not silently match a same-named new element.

**Batch B**
- [x] Supplying both `scope` and `scopeRef` returns a parameter error.
- [x] For same-named buttons in a table, candidate context distinguishes their rows; with no semantic structure, context is empty.
- [x] A candidate ref can be used directly for `click`.
- [x] On a large page, obtain an outline once and expand one area, using two scans total.
- [x] When the outline is truncated, it still provides an entry point for continued browsing.

**Batch C**
- [x] A submit action with `observe` enabled returns factual fields only.
- [x] If observation is deliberately timed out, `sideEffect` stays unchanged and the write operation runs only once.
- [x] When the action result is `outcome_unknown`, successful observation does not change it to `applied`.
- [x] By default, `fill` does not echo the entered value.

---

## 10. Deferred items

The following are out of scope for this round: full DOM output, intelligent fuzzy auto-clicking, persistent page monitoring, workflow engine, new frontend, and `locate` pagination.

## Source basis and documentation review

This plan is based on source review of `prototype/src/locator.ts`, `protocol.ts`, `mcp.ts`, `engine.ts`, and `skills/tether-browser/SKILL.zh-CN.md`. After Claude completed the main text, Codex corrected descriptions of current behavior, example counts, the meaning of selector uniqueness, the outline expansion entry point, and migration notes. That describes the original planning review. Implementation, installation and automated acceptance are now complete; results are recorded in the implementation and acceptance document.
