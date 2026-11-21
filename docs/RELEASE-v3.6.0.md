# Tether 3.6.0

[简体中文](RELEASE-v3.6.0.zh-CN.md) · [Project](../README.md)

- Each default installation generates its own loopback certificate. The Broker renews an expired certificate at startup or on a new connection, preserving the private key and pin. Existing connections can continue.
- Upgrading enrolls eligible Tether-generated loopback certificates, including expired ones. Administrators continue to manage LAN and custom certificates.
- Fresh installs can opt in to `--no-certificate` for plaintext connections on `127.0.0.1` with token authentication. See the [installation guide](INSTALL.md) for migration steps.
