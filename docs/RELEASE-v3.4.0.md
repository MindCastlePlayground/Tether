# Tether 3.4.0

[简体中文](RELEASE-v3.4.0.zh-CN.md) · [Project](../README.md)

## Rollback after an update

- **Problem:** A runtime that could not be used after an upgrade or update had no previous runnable copy to start.
- **Cause:** Upgrade replaced the runtime sources in place, then rebuilt `dist` and `node_modules`. It preserved `.local` and `.venv`, but not the previous program.
- **Solution:** Before replacing a ready runtime, save one runnable copy under `<runtime>/.rollback`, including sources, built files, and installed Node modules. `tether rollback`, or `rollback.cmd` in the runtime directory, swaps that copy back. Run it again to return to the replaced version. An interrupted upgrade does not overwrite the saved copy.
- **Impact:** Only the latest previous version is kept; the next completed upgrade of a ready runtime replaces it. Credentials, certificates, policy, and `.venv` stay in place. The recorded extension folder is overwritten with the restored extension. Rollback does not need a network connection.

The root installer, runtime, extension, and dedicated sandbox versions are aligned at `3.4.0`.

## Validation

2026-11-11: 77 root tests and the bilingual documentation check passed. Upgrade and rollback tests covered one saved copy, a round trip, a failed swap put back in place, an interrupted upgrade, and dry-run.
