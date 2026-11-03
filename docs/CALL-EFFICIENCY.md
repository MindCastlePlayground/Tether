# Reducing agent round trips: initial proposal

[简体中文](CALL-EFFICIENCY.zh-CN.md) · [Replay design](REPLAY-DESIGN.md)

2026-11-03. Exploration only; compound execution is not implemented.

## Recommendation

Combine one known action, an explicit wait condition, and a resulting tree in one tool call first. Then reuse stable business sequences as replay fragments. Keep judgment and branching with the agent; move polling, pagination, and predetermined operations into the runtime.

Measure model round trips, public tool calls, Broker/CDP requests, output tokens, and elapsed time separately. One public call can contain many browser requests. Returning an entire HTML document may reduce calls while increasing context cost. Counts below describe proposed call paths, not measured savings.

## Available today

| Scenario | Common path | Existing alternative | Public calls |
| --- | --- | --- | --- |
| Inspect the page after clicking | click → snapshot | click with `observe:{}`; reuse `after.tree` | 2 → 1 |
| Wait for a result | Repeated agent snapshots | One wait/assert with server-side polling | N → 1 |
| Missing attributes | Repeated summary reads | Switch to html with a stable captureId | Avoid unproductive retries |
| Read a large document | Model decides each next page | An SDK script loops over nextOffset and extracts relevant content | One model intervention is possible; RPC count remains the page count |

An action's `after.tree` reflects the state at observation time. Asynchronous completion still needs an explicit condition. `snapshot` is a simplified accessibility tree; `html` serializes the main document. HTML pagination can run in an existing code execution environment; a pure MCP client still calls each page. Raw HTML can contain hidden data and credentials, so scripts should return task-relevant information.

## Next: action, wait, result

Extend existing action options with a wait condition, reusing `Conditions` and the current observation structure. Start with single-action click/fill/navigate combinations rather than a second action engine.

- Input: existing action parameters, optional condition, optional result-tree scope. Names remain to be decided.
- Execution: preserve Broker permissions, sequence deduplication and page checks; dispatch the action once, poll only read conditions, then capture the tree.
- Output: separate action `sideEffect`, condition outcome/timing, and the resulting tree or observation error. A condition timeout retains the action's outcome.
- Timing: reconcile the SDK's 25-second timeout, Broker forwarding's 20-second timeout, and conditions' 15-second maximum. Stop subsequent steps when the overall budget expires; an already dispatched action may have an unknown outcome.
- Concurrency: serialize session writes and retain the independent dialog channel that can unblock an action.

When the target and condition are known, click → wait → snapshot or navigate → wait → snapshot can become one public call instead of three. Unknown pages and business branches still return control to the agent.

## Reusable fragments shared with replay

Next, support a constrained step list using the actions, inputs, assertions and outcomes in the [replay design](REPLAY-DESIGN.md). With known selectors, three fills → submit → wait → snapshot can become one run request instead of six calls. Stop on ambiguous targets, assertion failure or unknown outcomes, and return the failed step, completed steps and last tree. Never restart a submission sequence automatically.

Individuals can save and invoke common fragments directly. Teams can reuse repository PR review, fixtures and environment inputs. Fragments reuse authorized sessions. Existing business confirmations stay at their decision points.

Defer arbitrary JavaScript execution in the normal Broker. Existing sandbox and SDK environments can handle deterministic loops; general code execution introduces file, network and credential boundaries requiring separate design.

## Evaluation

Use the same model, fixture and task inputs to compare atomic calls with the proposed compound call: asynchronous save, a three-field form, a large document with hidden attributes, and navigation followed by action. Compare completion rate, model round trips, RPC count, output tokens, duration and duplicate side effects, including success and failure samples. Preserve success and side-effect behavior before optimizing call count. No percentage improvement is claimed at this stage.

## Sources

- [Playwright auto-waiting](https://playwright.dev/docs/actionability): actionability checks and retrying assertions support moving polling into the runtime.
- [Anthropic: Code execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp): composing tools and processing intermediate results in code can reduce model round trips and context use.
- [Anthropic: Writing effective tools](https://www.anthropic.com/research/writing-tools-for-agents): design around real tasks, return meaningful context and measure outcomes.

The sources motivate the direction. Tether's proposed interface, compositions and call estimates are project-specific recommendations.
