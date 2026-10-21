import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Autostart } from './autostart.js';
import { Wake as W } from './protocol.js';

export interface Probe { capabilities(): Promise<any> }
export type Launch = (exe: string, args: string[]) => Promise<void>;

/** Brings up the Broker and a browser with the extension before a browser call. */
export class BrowserWake {
  private ok = false;
  private failed = 0;
  constructor(private client: Probe, private env: Record<string, string | undefined> = process.env,
    private launch: Launch = BrowserWake.spawn, private start: () => Promise<void> = () => Autostart.run({ env }),
    private budget: number = W.Budget) {}
  static exe(env: Record<string, string | undefined>): string | undefined {
    const order = env[W.Browser] === W.Edge ? [W.Edge, W.Chrome] : [W.Chrome, W.Edge];
    for (const name of order) for (const base of W.Bases) {
      const root = env[base]; if (!root) continue;
      const file = join(root, ...W.Paths[name]); if (existsSync(file)) return file;
    }
    return undefined;
  }
  static spawn(exe: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
    });
  }
  private async caps(): Promise<any> {
    try { return await this.client.capabilities(); }
    catch { await this.start(); return await this.client.capabilities(); }
  }
  async ready(): Promise<void> {
    if (this.ok) return;
    let caps = await this.caps();
    if (caps?.browserConnected) { this.ok = true; return; }
    // Fail fast for a while after a wake that found no extension, instead of waiting on every call.
    if (Date.now() - this.failed < W.Cooldown) throw Error(W.Missing);
    if (this.env[W.Flag] !== W.Off) { const exe = BrowserWake.exe(this.env); if (exe) await this.launch(exe, [W.Arg]).catch(() => {}); }
    const end = Date.now() + this.budget;
    while (Date.now() < end) {
      await new Promise(r => setTimeout(r, W.Step));
      caps = await this.caps().catch(() => caps);
      if (caps?.browserConnected) { this.ok = true; this.failed = 0; return; }
    }
    this.failed = Date.now();
    throw Error(W.Missing);
  }
  lost(): void { this.ok = false; }
}
