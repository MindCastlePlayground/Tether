# Tether usability improvements: implementation and automated acceptance

[简体中文](USABILITY-VERIFICATION.zh-CN.md)

2026-10-27. All three batches are implemented in **1.3.0**, and the local installation has been upgraded automatically. Both the source checkout and installed runtime passed the real extension and MCP acceptance flow.

## Changes for users

- **Browse an outline, then expand a region**: `snapshot({…,outline:true})` returns an outline. Pass one of its refs to `snapshot({…,scopeRef})` to inspect that region. Choose either `scope` or `scopeRef`.
- **Distinguish identical controls**: `locate` includes the surrounding row, list item or region, plus an actionable ref. `count` is the total number of matches, `shown` is the returned count, and `truncated` indicates omitted candidates. At most 10 candidates are shown.
- **Keep selector constraints when acting**: only local rewrites that preserve scope remain. For bare text, use `locate({…,text})` and act with its returned ref, or use an explicit `text=…` selector.
- **References follow actual elements**: repeated snapshots, renaming and same-document routing preserve the ref of a surviving element. Navigation or replacement makes the old ref return `ref_stale`; a same-name replacement is never substituted. Each document retains at most 4096 recent references.
- **Observe after an action**: add `observe:{maxChars:6000}` to `click` or `fill`. The response includes URL, title, navigation status, a compact tree and truncation status. These are page facts, not a claim of business success.
- **Filled values are not echoed in results**: post-action observations redact field values. Fill results retain structural target metadata such as ref, role and tag, omitting text descriptions to avoid leaking existing long or escaped values. Calling ordinary `snapshot` directly still reads page content.

## Automated acceptance results

| Check | Result |
|---|---|
| TypeScript build | Passed |
| Installer and root tests | 58 passed |
| Full runtime regression | 117 passed |
| Final locator regression | 27 passed, including the subsequently added existing-textarea-value redaction test; overlaps the full suite |
| Final redaction regression | 8 passed, covering existing long values and post-action observation; overlaps the suites above |
| Source end-to-end acceptance | SDK and real MCP stdio both operated pages through Broker, Native Host and the extension |
| Installed end-to-end acceptance | Repeated the same flow using installed runtime code; passed |
| Installed files | 8 relevant source files match the checkout; install marker is ready; Native Host registration points to the installation |
| Automatic cleanup | Test-only Native Host registration removed |

Coverage includes constrained misses, ambiguity beyond the first 20 matches, refusal after incomplete checks, same-name replacement, cross-document navigation, outline expansion, candidate context and counts, candidate ref actions, observation failures and timeouts without repeating writes, preservation of `outcome_unknown`, read-policy enforcement for observations, and fill redaction.

## Avoiding manual installation

The existing managed installation at `C:\Users\74756\AppData\Local\Tether\runtime` was reused. The installer updated source, dependencies, build outputs and extension files in place without regenerating credentials. File hashes of the three connection configurations matched before and after the first upgrade.

The pre-upgrade code backup is at `C:\Users\74756\AppData\Local\Tether\backups\usability-20261027-012945`. Keep the current `.local` configuration when restoring code and built files from that backup.

End-to-end tests discover an installed Playwright Chromium / Chrome for Testing, create an isolated headless browser profile, and load the test extension and temporary Native Host automatically. No extension-manager interaction or manual loading in the daily browser is needed.

Acceptance used an isolated browser and local fixture pages; it does not establish that every site in the daily browser has been tested. The installation retains its existing extension directory and idle auto-reload mechanism. An already running older MCP process must reconnect to load updated tool definitions.

## Reproduction and evidence

Run these commands from the repository root to test the checkout or an installed runtime. The target runtime must already have `.local` configuration, and Chromium must support automated extension loading.

```powershell
node prototype/scripts/locator-e2e.mjs
$env:TETHER_QA_RUNTIME = "$env:LOCALAPPDATA/Tether/runtime"
node prototype/scripts/locator-e2e.mjs
```

Records are under `outputs/usability-implementation/`: `runtime-tests-final.log`, `locator-tests-final.log`, `root-tests.log`, `extension-e2e-final.log`, `installed-result.json`, `installed-check.json` and `upgrade-result.json`.

Implementation fixed selector registration differences between real CDP connections and ordinary browser tests. That adaptation was verified with the pinned `playwright-core 1.64.0`; rerun the real extension test when upgrading it.

See the original [usability plan](USABILITY-PLAN.md) for decisions and tradeoffs.
