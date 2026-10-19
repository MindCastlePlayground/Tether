import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Install } from './constants.mjs';

export class Files {
  static read(file, fallback = '') { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fallback; }
  static json(file) { return JSON.parse(Files.read(file)); }
  static copy(from, to) {
    fs.cpSync(from, to, { recursive: true, filter: file => !Install.EXCLUDE.includes(path.basename(file)) });
  }
  static entries(root, base = root) {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(item => {
      const full = path.join(root, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symbolic link is not supported in skill: ${full}`);
      return item.isDirectory() ? Files.entries(full, base) : [path.relative(base, full)];
    });
  }
  static write(file, text) {
    if (Files.read(file) === text && fs.existsSync(file)) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    let backup = null;
    if (fs.existsSync(file)) {
      backup = `${file}.tether-backup-${suffix}`;
      fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(backup, fs.statSync(file).mode);
    }
    const temp = `${file}.tether-temp-${suffix}`;
    fs.writeFileSync(temp, text, { mode: fs.existsSync(file) ? fs.statSync(file).mode : 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
    return backup;
  }
  static skill(source, target, location, force = false) {
    const plans = Files.entries(source).map(name => ({ file: path.join(target, name), text: Files.read(path.join(source, name)) }));
    plans.push({ file: path.join(target, Install.LOCATION), text: `${JSON.stringify(location, null, 2)}\n` });
    for (const plan of plans) {
      plan.before = fs.existsSync(plan.file) ? Files.read(plan.file) : null;
      if (!force && fs.existsSync(plan.file) && Files.read(plan.file) !== plan.text) throw new Error(`Skill conflict: ${plan.file}. Keep or move the existing skill before reinstalling.`);
    }
    return plans;
  }
  static tree(source, target, force = false) {
    const fromRoot = path.resolve(source).toLowerCase(), toRoot = path.resolve(target).toLowerCase();
    if (fromRoot === toRoot || fromRoot.startsWith(`${toRoot}${path.sep}`) || toRoot.startsWith(`${fromRoot}${path.sep}`)) throw new Error('Extension source and destination must be separate, non-nested directories.');
    const copy = dir => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const from = path.join(dir, item.name), to = path.join(target, path.relative(source, from));
        if (item.isDirectory()) {
          if (fs.existsSync(to) && !fs.statSync(to).isDirectory()) {
            if (!force) throw new Error(`Extension file conflict: ${to}. Use --force to back up and replace it.`);
            fs.renameSync(to, `${to}.tether-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
          }
          fs.mkdirSync(to, { recursive: true }); copy(from); continue;
        }
        const data = fs.readFileSync(from);
        if (fs.existsSync(to)) {
          if (fs.statSync(to).isDirectory()) {
            if (!force) throw new Error(`Extension file conflict: ${to}. Use --force to back up and replace it.`);
            fs.renameSync(to, `${to}.tether-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
          } else {
            if (fs.readFileSync(to).equals(data)) continue;
            if (!force) throw new Error(`Extension file conflict: ${to}. Use --force to back up and replace it.`);
            const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
            fs.copyFileSync(to, `${to}.tether-backup-${suffix}`, fs.constants.COPYFILE_EXCL);
          }
        }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, data);
      }
    };
    fs.mkdirSync(target, { recursive: true });
    copy(source);
  }
}
