import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Files } from './files.mjs';
import { Service } from './service.mjs';
import { Hint, Install, InstallOption, Mark, Phase } from './constants.mjs';
import { Copy } from './text.mjs';

export class Runtime {
  static shell() { return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
  static run(command, args, cwd, env = process.env) {
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${path.basename(command)}`);
  }
  static step(options, phase) { console.log(`\n» ${Copy.of(options.language).steps[phase]}`); }
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
    if (options.runtime && !options[InstallOption.UPGRADE] && !options[InstallOption.FORCE]) { Runtime.check(root); return; }
    const marker = path.join(root, Install.MARKER);
    if (fs.existsSync(root)) {
      if (!fs.existsSync(marker)) throw new Error(`Runtime directory already exists: ${root}. Use --runtime for a configured checkout, or choose a new --home.`);
      const meta = Files.json(marker);
      const version = meta[Mark.VERSION];
      if (version !== Install.VERSION && !options[InstallOption.UPGRADE] && !options[InstallOption.FORCE]) throw new Error(`Runtime ${root} is version ${version}. Run ${Hint.UPGRADE} or install --upgrade.`);
      // An interrupted upgrade resumes as an upgrade; an interrupted first install finishes setup.
      if (version !== Install.VERSION || options[InstallOption.FORCE] || options[InstallOption.UPGRADE] || (!meta[Mark.READY] && meta[Mark.UPGRADE])) {
        Runtime.upgrade(root, source, options);
        Runtime.check(root);
        return;
      }
      if (!meta[Mark.READY]) Runtime.finish(root, options);
      Runtime.check(root);
      return;
    }
    fs.mkdirSync(root, { recursive: true });
    // The marker permits resuming a failed first install without erasing any credentials.
    Runtime.mark(root, { [Mark.READY]: false });
    Runtime.step(options, Phase.COPY);
    for (const name of Install.SOURCE) Files.copy(path.join(source, name), path.join(root, name));
    Runtime.finish(root, options);
  }
  // Numeric x.y.z comparison: -1, 0 or 1.
  static compare(a, b) {
    const parts = v => String(v ?? '').split('.').map(n => Number.parseInt(n, 10) || 0);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return Math.sign((x[i] ?? 0) - (y[i] ?? 0));
    return 0;
  }
  static py(root) { return path.join(root, '.venv', 'Scripts', 'python.exe'); }
  static deps(root) {
    try { Runtime.build(root); }
    catch {
      // On Windows a process restarted mid-install can hold node_modules open; stop it and retry once.
      Service.halt(root);
      Runtime.nap(Install.RETRY_MS);
      Runtime.build(root);
    }
  }
  static build(root) {
    Runtime.npm(['ci', '--no-audit', '--no-fund', '--offline=false', `--cache=${path.join(root, '.npm-cache')}`], root);
    Runtime.npm(['run', 'build'], root);
  }
  static pip(root) { Runtime.run(Runtime.py(root), ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(root, 'python', 'requirements.txt')], root); }
  static swap(root, source, options = {}) {
    const a = path.resolve(root), b = path.resolve(source);
    if (a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`)) throw new Error('Runtime source and destination must be separate, non-nested directories.');
    for (const name of Install.SOURCE) {
      if (Install.EXCLUDE.includes(path.basename(name))) continue;
      if (name === 'extension' && options[InstallOption.FORCE]) continue;
      const dest = path.join(root, name);
      fs.rmSync(dest, { recursive: true, force: true, maxRetries: Install.RETRIES, retryDelay: Install.RETRY_MS / Install.RETRIES });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      Files.copy(path.join(source, name), dest);
    }
    if (options[InstallOption.FORCE]) Runtime.extension(path.join(source, 'extension'), path.join(root, 'extension'), true);
  }
  // Keep the extension ID stable: the fresh manifest lacks the key generated at first setup.
  static key(root, extension = path.join(root, 'extension')) {
    const pub = path.join(root, Install.KEY);
    if (!fs.existsSync(pub)) return;
    const file = path.join(extension, 'manifest.json');
    const manifest = Files.json(file);
    // A new build name lets the loaded extension notice the upgrade and reload itself.
    const build = `${manifest.version ?? Install.VERSION} (${new Date().toISOString().replace(/[-:]|\.\d+Z$/g, '')})`;
    fs.writeFileSync(file, `${JSON.stringify({ ...manifest, key: Files.json(pub).key, version_name: build }, null, 2)}\n`);
  }
  static finish(root, options) {
    Runtime.step(options, Phase.DEPS);
    Runtime.deps(root);
    Runtime.step(options, Phase.VENV);
    Runtime.run(options.python || 'python', ['-m', 'venv', path.join(root, '.venv')], root);
    Runtime.step(options, Phase.PIP);
    Runtime.pip(root);
    const env = { ...process.env, BB_LANGUAGE: options.language };
    Runtime.step(options, Phase.SETUP);
    Runtime.run(Runtime.py(root), [path.join(root, 'scripts', 'setup.py')], root, env);
    Runtime.step(options, Phase.LAUNCHERS);
    Runtime.ps(path.join(root, 'scripts', 'launchers.ps1'), root, env);
    Runtime.check(root);
    Runtime.mark(root, { [Mark.READY]: true });
  }
  static upgrade(root, source, options) {
    if (!fs.existsSync(root)) throw new Error(`Runtime not found: ${root}. Run ${Hint.INSTALL} first.`);
    const marker = path.join(root, Install.MARKER);
    if (!fs.existsSync(marker)) throw new Error(`Runtime ${root} has no install marker. Run ${Hint.INSTALL} first.`);
    const meta = Files.json(marker);
    if (Runtime.compare(meta[Mark.VERSION], Install.VERSION) > 0 && !options[InstallOption.FORCE]) throw new Error(`Runtime ${root} is version ${meta[Mark.VERSION]}, newer than this installer (${Install.VERSION}). Use --force to downgrade.`);
    Runtime.location(root, options);
    // A rerun after an interrupted upgrade must restore the mode saved before the first pause, not "off".
    const resumed = meta[Mark.READY] === false && meta[Mark.UPGRADE] === true;
    const t = Copy.of(options.language);
    Runtime.step(options, Phase.STOP);
    const seen = Service.scan(root);
    if (seen.broker || seen.host) console.log(t.busy.service);
    if (seen.mcp) console.log(t.busy.mcp(seen.mcp));
    const paused = resumed ? meta[Mark.PAUSED] ?? null : Service.pause(root);
    Runtime.mark(root, { [Mark.READY]: false, [Mark.UPGRADE]: true, [Mark.PAUSED]: paused, [Mark.RUNNING]: Boolean(meta[Mark.RUNNING]) });
    const running = Service.halt(root) || (resumed && Boolean(meta[Mark.RUNNING]));
    Runtime.mark(root, { [Mark.READY]: false, [Mark.UPGRADE]: true, [Mark.PAUSED]: paused, [Mark.RUNNING]: running });
    try {
      Runtime.step(options, Phase.COPY);
      Runtime.swap(root, source, options);
      Runtime.key(root);
      Runtime.step(options, Phase.DEPS);
      Runtime.deps(root);
      Runtime.step(options, Phase.PIP);
      Runtime.pip(root);
      // setup.py returns immediately when .local/broker.json already exists.
      const env = { ...process.env, BB_LANGUAGE: options.language };
      Runtime.run(Runtime.py(root), [path.join(root, 'scripts', 'setup.py')], root, env);
      Runtime.step(options, Phase.SYNC);
      Runtime.sync(root, { ...options, [InstallOption.UPGRADE]: true });
    } catch (error) {
      // Auto-start stays paused so nothing runs the half-replaced code; the marker lets a rerun resume.
      error.message = `${error.message}\n${t.busy.failed}`;
      throw error;
    }
    Runtime.mark(root, { [Mark.READY]: true });
    // The extension respawns its host while we build; stop anything started from the old code.
    const again = Service.halt(root);
    const auto = Service.restore(root, paused);
    const restart = auto && (running || again);
    return { running: running || again, state: restart ? Service.resume(root) : undefined, mcp: seen.mcp };
  }
  static mark(root, fields) {
    Files.write(path.join(root, Install.MARKER), `${JSON.stringify({ [Mark.VERSION]: Install.VERSION, ...fields })}\n`);
  }
  static nap(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  static location(root, options) {
    const saved = path.join(root, Install.EXTENSION_LOCATION);
    const dest = path.resolve(options[InstallOption.EXTENSION_DIR] || (fs.existsSync(saved) ? Files.json(saved).path : path.join(root, 'extension')));
    const base = path.resolve(root).toLowerCase(), target = dest.toLowerCase();
    if (target !== path.join(base, 'extension') && (target === base || base.startsWith(`${target}${path.sep}`) || target.startsWith(`${base}${path.sep}`))) throw new Error('Custom extension directory must be outside runtime.');
    return dest;
  }
  static sync(root, options) {
    const dest = Runtime.location(root, options);
    const source = path.join(root, 'extension');
    if (path.resolve(dest).toLowerCase() !== path.resolve(source).toLowerCase()) Files.tree(source, dest, Boolean(options[InstallOption.FORCE] || options[InstallOption.UPGRADE]));
    Files.write(path.join(root, Install.EXTENSION_LOCATION), `${JSON.stringify({ path: dest })}\n`);
  }
  static extension(source, target, force = false) { Files.tree(source, target, force); }
  static register(root, options) {
    if (options[Install.OPTION.NO_REGISTER]) return;
    Runtime.step(options, Phase.REGISTER);
    Runtime.ps(path.join(root, 'scripts', 'register.ps1'), root, { ...process.env, BB_LANGUAGE: options.language });
  }
}
