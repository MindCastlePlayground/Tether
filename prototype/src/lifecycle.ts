import { spawn } from 'node:child_process';
import { request } from 'node:https';
import { connect } from 'node:net';
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Config } from './config.js';
import { Policy } from './policy.js';
import { Autostart as Opt, Brand, BrokerControl as C, NativeStatus, PolicyKey } from './protocol.js';

export interface BrokerState { mode: string; state: string; attempt: number; retryAt: number; code?: string }
export class BrokerLifecycle {
  private file: string;
  private lock: string;
  private policyPath?: string;
  private policyReader?: Policy;
  constructor(private cfgPath: string) {
    this.file = join(dirname(cfgPath), C.StateFile);
    this.lock = join(dirname(cfgPath), C.Lock);
  }
  state(): BrokerState {
    try {
      const s = Config.load(this.file);
      if (!C.Modes.includes(s.mode) || !Number.isSafeInteger(s.attempt) || s.attempt < 0 || !Number.isFinite(s.retryAt)) throw Error();
      return s;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return { mode: C.Off, state: C.Blocked, attempt: 0, retryAt: 0, code: C.Error };
      return { mode: C.Auto, state: C.Starting, attempt: 0, retryAt: 0 };
    }
  }
  private save(s: BrokerState): BrokerState {
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(s)); renameSync(tmp, this.file); return s;
  }
  private async locked(fn: () => Promise<BrokerState>): Promise<BrokerState> {
    const end=Date.now()+C.LockMs;
    while(true){
      try { mkdirSync(this.lock); break; }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        try { if (Date.now() - statSync(this.lock).mtimeMs > C.LockMs) rmdirSync(this.lock); } catch { /* Another starter owns the lock. */ }
        if(Date.now()>=end)return { ...this.state(), state: C.Starting };
        await BrokerLifecycle.wait(50);
      }
    }
    try { return await fn(); } finally { rmdirSync(this.lock); }
  }
  async set(mode: string): Promise<BrokerState> {
    if (!C.Modes.includes(mode)) throw Error(C.Error);
    // Wait for an in-flight start before applying an explicit user decision.
    const end = Date.now() + C.LockMs;
    while (true) {
      let applied = false;
      const result = await this.locked(async () => {
        applied = true;
        const s = this.save({ mode, state: mode === C.Off ? C.Stopped : C.Starting, attempt: 0, retryAt: 0 });
        if (mode === C.Off && await this.listening()) {
          try { await this.control(C.Stop, true); const end=Date.now()+C.StartMs; while(await this.listening()){if(Date.now()>=end)throw Error(C.Error);await BrokerLifecycle.wait(50);} }
          catch { return this.save({ ...s, state: C.Blocked, code: C.Error }); }
        }
        return s;
      });
      if (applied) return mode === C.Off ? result : this.ensure();
      if (Date.now() >= end) throw Error(C.Error);
      await BrokerLifecycle.wait(100);
    }
  }
  async ensure(): Promise<BrokerState> {
    return this.locked(async () => {
      let s = this.state();
      if (s.mode === C.Off || s.state === C.Blocked || Date.now() < s.retryAt) return s;
      const cfg = Config.load(this.cfgPath);
      const target = new URL(cfg.url);
      const brokerFile = join(dirname(this.cfgPath), Opt.Broker);
      const broker = Config.load(brokerFile);
      if (target.hostname !== Opt.Host || Number(target.port) !== broker.port) return this.fail(s, C.Error);
      // A listening socket alone does not prove that this is our Broker.
      if (await this.listening()) {
        try { await this.control(C.Health); return this.running(s); }
        catch (err) { return this.fail(s, BrokerLifecycle.code(err)); }
      }
      try {
        const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), Opt.Script), brokerFile], { detached: true, stdio: Opt.Ignore, windowsHide: true });
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        child.unref();
        const end = Date.now() + C.StartMs;
        while (Date.now() < end) {
          await BrokerLifecycle.wait(100);
          if (await this.listening()) {
            try { await this.control(C.Health); return this.running(s); }
            catch (err) { return this.fail(s, BrokerLifecycle.code(err)); }
          }
        }
        return this.fail(s, C.Failed);
      } catch { return this.fail(s, C.Failed); }
    });
  }
  async inspect(): Promise<BrokerState> {
    const s = this.state();
    if (s.mode === C.Off) return s;
    try { await this.control(C.Health); return { ...s, state: C.Running, code: undefined }; }
    catch (err) { const code=BrokerLifecycle.code(err); return { ...s, state: C.Stopped, code: code===C.Port?NativeStatus.Offline:code }; }
  }
  policy(): { [key: string]: string | number } | undefined {
    try {
      const broker = Config.load(join(dirname(this.cfgPath), Opt.Broker));
      const file = broker.policyFile ?? join(dirname(this.cfgPath), PolicyKey.File);
      if (!this.policyReader || this.policyPath !== file) { this.policyPath = file; this.policyReader = new Policy(file); }
      const summary = this.policyReader.summary();
      if (!summary.valid) return undefined;
      return { [PolicyKey.Default]: summary.default, [PolicyKey.Rules]: summary.rules };
    } catch { return undefined; }
  }
  private running(s: BrokerState): BrokerState { return this.save({ mode: s.mode, state: C.Running, attempt: 0, retryAt: 0 }); }
  private fail(s: BrokerState, code: string): BrokerState {
    const attempt = s.attempt + 1;
    return this.save({ mode: s.mode, state: attempt >= C.Limit ? C.Blocked : C.Backoff, code, attempt, retryAt: Date.now() + C.Delays[Math.min(attempt - 1, C.Delays.length - 1)] });
  }
  private static code(err: unknown): string {
    const e = err as NodeJS.ErrnoException;
    if(e.message===NativeStatus.Auth)return NativeStatus.Auth;
    return NativeStatus.TLSCodes.has(e.code ?? '') || e.message === NativeStatus.Pin ? NativeStatus.TLS : C.Port;
  }
  private listening(): Promise<boolean> {
    const url = new URL(Config.load(this.cfgPath).url);
    return new Promise(ok => {
      const sock = connect(Number(url.port), url.hostname);
      const end = (up: boolean) => { sock.destroy(); ok(up); };
      sock.setTimeout(C.ProbeMs, () => end(false)); sock.once('connect', () => end(true)); sock.once('error', () => end(false));
    });
  }
  private control(path: string, host = false): Promise<void> {
    const cfg = Config.load(host ? join(dirname(this.cfgPath), C.HostFile) : this.cfgPath);
    const url = new URL(cfg.url); url.protocol=C.Https; url.pathname = path;
    return new Promise((resolve, reject) => {
      const req = request(url, { ...Config.tls(cfg), method: host ? C.Post : C.Get }, res => {
        let body = '';
        res.on('data', data => { body += data; if (body.length > C.ReadLimit) req.destroy(Error(C.Port)); });
        res.on('end', () => {
          try { if(res.statusCode===403)throw Error(NativeStatus.Auth); if (res.statusCode !== 200 || JSON.parse(body).name !== Brand.Name) throw Error(C.Port); resolve(); }
          catch (err) { reject(err); }
        });
        res.on('error', reject);
      });
      const timer=setTimeout(()=>req.destroy(Error(C.Port)),C.ProbeMs);
      req.once('close',()=>clearTimeout(timer)); req.on('error', reject); req.end();
    });
  }
  private static wait(ms: number): Promise<void> { return new Promise(done => setTimeout(done, ms)); }
}
