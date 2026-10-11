import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Files } from './files.mjs';
import { Hint, Install } from './constants.mjs';

export class Runtime {
  static shell() { return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
  static run(command, args, cwd, env = process.env) {
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${path.basename(command)}`);
  }
  static ps(script, cwd, env = process.env) { Runtime.run(Runtime.shell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], cwd, env); }
  static npm(args, cwd) {
    // npm.cmd cannot be spawned directly without a shell on Windows. Invoke the sibling JS CLI.
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(cli)) throw new Error('npm CLI not found beside Node. Install a standard Node.js distribution.');
    Runtime.run(process.execPath, [cli, ...args], cwd);
  }
  static check(root) {
    const missing = Install.REQUIRED.filter(name => !fs.existsSync(path.join(root, name)));
    if (missing.length) throw new Error(`Incomplete runtime at ${root}: ${missing.join(', ')}`);
    const native = Files.json(path.join(root, '.local', 'native-host.json'));
    if (path.resolve(native.path).toLowerCase() !== path.join(root, '.local', 'host.exe').toLowerCase()) throw new Error('Native host points to another runtime; regenerate its launchers/configuration before use.');
  }
  static prepare(root, source, options) {
    if (options.runtime) { Runtime.check(root); return; }
    const marker = path.join(root, Install.MARKER);
    if (fs.existsSync(root)) {
      if (!fs.existsSync(marker)) throw new Error(`Runtime directory already exists: ${root}. Use --runtime for a configured checkout, or choose a new --home.`);
      const meta = Files.json(marker);
      if (meta.version !== Install.VERSION) throw new Error(`Runtime ${root} is version ${meta.version}. Run ${Hint.UPGRADE}.`);
      if (!meta.ready) Runtime.finish(root, options);
      Runtime.check(root);
      return;
    }
    fs.mkdirSync(root, { recursive: true });
    // The marker permits resuming a failed first install without erasing any credentials.
    Files.write(marker, `${JSON.stringify({ version: Install.VERSION, ready: false })}\n`);
    for (const name of Install.SOURCE) Files.copy(path.join(source, name), path.join(root, name));
    Runtime.finish(root, options);
  }
  static py(root) { return path.join(root, '.venv', 'Scripts', 'python.exe'); }
  static deps(root) {
    Runtime.npm(['ci', '--no-audit', '--no-fund', '--offline=false', `--cache=${path.join(root, '.npm-cache')}`], root);
    Runtime.npm(['run', 'build'], root);
  }
  static pip(root) { Runtime.run(Runtime.py(root), ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(root, 'python', 'requirements.txt')], root); }
  static swap(root, source) {
    for (const name of Install.SOURCE) {
      if (Install.EXCLUDE.includes(path.basename(name))) continue;
      const dest = path.join(root, name);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      Files.copy(path.join(source, name), dest);
    }
  }
  // Keep the extension ID stable: the fresh manifest lacks the key generated at first setup.
  static key(root) {
    const pub = path.join(root, Install.KEY);
    if (!fs.existsSync(pub)) return;
    const file = path.join(root, Install.MANIFEST);
    fs.writeFileSync(file, `${JSON.stringify({ ...Files.json(file), key: Files.json(pub).key }, null, 2)}\n`);
  }
  static finish(root, options) {
    Runtime.deps(root);
    Runtime.run(options.python || 'python', ['-m', 'venv', path.join(root, '.venv')], root);
    Runtime.pip(root);
    const env = { ...process.env, BB_LANGUAGE: options.language };
    Runtime.run(Runtime.py(root), [path.join(root, 'scripts', 'setup.py')], root, env);
    Runtime.ps(path.join(root, 'scripts', 'launchers.ps1'), root, env);
    Runtime.check(root);
    Files.write(path.join(root, Install.MARKER), `${JSON.stringify({ version: Install.VERSION, ready: true })}\n`);
  }
  static upgrade(root, source, options) {
    if (!fs.existsSync(root)) throw new Error(`Runtime not found: ${root}. Run ${Hint.INSTALL} first.`);
    const marker = path.join(root, Install.MARKER);
    if (!fs.existsSync(marker)) throw new Error(`Runtime ${root} has no install marker. Run ${Hint.INSTALL} first.`);
    Runtime.swap(root, source);
    Runtime.key(root);
    Runtime.deps(root);
    Runtime.pip(root);
    // setup.py returns immediately when .local/broker.json already exists.
    const env = { ...process.env, BB_LANGUAGE: options.language };
    Runtime.run(Runtime.py(root), [path.join(root, 'scripts', 'setup.py')], root, env);
    Files.write(marker, `${JSON.stringify({ version: Install.VERSION, ready: true })}\n`);
  }
  static register(root, options) {
    if (!options[Install.OPTION.NO_REGISTER]) Runtime.ps(path.join(root, 'scripts', 'register.ps1'), root, { ...process.env, BB_LANGUAGE: options.language });
  }
}
