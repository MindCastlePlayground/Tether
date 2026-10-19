import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Install } from './constants.mjs';

export class Browser {
  static plan(name, runtime, env = process.env, extensionDir) {
    if (!Install.BROWSERS.includes(name)) throw new Error(`Unsupported browser: ${name}`);
    const folder = extensionDir || path.join(runtime, 'extension');
    const url = name === 'chrome' ? 'chrome://extensions/' : 'edge://extensions/';
    const parts = name === 'chrome' ? ['Google', 'Chrome', 'Application', 'chrome.exe'] : ['Microsoft', 'Edge', 'Application', 'msedge.exe'];
    const exe = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean).map(base => path.join(base, ...parts)).find(file => fs.existsSync(file));
    return { browser: name, url, folder, exe };
  }
  static async open(plan) {
    if (!plan.exe) throw new Error(`Browser executable not found. Open ${plan.url} manually and load ${plan.folder}`);
    const launch = (exe, args) => new Promise((resolve, reject) => {
      const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    await launch(plan.exe, [plan.url]);
    await launch(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [plan.folder]);
  }
}
