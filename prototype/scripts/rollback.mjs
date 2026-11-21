import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// One previous runnable runtime, kept beside the live files. `.local` and `.venv` stay put.
export class Rollback {
  static DIR = '.rollback';
  static NEXT = '.rollback-next';
  static PREV = '.rollback-prev';
  static HOLD = '.rollback-hold';
  static META = 'meta.json';
  static TREE = 'tree';
  static SCRIPT = 'rollback.mjs';
  static MARKER = '.tether-install.json';
  static LOCATION = 'extension-location.json';
  static STATE = '.local/broker-state.json';
  static SOURCE = ['package.json', 'tsconfig.json', 'src', 'extension', 'python', 'scripts/setup.py', 'scripts/certificate.py', 'scripts/locales.mjs', 'scripts/launchers.ps1', 'scripts/register.ps1', 'scripts/update.mjs', 'scripts/rollback.mjs', 'update.cmd', 'README.md', 'README.zh-CN.md', 'VERIFICATION.md', 'VERIFICATION.zh-CN.md'];
  static EXTRA = ['dist', 'node_modules'];
  static SKIP = new Set([Rollback.DIR, Rollback.NEXT, Rollback.PREV, Rollback.HOLD, '.local']);
  static MODES = ['auto', 'on', 'off'];
  static HALT = String.raw`$r=[regex]::Escape($env:TETHER_ROOT); Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match ($r + '\\dist\\(broker|host)\.js') } | ForEach-Object { $b = $_.CommandLine -match 'broker\.js'; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; if ($b) { 'broker' } }`;
  static RESUME = "const {pathToFileURL}=await import('node:url');const m=await import(pathToFileURL(process.env.TETHER_ROOT+'/dist/lifecycle.js').href);const s=await new m.BrokerLifecycle(process.env.TETHER_CONFIG).ensure();process.stdout.write(JSON.stringify(s));";

  static paths() { return [...Rollback.SOURCE, ...Rollback.EXTRA]; }
  static slot(root) { return path.join(root, Rollback.DIR); }
  static shell() { return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
  static read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  static write(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
    fs.renameSync(temp, file);
  }
  static copy(from, to) {
    fs.cpSync(from, to, { recursive: true, force: true, filter: src => !Rollback.SKIP.has(path.basename(src)) });
  }
  static command(root) {
    const text = '@echo off\r\nnode "%~dp0.rollback\\rollback.mjs" zh-CN\r\nset "TETHER_ROLLBACK_EXIT=%ERRORLEVEL%"\r\nif not "%TETHER_ROLLBACK_EXIT%"=="0" echo Rollback failed. See the error above.\r\npause\r\nexit /b %TETHER_ROLLBACK_EXIT%\r\n';
    const file = path.join(root, 'rollback.cmd');
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
    fs.writeFileSync(file, text);
  }
  // Copy the ready runtime into the single slot. Caller skips this when resuming an interrupted upgrade.
  static keep(root, version) {
    if (!version) throw new Error('Rollback requires the current version.');
    const staging = path.join(root, Rollback.NEXT);
    fs.rmSync(staging, { recursive: true, force: true });
    const tree = path.join(staging, Rollback.TREE);
    fs.mkdirSync(tree, { recursive: true });
    for (const name of Rollback.paths()) {
      const from = path.join(root, name);
      if (!fs.existsSync(from)) continue;
      const dest = path.join(tree, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      Rollback.copy(from, dest);
    }
    fs.copyFileSync(fileURLToPath(import.meta.url), path.join(staging, Rollback.SCRIPT));
    Rollback.write(path.join(staging, Rollback.META), { version, keptAt: new Date().toISOString() });
    Rollback.command(root);
    const slot = Rollback.slot(root);
    const prev = path.join(root, Rollback.PREV);
    fs.rmSync(prev, { recursive: true, force: true });
    if (fs.existsSync(slot)) fs.renameSync(slot, prev);
    fs.renameSync(staging, slot);
    fs.rmSync(prev, { recursive: true, force: true });
    return version;
  }
  static relocate(from, to, undo) {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    undo.push([to, from]);
  }
  static undo(undo) {
    for (const [at, origin] of undo.reverse()) {
      if (!fs.existsSync(at) || fs.existsSync(origin)) continue;
      fs.mkdirSync(path.dirname(origin), { recursive: true });
      fs.renameSync(at, origin);
    }
  }
  static extension(root) {
    const file = path.join(root, Rollback.LOCATION);
    if (!fs.existsSync(file)) return;
    let dest;
    try { dest = Rollback.read(file).path; } catch { return; }
    if (!dest) return;
    const target = path.resolve(dest);
    const source = path.resolve(root, 'extension');
    if (target.toLowerCase() === source.toLowerCase() || !fs.existsSync(source)) return;
    fs.cpSync(source, target, { recursive: true, force: true });
  }
  // Exchange the live runnable files with the saved copy. Running it again returns to the replaced version.
  static exchange(root) {
    const slot = Rollback.slot(root);
    const metaFile = path.join(slot, Rollback.META);
    if (!fs.existsSync(metaFile)) throw new Error(`No rollback version is saved for ${root}.`);
    const meta = Rollback.read(metaFile);
    const markerFile = path.join(root, Rollback.MARKER);
    const marker = fs.existsSync(markerFile) ? Rollback.read(markerFile) : {};
    const held = path.join(root, Rollback.HOLD);
    fs.rmSync(held, { recursive: true, force: true });
    fs.mkdirSync(held, { recursive: true });
    const undo = [];
    try {
      for (const name of Rollback.paths()) {
        const live = path.join(root, name);
        const kept = path.join(slot, Rollback.TREE, name);
        const park = path.join(held, name);
        Rollback.relocate(live, park, undo);
        Rollback.relocate(kept, live, undo);
        Rollback.relocate(park, kept, undo);
      }
      Rollback.extension(root);
      Rollback.write(metaFile, { version: marker.version, keptAt: new Date().toISOString() });
      Rollback.write(markerFile, { version: meta.version, ready: true });
      fs.rmSync(held, { recursive: true, force: true });
      return { version: meta.version, replaced: marker.version };
    } catch (error) {
      try { Rollback.undo(undo); } catch (undoError) { error.message = `${error.message}\nRollback could not put the files back: ${undoError.message}`; throw error; }
      fs.rmSync(held, { recursive: true, force: true });
      error.message = `${error.message}\nRollback did not finish; the runtime files were put back.`;
      throw error;
    }
  }
  static pause(root) {
    const file = path.join(root, Rollback.STATE);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    Rollback.write(file, { mode: 'off', state: 'stopped', attempt: 0, retryAt: 0 });
    return before;
  }
  static unpause(root, before) {
    const file = path.join(root, Rollback.STATE);
    let mode;
    try { mode = JSON.parse(before).mode; } catch { /* Missing or corrupt state falls back to auto. */ }
    if (!Rollback.MODES.includes(mode)) { fs.rmSync(file, { force: true }); return true; }
    Rollback.write(file, { mode, state: mode === 'off' ? 'stopped' : 'starting', attempt: 0, retryAt: 0 });
    return mode !== 'off';
  }
  static halt(root) {
    if (process.platform !== 'win32') return false;
    const result = spawnSync(Rollback.shell(), ['-NoProfile', '-NonInteractive', '-Command', Rollback.HALT], { env: { ...process.env, TETHER_ROOT: path.resolve(root) }, encoding: 'utf8', windowsHide: true });
    return result.status === 0 && result.stdout.split(/\r?\n/).some(line => line.trim() === 'broker');
  }
  static resume(root) {
    const config = path.join(root, '.local', 'agent.json');
    if (!fs.existsSync(path.join(root, 'dist', 'lifecycle.js')) || !fs.existsSync(config)) return;
    spawnSync(process.execPath, ['--input-type=module', '-e', Rollback.RESUME], { cwd: root, env: { ...process.env, TETHER_ROOT: path.resolve(root), TETHER_CONFIG: config }, windowsHide: true, timeout: 30000 });
  }
  static restore(root, language = 'en') {
    root = path.resolve(root);
    const markerFile = path.join(root, Rollback.MARKER);
    const marker = fs.existsSync(markerFile) ? Rollback.read(markerFile) : {};
    const interrupted = marker.ready === false && marker.upgrade === true;
    const prior = interrupted ? marker.paused ?? null : Rollback.pause(root);
    const stopped = Rollback.halt(root);
    const result = Rollback.exchange(root);
    const auto = Rollback.unpause(root, prior);
    if (auto && (stopped || (interrupted && marker.running))) Rollback.resume(root);
    const zh = language === 'zh-CN';
    console.log(zh
      ? `已回退到 ${result.version}。被换下的 ${result.replaced ?? '当前版本'} 仍保留，再执行一次回退可回到该版本。`
      : `Rolled back to ${result.version}. ${result.replaced ?? 'The replaced version'} is kept; run rollback again to return to it.`);
    return result;
  }
  static rootFrom(script) {
    const dir = path.dirname(script);
    return path.basename(dir) === Rollback.DIR ? path.dirname(dir) : path.resolve(dir, '..');
  }
  static main() {
    try { Rollback.restore(Rollback.rootFrom(fileURLToPath(import.meta.url)), process.argv[2] || 'en'); }
    catch (error) { console.error(`Tether: ${error.message}`); process.exitCode = 1; }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) Rollback.main();
