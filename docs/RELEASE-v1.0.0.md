# Tether v1.0.0

[简体中文](RELEASE-v1.0.0.zh-CN.md)

**Release date:** 2026-10-18

## Highlights

- MCP and Native Host share one Broker lifecycle for the same runtime. The extension can manage it in `on`, `off`, or default `auto` mode, with persistent state and a 30-second health probe.
- Broker startup failures set minimum backoff delays of 1, 2, 4, 8, and 16 seconds. The next periodic probe retries when due; five consecutive failures persist the `blocked` state. Chrome may delay the 30-second probes. Switching to manual `on` or `auto` resets the failure count. Native Host reconnects independently with backoff capped at 30 seconds.
- Health checks and stop requests use authenticated HTTPS with certificate pin validation. Tether does not terminate a foreign process or change the configured port.
- The extension package includes a clearly named directory anchor for selecting the unpacked extension.
- The popup CSP allows same-extension JSON language modules to load while keeping external connections blocked.

## Upgrade

Install the v1.0.0 package and reload the browser extension. The extension and runtime should be upgraded together.

Stop the old Broker process before upgrading, then run `node bin/tether.mjs upgrade --home <installation directory>` from the extracted package. Reload the unpacked extension afterward. Version 0.x Brokers do not provide the authenticated lifecycle endpoints; a still-running old Broker will be treated as an occupied port. Keep the matching runtime certificates and pin together.

## Verification

- TypeScript build; 38 installer tests, 61 runtime/extension tests, and 5 Python client tests.
- Fresh tarball installation in an isolated directory on the current Windows host, including dependency installation, certificates, and executable launchers.
- Real upgrade from the published 0.1.1 package; every existing `.local` file retained its SHA-256 hash.
- English/Chinese popup rendering, keyboard focus, preference persistence, and documentation link checks.
- Real Chromium with an isolated profile and Native Messaging registration: actual action popup, default guard, Stop held for 31 seconds, Start then Auto, periodic recovery after Broker shutdown, and authorized requestSession/observe/fill/click/release on a local fixture. The temporary registration and Broker were cleaned up.
