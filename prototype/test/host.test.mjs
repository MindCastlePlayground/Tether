import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:https';
import { createServer as tcpServer } from 'node:net';
import { WebSocketServer } from 'ws';
import { NativeStatus as Status } from '../dist/protocol.js';

class HostProbe {
  static cfg = JSON.parse(readFileSync('.local/host.json', 'utf8'));
  constructor(cfg = HostProbe.cfg, origin = cfg.extensionId) {
    mkdirSync('work', { recursive: true });
    this.dir = mkdtempSync(resolve('work/host-test-'));
    const file = join(this.dir, 'host.json');
    writeFileSync(file, JSON.stringify(cfg));
    this.child = spawn(process.execPath, ['dist/host.js', file, `chrome-extension://${origin}/`], { stdio: 'pipe', windowsHide: true });
    this.exit = once(this.child, 'close');
    this.raw = Buffer.alloc(0);
    this.frames = [];
    this.stderr = '';
    this.child.stderr.on('data', data => { this.stderr += data; });
    this.child.stdout.on('data', data => {
      this.raw = Buffer.concat([this.raw, data]);
      while (this.raw.length >= 4 && this.raw.length >= this.raw.readUInt32LE() + 4) {
        const size = this.raw.readUInt32LE();
        this.frames.push(JSON.parse(this.raw.subarray(4, size + 4)));
        this.raw = this.raw.subarray(size + 4);
      }
    });
  }
  async done(code) {
    assert.equal((await this.exit)[0], 1);
    assert.equal(this.frames.at(-1).code, code);
    assert.equal(this.frames.at(-1).type, Status.Type);
    assert.equal(this.raw.length, 0);
    assert.equal(this.stderr.trim(), code);
    assert.ok(!this.stderr.includes(HostProbe.cfg.token));
  }
  async close() {
    if (this.child.exitCode === null) this.child.kill();
    await this.exit;
    rmSync(this.dir, { recursive: true, force: true });
  }
  static async server(t, handler) {
    const cfg = JSON.parse(readFileSync('.local/broker.json', 'utf8'));
    const server = createServer({ key: readFileSync(cfg.keyFile), cert: readFileSync(cfg.certFile) }, handler);
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise(done => server.close(done)));
    return { server, cfg: { ...HostProbe.cfg, url: `wss://127.0.0.1:${server.address().port}/bridge` } };
  }
}

test('native origin mismatch sends a framed diagnosis before nonzero exit', { timeout: 10000 }, async t => {
  const probe = new HostProbe(undefined, 'invalid');
  t.after(() => probe.close());
  await probe.done(Status.Origin);
});

test('invalid native config sends a safe framed diagnosis', { timeout: 10000 }, async t => {
  const probe = new HostProbe({ ...HostProbe.cfg, caFile: 'missing-certificate.pem' });
  t.after(() => probe.close());
  await probe.done(Status.Config);
});

test('stopped broker reports unavailable instead of silent exit', { timeout: 10000 }, async t => {
  const socket = tcpServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const probe = new HostProbe({ ...HostProbe.cfg, url: `wss://127.0.0.1:${port}/bridge` });
  t.after(() => probe.close());
  await probe.done(Status.Offline);
});

test('TLS pin mismatch reports validation failure', { timeout: 10000 }, async t => {
  const { cfg } = await HostProbe.server(t);
  const probe = new HostProbe({ ...cfg, pin: 'invalid' });
  t.after(() => probe.close());
  await probe.done(Status.TLS);
});

test('rejected handshake reports broker authentication failure', { timeout: 10000 }, async t => {
  const { cfg } = await HostProbe.server(t, (_req, res) => { res.writeHead(401); res.end(); });
  const probe = new HostProbe(cfg);
  t.after(() => probe.close());
  await probe.done(Status.Auth);
});

test('native transport preserves fragmented frames and exits cleanly on stdin EOF', { timeout: 10000 }, async t => {
  const { server, cfg } = await HostProbe.server(t);
  const wss = new WebSocketServer({ server });
  const connected = once(wss, 'connection');
  const probe = new HostProbe(cfg);
  t.after(() => probe.close());
  const [ws] = await connected;
  const reply = once(ws, 'message');
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'probe', result: { ok: true } }));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  probe.child.stdin.write(header.subarray(0, 2));
  probe.child.stdin.write(Buffer.concat([header.subarray(2), body]));
  assert.deepEqual(JSON.parse((await reply)[0]), JSON.parse(body));
  probe.child.stdin.end();
  assert.equal((await probe.exit)[0], 0);
  assert.equal(probe.frames[0].state, Status.Connected);
  assert.equal(probe.stderr, '');
  wss.close();
});
