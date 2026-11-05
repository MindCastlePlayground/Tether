# Development and releases

[简体中文](DEVELOPMENT.zh-CN.md) · [Project](../README.md)

- `main` contains the current release source, installer, documentation and reproducible tests.
- `dev` is the integration branch for the next release. Merge verified changes into `main` when ready to release.
- Both branches are public. Credentials, local runtime state, raw evidence, screenshots from debugging, and temporary installations stay in ignored local directories.
- The npm `files` allowlist defines the installable package. Tests and development scripts remain in Git but are excluded from the installation package.

`prototype/` is the historical name of the active runtime source directory. The installer copies and builds it; it is required for release. Keep this path until an explicit migration updates installer references and existing workflows.

Release versions follow `a.b.c`: `a` changes for major features or breaking updates and requires coordinated updates to companion components; `b` changes for features; `c` changes for fixes. The current patch release is `3.0.2`; keep the root installer and `prototype/` package versions aligned. Playwright is pinned to 1.64.0 for compatibility with the current integration. Dependencies use compatible same-major ranges, and installs use `npm install --package-lock=false` so npm inherits the user's configured registry and enterprise settings. Do not commit either package lock file.

Before merging, run `npm test` and `npm run docs:check` at the root. For runtime changes, also run `npm run build` and `npm test` in `prototype/`; install dependencies with `npm install --package-lock=false` when needed. Validate installation changes using an isolated home and project. Use `--no-register --no-open` when the verification should leave the current browser registration unchanged.
