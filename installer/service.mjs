import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ServiceKey as S } from './constants.mjs';

// Running Broker/host processes keep old code in memory, so an upgrade must restart them.
export class Service {
  static shell() { return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
  static halt(root) {
    if (process.platform !== 'win32') return false;
    const env = { ...process.env, [S.ENV]: path.resolve(root) };
    const result = spawnSync(Service.shell(), ['-NoProfile', '-NonInteractive', '-Command', S.HALT], { env, encoding: 'utf8', windowsHide: true });
    return result.status === 0 && result.stdout.split(/\r?\n/).some(line => line.trim() === 'broker');
  }
  static resume(root) {
    const config = path.join(root, S.AGENT);
    if (!fs.existsSync(path.join(root, S.LIFECYCLE)) || !fs.existsSync(config)) return undefined;
    const env = { ...process.env, [S.ENV]: path.resolve(root), [S.CONFIG]: config };
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', S.RESUME], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    try { return JSON.parse(result.stdout).state; } catch { return undefined; }
  }
}
