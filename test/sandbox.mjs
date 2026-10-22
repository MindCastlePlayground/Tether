import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Imported first by every test file: user-scope installs and default homes must never reach the real profile.
export class Sandbox {
  static ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-home-'));
  static VARS = ['USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA'];
  static UNSET = ['CODEX_HOME', 'XDG_CONFIG_HOME'];
  static apply() {
    for (const name of Sandbox.VARS) process.env[name] = path.join(Sandbox.ROOT, name);
    for (const name of Sandbox.UNSET) delete process.env[name];
    for (const name of Sandbox.VARS) fs.mkdirSync(process.env[name], { recursive: true });
    if (path.resolve(os.homedir()) !== path.resolve(process.env.USERPROFILE)) throw new Error('Test sandbox failed to redirect the home directory');
  }
}
Sandbox.apply();
