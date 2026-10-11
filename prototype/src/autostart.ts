import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Autostart as Opt } from './protocol.js';

type Spawn = (bin: string, args: string[], opt: { detached: boolean; stdio: typeof Opt.Ignore; windowsHide: boolean }) => { unref(): void };
type Io = { spawn?: Spawn; probe?: (port: number) => Promise<boolean>; env?: Record<string, string | undefined>; read?: (path: string) => string; wait?: (ms: number) => Promise<void>; write?: (line: string) => void; now?: () => number; here?: string };

export class Autostart {
  static async run(io: Io = {}): Promise<void> {
    try { await Autostart.go(io); } catch { /* mcp still starts */ }
  }

  private static async go(io: Io): Promise<void> {
    const env = io.env ?? process.env;
    if (env[Opt.Flag] === Opt.Off) return;
    const cfg = env[Opt.Client];
    if (!cfg) return;
    const read = io.read ?? ((file: string) => readFileSync(file, 'utf8'));
    const broker = join(dirname(cfg), Opt.Broker);
    const port = JSON.parse(read(broker).replace(/^\uFEFF/, ''))[Opt.Port];
    if (!Number.isInteger(port) || port < 1 || port > Opt.Max) return;
    const probe = io.probe ?? ((n: number) => Autostart.tcp(n));
    if (await probe(port)) return;
    const here = io.here ?? dirname(fileURLToPath(import.meta.url));
    const opt = { detached: true, stdio: Opt.Ignore, windowsHide: true };
    (io.spawn ?? ((bin, args, o) => Autostart.child(bin, args, o)))(process.execPath, [join(here, Opt.Script), broker], opt).unref();
    const wait = io.wait ?? ((ms: number) => new Promise<void>(done => setTimeout(done, ms)));
    const now = io.now ?? (() => Date.now());
    const write = io.write ?? ((line: string) => process.stderr.write(line));
    const t0 = now();
    while (now() - t0 < Opt.Budget) {
      await wait(Opt.Step);
      if (await probe(port)) return;
    }
    write(Opt.Timeout);
  }

  private static child(...[bin, args, opt]: Parameters<Spawn>) {
    return spawn(bin, args, opt);
  }

  private static tcp(port: number): Promise<boolean> {
    return new Promise(ok => {
      let done = false;
      const socket = connect(port, Opt.Host);
      const end = (up: boolean) => { if (done) return; done = true; socket.destroy(); ok(up); };
      socket.setTimeout(Opt.Step, () => end(false));
      socket.once('connect', () => end(true));
      socket.once('error', () => end(false));
    });
  }
}
