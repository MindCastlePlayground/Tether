# Tether 3.3.0

[简体中文](RELEASE-v3.3.0.zh-CN.md) · [Project](../README.md)

## Operation trace and presets

- **Problem:** Browser actions could not be saved as a reusable preset or exported as a script that runs without Tether.
- **Cause:** `records` stores only operation metadata. There was no step trace, no saved preset, and no compiler from those steps to a Playwright script.
- **Solution:** Record `navigate`, `click`, `fill`, `wait`, and `assert`, including filled values. `preset` saves, reads, lists, deletes, exports, and reruns those steps. Export emits a Playwright script that runs on its own. A Tether rerun stops at a refused, uncertain, or failed step and does not retry it.
- **Impact:** Traces and presets stay in memory for the credential and clear when Broker restarts. The exported file is the durable copy. `records` still omits page content and parameters. Filled values stay plaintext because these are test environments.

## Captured HTTP export

- **Problem:** Network inspection could list and page a response, but not hand the captured exchanges to the agent as HTTP text.
- **Cause:** Capture supported `start`, `list`, `detail`, `body`, `stop`, and `clear` only.
- **Solution:** Add `network` `op: http`. It writes the requests and responses already in the capture buffer as `.http` text, including bodies. The agent reorganizes that text afterward.
- **Impact:** Static, analytics, and application calls are all included. Nothing is captured until `start`. An empty buffer exports empty text. The export does not invent calls or compile a request flow.

The root installer, runtime, extension, and dedicated sandbox versions are aligned at `3.3.0`.

## Validation

2026-11-11: 71 root tests and the bilingual documentation check passed. Preset, network, i18n, and support tests passed. A full runtime run the same day passed 133 tests; 10 failed opening `.local/broker.json` with `EACCES` in this environment.
