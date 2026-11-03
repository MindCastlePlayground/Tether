import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

class Paths {
  static App = '/app/prototype';
  static Data = '/data';
  static Local = '/data/.local';
  static Extension = '/app/prototype/extension';
  static Dist = '/app/prototype/dist';
  static Modules = '/app/prototype/node_modules';
  static Cert = '/data/.local/server.pem';
  static Key = '/data/.local/server.key';
  static Wrapper = '/data/.local/native-host';
  static NativeHosts = '/root/.config/chromium/NativeMessagingHosts';
  static NativeManifest = '/root/.config/chromium/NativeMessagingHosts/com.freebird.browser_bridge.json';
  static RuntimeLocation = '/data/extension-location.json';
  static Broker = '/data/.local/broker.json';
  static NativeHostConfig = '/data/.local/host.json';
}

class Values {
  static HostName = 'com.freebird.browser_bridge';
  static ExtensionManifest = 'manifest.json';
  static NativeManifestName = 'com.freebird.browser_bridge.json';
  static Url = 'wss://127.0.0.1:18443/bridge';
  static Port = 18443;
  static CertDays = 3650;
  static Roles = ['host', 'agent', 'script'];
  static BrokerRoles = ['host', 'agent', 'script', 'intruder', 'python'];
  static HostRole = 'host';
  static Description = 'Tether isolated Linux test native host';
  static Shell = '#!/bin/sh\nexec node /app/prototype/dist/host.js /data/.local/host.json "$1"\n';
  static ErrorOpenSSL = 'openssl_certificate_generation_failed';
  static ErrorBootstrap = 'bootstrap_failed';
  static OutputPaths = 'paths';
  static OutputData = 'data';
  static OutputExtension = 'extension';
  static OutputId = 'extensionId';
}

class Fields {
  static Url = 'url';
  static Token = 'token';
  static Ca = 'caFile';
  static Pin = 'pin';
  static ExtensionId = 'extensionId';
  static Port = 'port';
  static Key = 'keyFile';
  static Cert = 'certFile';
  static Tokens = 'tokens';
  static Id = 'id';
  static Path = 'path';
  static Type = 'type';
  static Origins = 'allowed_origins';
  static Name = 'name';
  static Description = 'description';
  static ConfigPath = 'configPath';
  static ExtensionPath = 'extensionPath';
}

export class SandboxBootstrap {
  static mkdir() {
    for (const path of [Paths.Local, Paths.NativeHosts]) mkdirSync(path, { recursive: true });
  }

  static openssl() {
    const args = [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', String(Values.CertDays),
      '-keyout', Paths.Key, '-out', Paths.Cert, '-subj', '/CN=Tether isolated test sandbox',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
      '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign'
    ];
    const result = spawnSync('openssl', args, { stdio: 'ignore' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(Values.ErrorOpenSSL);
    chmodSync(Paths.Key, 0o600);
  }

  static extId() {
    const manifest = JSON.parse(readFileSync(join(Paths.Extension, Values.ExtensionManifest), 'utf8'));
    const der = Buffer.from(manifest.key, 'base64');
    const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
    return [...hex].map(char => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
  }

  static writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }

  static config(role, id, pin, tokens) {
    const cfg = {
      [Fields.Url]: Values.Url,
      [Fields.Token]: tokens[role],
      [Fields.Ca]: Paths.Cert,
      [Fields.Pin]: pin
    };
    if (role === Values.HostRole) cfg[Fields.ExtensionId] = id;
    this.writeJson(join(Paths.Local, `${role}.json`), cfg);
  }

  static wrapper() {
    writeFileSync(Paths.Wrapper, Values.Shell, { mode: 0o755 });
    chmodSync(Paths.Wrapper, 0o755);
  }

  static async run() {
    this.mkdir();
    const id = this.extId();
    if (!existsSync(Paths.Broker)) {
    this.openssl();
    const cert = new X509Certificate(readFileSync(Paths.Cert));
    const publicKey = cert.publicKey.export({ type: 'spki', format: 'der' });
    const pin = createHash('sha256').update(publicKey).digest('base64');
    const tokens = Object.fromEntries(Values.BrokerRoles.map(role => [role, randomBytes(32).toString('base64url')]));
    for (const role of Values.Roles) this.config(role, id, pin, tokens);
    const tokenHashes = Object.fromEntries(Object.entries(tokens).map(([role, token]) =>
      [role, createHash('sha256').update(token).digest('hex')]));
    this.writeJson(Paths.Broker, {
      [Fields.Port]: Values.Port,
      [Fields.Key]: Paths.Key,
      [Fields.Cert]: Paths.Cert,
      [Fields.Tokens]: tokenHashes
    });
    }
    this.writeJson(Paths.RuntimeLocation, { [Fields.Path]: Paths.Extension });
    this.wrapper();
    this.writeJson(Paths.NativeManifest, {
      [Fields.Name]: Values.HostName,
      [Fields.Description]: Values.Description,
      path: Paths.Wrapper,
      type: 'stdio',
      [Fields.Origins]: [`chrome-extension://${id}/`]
    });
    for (const folder of ['/etc/chromium/native-messaging-hosts', '/etc/opt/chrome/native-messaging-hosts', '/etc/opt/chrome_for_testing/native-messaging-hosts']) {
      mkdirSync(folder, { recursive: true });
      copyFileSync(Paths.NativeManifest, join(folder, Values.NativeManifestName));
    }
    process.stdout.write(`${JSON.stringify({
      [Values.OutputPaths]: {
        [Values.OutputData]: Paths.Data,
        [Values.OutputExtension]: Paths.Extension,
        [Fields.ConfigPath]: Paths.NativeManifest
      },
      [Values.OutputId]: id
    })}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  SandboxBootstrap.run().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : Values.ErrorBootstrap}\n`);
    process.exitCode = 1;
  });
}
