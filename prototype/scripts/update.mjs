import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class Update {
  static REPO = 'https://github.com/MindCastlePlayground/Tether.git';
  static BRANCH = 'main';
  static MARKER = '.tether-install.json';
  static LOCK = '.local/update.lock';
  static RESULT = '.local/update-result.json';
  static ENTRY = 'bin/tether.mjs';
  static run(command, args, cwd, capture = false) {
    const result = spawnSync(command, args, { cwd, windowsHide: true, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal})${capture ? `: ${result.stderr?.trim()}` : ''}`);
    return result.stdout?.trim();
  }
  static apply(root, language = 'en', dry = false) {
    root = path.resolve(root);
    if (!fs.existsSync(path.join(root, Update.MARKER))) throw new Error(`Managed installation not found: ${root}`);
    console.log(`Update ${root}\nSource: ${Update.REPO} (${Update.BRANCH})`);
    if (dry) return 0;
    const lock = path.join(root, Update.LOCK);
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Another update is running. If it was interrupted, verify its process has stopped before removing ${lock}.`);
      throw error;
    }
    let temp;
    try {
      fs.writeFileSync(fd, String(process.pid));
      temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-update-'));
      const source = path.join(temp, 'source');
      Update.run('git', ['clone', '--depth', '1', '--single-branch', '--branch', Update.BRANCH, Update.REPO, source], temp);
      const revision = Update.run('git', ['rev-parse', 'HEAD'], source, true);
      const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
      if (!fs.existsSync(npm)) throw new Error('npm CLI not found beside Node. Install a standard Node.js distribution.');
      Update.run(process.execPath, [npm, 'ci', '--no-audit', '--no-fund'], source);
      Update.run(process.execPath, [path.join(source, Update.ENTRY), 'upgrade', '--runtime', root, '--language', language, '--no-open'], source);
      const installed = JSON.parse(fs.readFileSync(path.join(root, Update.MARKER), 'utf8'));
      const expected = JSON.parse(fs.readFileSync(path.join(source, 'prototype/package.json'), 'utf8'));
      if (!installed.ready || installed.version !== expected.version) throw new Error('Updated installation version or ready state did not match the fetched version.');
      fs.writeFileSync(path.join(root, Update.RESULT), `${JSON.stringify({ version: installed.version, revision, source: Update.REPO, updatedAt: new Date().toISOString() }, null, 2)}\n`);
      console.log(`Updated: ${installed.version} (${revision})`);
      return 0;
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
      if (temp) fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  static main() {
    try { process.exitCode = Update.apply(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), process.argv[2] || 'en'); }
    catch (error) { console.error(`Tether: ${error.message}`); process.exitCode = 1; }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) Update.main();
