import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ServiceKey } from './constants.mjs';

export class Diagnostics {
  static async online(runtime, options, report) {
    const file = path.join(runtime, ServiceKey.AGENT.replaceAll('/', path.sep));
    const clientFile = pathToFileURL(path.join(runtime, 'dist', 'client.js')).href;
    let client;
    report.connection = { configuration: 'pending', tls: 'pending', authentication: 'pending', broker: 'pending', browser: 'pending' };
    try {
      const { BridgeClient, loadConfig } = await import(clientFile);
      const config = await loadConfig(file);
      report.connection.configuration = 'valid';
      client = new BridgeClient(config);
      await client.connect();
      report.connection.tls = 'ok'; report.connection.authentication = 'ok'; report.connection.broker = 'responsive';
      try { report.browser = await client.call('diagnose', {}); report.connection.browser = report.browser.browser; }
      catch (e) { report.connection.browser = 'unavailable'; report.browser = { state: 'unavailable', code: e.code ?? e.message }; }
    } catch (e) {
      const code = e.code ?? e.message;
      report.connection.tls = ['tls_failed','pin_mismatch'].includes(code) ? 'failed' : 'unknown';
      report.connection.authentication = code === 'authentication_failed' ? 'failed' : 'unknown';
      report.connection.broker = ['broker_unavailable','broker_busy'].includes(code) ? code : 'unavailable';
      report.connection.code = code;
      report.valid = false;
    } finally { client?.close(); }
    console.log(JSON.stringify(report, null, 2));
    return report.valid && report.connection?.broker === 'responsive' && report.connection.browser === 'responsive' && report.browser?.versionMatch !== false && report.browser?.policy?.valid !== false ? 0 : 1;
  }
}
