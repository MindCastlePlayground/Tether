# Replay Design

[简体中文](REPLAY-DESIGN.zh-CN.md)

## Goal

Add a reusable, inspectable browser replay capability to Tether. A replay is a named sequence of browser actions, inputs and assertions that can run against a fresh authorized page. Keep the scenario definition separate from recording, and make network behavior an explicit run choice. This document defines a design only; it does not add implementation or promise existing replay support.

## Existing building blocks

- Tether authorizes browser access through `requestSession`/approval, then exposes page operations and `release`. Mutating calls use a serialized, increasing `seq`; a timeout leaves the website-side result uncertain.
- The sandbox provides Playwright `context`, `browser` and `chromium` through `sandbox_eval`; its profile persists until explicitly reset. Tests that need isolation must use a fresh context/profile or a dedicated disposable browser state.
- The network SDK can start/list/detail/body/stop/clear capture for a session page. It records traffic after capture starts; it is an inspection facility, not a HAR replay facility.
- MinimumWebAuto offers a compact authoring model worth considering: `site(url)`, readable actions such as `fill`/`click`, assertions via `see`, chainable scoped views, and explicit temporary profiles. Reuse the clarity and isolation ideas, not its Python API or behavior. Its documented package currently exposes visible-text interaction, `Target.css`, table/list helpers, `Profile.TEMP`, and managed/monitor/hot modes.

## Scenario model

Represent a reusable scenario as a versioned, human-authored definition with a stable scenario ID, title, start URL, optional viewport/locale, ordered steps, and declared inputs. Keep definitions in ordinary source-controlled files (format to be selected during implementation); do not create generated manifests or a second status database.

Each step is one action or assertion. Initial action vocabulary should cover navigation, visible-text or role-based click, fill from a named input, select/check/uncheck, wait for a locator/state, and screenshot capture. Initial assertions should cover URL, visible text, locator count/state, and an explicitly selected page value. Use semantic locators first; allow CSS only as a deliberate escape hatch. Assertions report observed values and fail at the exact step. Do not infer business success from a click or from a network response alone.

Keep reusable actions as named scenario fragments with typed inputs and outputs, so common login/navigation/setup flows can be composed without copying steps. Keep assertions separate from actions and make their expected values reviewable. Parameters belong in a declared input table with type, required/default status, and secret flag; resolve values at run time from a caller-provided protected source. Never inline credentials, cookies, tokens, or private test data in scenario files or traces.

## Record and replay are separate

Recording is an authoring aid that captures candidate UI actions, locator evidence, and optional diagnostics. It produces a draft for review; it does not silently publish a reusable scenario. The author edits the draft into stable semantic locators and explicit assertions, marks inputs, and removes secrets before saving.

Replay executes the scenario selected by the caller. Personal workflows can edit and run it directly; enterprise teams can review changes through their existing pull-request process. It records step outcomes and can attach screenshots/trace data according to the run's artifact policy. A trace is diagnostic evidence, not the executable source of truth. Playwright Trace Viewer can show actions, DOM snapshots, screenshots, console, and network activity; HAR files serve request matching and response fulfillment.

## Network modes

Store the network mode in the scenario and allow a run to override it:

1. **Live**: use the actual destination and its normal network. Mutating website actions may have real effects; the scenario and run request must make this visible. Never retry an uncertain mutation automatically.
2. **Mocked**: replay a selected, reviewed HAR/API fixture for deterministic reads and controlled responses. Prefer minimal fixtures; scrub authorization, cookies, personal data, and unnecessary payloads before saving. Unmatched requests follow an explicit policy (fail by default, or pass through only when the scenario declares that host/path safe).
3. **Hybrid**: mock declared routes and send the rest live. List the route rules and permitted live origins in the scenario/run record; an unlisted route fails instead of silently reaching production.

Network capture remains useful alongside all modes for diagnosis, but Tether's current `network` method only observes captured traffic. Implementing HAR route interception/replay requires a separate Playwright-backed sandbox capability and should not be described as available until built and accepted.

## Credentials, compatibility, and uncertain outcomes

Load secrets at run time from protected configuration or an approved secret provider. Mask secret inputs in step logs, errors, screenshots where practical, and exported traces. Treat browser storage, headers, bodies, URLs, and trace/HAR files as potentially sensitive; keep artifacts local to the configured task storage and support retention/cleanup policy at implementation time.

Version scenario schema and runner compatibility independently. Reject unsupported schema versions with a direct error. Record the Tether runner version, browser version, scenario revision, network mode and fixture revision in run metadata. Use explicit migration for schema changes; do not guess missing fields or silently reinterpret an old scenario. Pin or declare browser/fixture requirements where selector or protocol behavior matters.

Serialize mutating browser operations per page. If an action request times out or the connection drops after dispatch, mark that step `unknown` until an assertion or human review determines the resulting page state. Do not replay the action automatically: it may have submitted a form, created a record, or paid/ sent something. Continue only when a later read-only observation can safely establish state; otherwise stop and preserve the diagnostic evidence. Releasing the session ends Tether authorization but does not roll back site-side effects.

## Isolation and acceptance

Default automated acceptance to disposable browser state and local fixture pages. Each run gets a fresh context/profile, clean storage, and isolated download/output directories; parallel runs must not share a profile, page, or mutable fixture. Reuse of a logged-in persistent profile is an explicit operational mode for a user-requested live task, never the test default. Provide cleanup for run-created state without deleting unrelated `/data` content.

Acceptance should demonstrate: a scenario can be authored from reusable actions and assertions; declared inputs resolve without entering the definition; secret values remain absent from logs/artifacts; the same scenario passes deterministically with a mocked fixture; live and hybrid modes identify every live destination; an unmatched mock request follows policy; a failed assertion points to its step; concurrent runs are isolated; schema incompatibility fails clearly; and an interrupted write is reported as unknown without automatic re-execution. Verify record-to-draft separately from replay execution.

## Implementation sequence

1. Agree the scenario format, minimal action/assertion vocabulary, input-source contract, artifact handling and explicit network mode semantics.
2. Build a read-only runner on local fixture pages using disposable contexts; add step results and assertions.
3. Add named reusable fragments and runtime input resolution, including secret masking.
4. Add recording-to-draft and an edit/save/run path, with existing team code review available where required.
5. Add mocked HAR/API routing and explicit unmatched-request policy; add live/hybrid routing controls after mock behavior is accepted.
6. Add version compatibility, uncertainty state, diagnostic artifact policy, and targeted acceptance for those behaviors.

## References

- [Playwright network mocking](https://playwright.dev/docs/mock) and [BrowserContext `routeFromHAR`](https://playwright.dev/docs/api/class-browsercontext#browser-context-route-from-har): HAR-based request matching and fulfillment.
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer): action timeline, snapshots, screenshots, console, and network diagnostics.
- MinimumWebAuto (`README.md`) and its API reference (`docs/API.md`): existing local authoring/API patterns examined for this design.
