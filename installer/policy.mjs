import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Policy } from './constants.mjs';

export class PolicyFile {
  static file(runtime) { return path.join(runtime, '.local', Policy.FILE); }
  static load(file) {
    if (!fs.existsSync(file)) return structuredClone(Policy.FALLBACK);
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { throw new Error(`Invalid policy JSON at ${file}: ${error.message}`); }
    return PolicyFile.check(data);
  }
  // Atomic replace without Files.write, which would leave a backup beside the live policy.
  static save(file, data) {
    PolicyFile.check(data);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tether-temp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  }
  static reset(file) { fs.rmSync(file, { force: true }); }
  static check(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Policy must be a JSON object');
    if (data[Policy.KEY.VERSION] !== Policy.VERSION) throw new Error(`Unsupported policy version: ${data[Policy.KEY.VERSION]}`);
    if (!Policy.DEFAULTS.includes(data[Policy.KEY.DEFAULT])) throw new Error(`Invalid default effect: ${data[Policy.KEY.DEFAULT]}`);
    if (!Array.isArray(data[Policy.KEY.RULES])) throw new Error('Policy rules must be an array');
    const ids = new Set();
    for (const rule of data[Policy.KEY.RULES]) {
      PolicyFile.checkRule(rule);
      if (ids.has(rule[Policy.KEY.ID])) throw new Error(`Duplicate rule id: ${rule[Policy.KEY.ID]}`);
      ids.add(rule[Policy.KEY.ID]);
    }
    return data;
  }
  static checkRule(rule) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('Rule must be an object');
    if (typeof rule[Policy.KEY.ID] !== 'string' || !rule[Policy.KEY.ID]) throw new Error('Rule id must be a non-empty string');
    if (typeof rule[Policy.KEY.CLIENT] !== 'string' || !rule[Policy.KEY.CLIENT]) throw new Error('Rule client must be a non-empty string');
    PolicyFile.checkOrigin(rule[Policy.KEY.ORIGIN]);
    if (!Array.isArray(rule[Policy.KEY.ACTIONS]) || !rule[Policy.KEY.ACTIONS].length) throw new Error('Rule actions must be a non-empty array');
    for (const action of rule[Policy.KEY.ACTIONS]) if (action !== Policy.WILD && !Policy.ACTIONS.includes(action)) throw new Error(`Unknown action: ${action}`);
    if (rule[Policy.KEY.ACTIONS].includes(Policy.WILD) && rule[Policy.KEY.ACTIONS].length > 1) throw new Error(`Wildcard action must be the only action: ${rule[Policy.KEY.ACTIONS].join(',')}`);
    if (!Policy.EFFECTS.includes(rule[Policy.KEY.EFFECT])) throw new Error(`Invalid effect: ${rule[Policy.KEY.EFFECT]}`);
    if (rule[Policy.KEY.EFFECT] === Policy.ASK && !(rule[Policy.KEY.ACTIONS].length === 1 && rule[Policy.KEY.ACTIONS][0] === Policy.SESSION)) throw new Error('Effect ask is only valid for the session action');
  }
  static checkOrigin(value) {
    if (value === Policy.WILD) return;
    if (typeof value !== 'string') throw new Error(`Invalid origin: ${value}`);
    const parts = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)$/i.exec(value);
    const host = parts && /^(?:(\*\.))?([^:]+)(?::(\d+))?$/.exec(parts[2]);
    const labels = host && host[2].split('.');
    const valid = host && labels.every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) && (!host[3] || (+host[3] >= 1 && +host[3] <= 65535));
    if (!valid) throw new Error(`Invalid origin: ${value}`);
  }
  static rule(options, fallbackId) {
    const rule = {
      [Policy.KEY.ID]: options[Policy.KEY.ID] || fallbackId,
      [Policy.KEY.CLIENT]: options[Policy.KEY.CLIENT] || Policy.WILD,
      [Policy.KEY.ORIGIN]: options[Policy.KEY.ORIGIN] || Policy.WILD,
      [Policy.KEY.ACTIONS]: String(options[Policy.KEY.ACTIONS] ?? '').split(',').map(item => item.trim()).filter(Boolean),
      [Policy.KEY.EFFECT]: options[Policy.KEY.EFFECT],
    };
    PolicyFile.checkRule(rule);
    return rule;
  }
  static nextId(data) {
    const used = data[Policy.KEY.RULES].map(item => /^r(\d+)$/.exec(item[Policy.KEY.ID])?.[1]).filter(Boolean).map(Number);
    return `r${Math.max(0, ...used) + 1}`;
  }
  static add(data, rule, first) {
    return { ...data, [Policy.KEY.RULES]: first ? [rule, ...data[Policy.KEY.RULES]] : [...data[Policy.KEY.RULES], rule] };
  }
  static remove(data, id) {
    const rules = data[Policy.KEY.RULES].filter(item => item[Policy.KEY.ID] !== id);
    if (rules.length === data[Policy.KEY.RULES].length) throw new Error(`Rule not found: ${id}`);
    return { ...data, [Policy.KEY.RULES]: rules };
  }
}
