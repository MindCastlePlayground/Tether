import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { Paths, Wire } from './constants.mjs';

class Proxy {
  static async main() {
    const token = (await readFile(Paths.Token, 'utf8')).trim();
    const lines = createInterface({ input: process.stdin });
    for await (const line of lines) {
      const response = await fetch(Wire.Url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: line,
      });
      if (!response.ok) throw Error(`sandbox_http_${response.status}`);
      const body = await response.text();
      if (body) process.stdout.write(`${body}\n`);
    }
  }
}
Proxy.main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
