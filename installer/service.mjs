import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ServiceKey as S } from './constants.mjs';
import { Files } from './files.mjs';

// Running Broker/host processes keep old code in memory, so an upgrade must restart them.
export class Service {
  static shell() { return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
  static ps(root, script) {
    const env = { ...process.env, [S.ENV]: path.resolve(root) };
    const result = spawnSync(Service.shell(), ['-NoProfile', '-NonInteractive', '-Command', script], { env, encoding: 'utf8', windowsHide: true });
    return result.status === 0 ? result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
  }
  // Counts of this runtime's running processes by role: { broker, host, mcp }.
  static scan(root) {
    const counts = Object.fromEntries(S.ROLES.map(role => [role, 0]));
    if (process.platform !== 'win32' || !fs.existsSync(root)) return counts;
    for (const role of Service.ps(root, S.SCAN)) if (role in counts) counts[role]++;
    return counts;
  }
  static halt(root) {
    if (process.platform !== 'win32') return false;
    return Service.ps(root, S.HALT).includes(S.BROKER);
  }
  // Turn Broker auto-start off so an MCP or host cannot start half-built code; returns the previous state text.
  static pause(root) {
    const file = path.join(root, S.STATE);
    const before = fs.existsSync(file) ? Files.read(file) : null;
    Service.save(file, { mode: S.OFF, state: S.STOPPED, attempt: 0, retryAt: 0 });
    return before;
  }
  // Put back the user's mode with a clean retry budget; no saved file means the default (auto).
  // Returns whether auto-start is enabled afterwards.
  static restore(root, before) {
    const file = path.join(root, S.STATE);
    let mode;
    try { mode = JSON.parse(before).mode; } catch { /* Missing or corrupt: fall back to the default. */ }
    if (!S.MODES.includes(mode)) { fs.rmSync(file, { force: true }); return true; }
    Service.save(file, { mode, state: mode === S.OFF ? S.STOPPED : S.STARTING, attempt: 0, retryAt: 0 });
    return mode !== S.OFF;
  }
  static save(file, state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state));
    fs.renameSync(temp, file);
  }
  static resume(root) {
    const config = path.join(root, S.AGENT);
    if (!fs.existsSync(path.join(root, S.LIFECYCLE)) || !fs.existsSync(config)) return undefined;
    const env = { ...process.env, [S.ENV]: path.resolve(root), [S.CONFIG]: config };
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', S.RESUME], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    try { return JSON.parse(result.stdout).state; } catch { return undefined; }
  }
}
