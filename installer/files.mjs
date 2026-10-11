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
  static skill(source, target, location) {
    const plans = Files.entries(source).map(name => ({ file: path.join(target, name), text: Files.read(path.join(source, name)) }));
    plans.push({ file: path.join(target, Install.LOCATION), text: `${JSON.stringify(location, null, 2)}\n` });
    for (const plan of plans) {
      if (fs.existsSync(plan.file) && Files.read(plan.file) !== plan.text) throw new Error(`Skill conflict: ${plan.file}. Keep or move the existing skill before reinstalling.`);
    }
    return plans;
  }
}
