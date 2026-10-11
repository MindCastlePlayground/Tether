# Tether branding verification

[简体中文](branding-verification.zh-CN.md) · [Brand assets](README.md)

Date: 2026-10-11.

This is the historical branding verification record. The documentation internationalization changes do not add new test evidence.

- TypeScript build: passed (`npm run build`).
- Extension behavior: 18 existing FakeChrome simulation tests passed (`node --test --test-reporter=dot test/extension.test.mjs`).
- Python setup script: AST syntax check passed; setup was not executed.
- Logo: transparent 1254 × 1254 PNG master, plus 256px documentation export and 16/32/48/128px extension exports.
- Popup: isolated headless Chrome rendered the real popup source with a mocked extension runtime. Logo loading, viewport overflow, toggle message/response, keyboard focus, and absence of page errors passed. See `popup-preview.png` and `preview-verification.json`.
- Documentation: five Markdown documents checked, with 30 local document/image references resolving and valid JSON configuration examples. English prototype guide has no duplicated Chinese body.
- No real browser extension was reloaded or controlled in this pass. Native Host and Broker were not launched. Existing runtime and browser acceptance records remain in `../prototype/VERIFICATION.md` and are separate from this branding check.

Generation used the built-in imagegen tool; the prompt is recorded in `README.md` in this directory. PNG size exports use the same master artwork. Public branding is Tether; the internal Native Messaging identifier is retained for registration compatibility.
