# Development and releases

[简体中文](DEVELOPMENT.zh-CN.md) · [Project](../README.md)

- `main` contains the current release source, installer, documentation and reproducible tests.
- `dev` is the integration branch for the next release. Merge verified changes into `main` when ready to release.
- Both branches are public. Credentials, local runtime state, raw evidence, screenshots from debugging, and temporary installations stay in ignored local directories.
- The npm `files` allowlist defines the installable package. Tests and development scripts remain in Git but are excluded from the installation package.

`prototype/` is the historical name of the active runtime source directory. The installer copies and builds it; it is required for release. Keep this path until an explicit migration updates installer references and existing workflows.

Before merging, run `npm test` and `npm run docs:check` at the root. For runtime changes, also build and test in `prototype/`. Validate installation changes using an isolated home and project. Use `--no-register --no-open` when the verification should leave the current browser registration unchanged.
