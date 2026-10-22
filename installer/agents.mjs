import fs from 'node:fs';
import path from 'node:path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';
import { OpenCode, Probe } from './constants.mjs';
import { Conflict } from './files.mjs';

class Names {
  static all = ['codex', 'claude', 'cursor', 'opencode', 'gemini'];
  static key = 'tether';
}

class ServerKeys {
  static json = { parent: 'mcpServers', type: 'type', command: 'command', args: 'args', env: 'env', stdio: 'stdio' };
  static open = { parent: 'mcp', type: 'type', command: 'command', env: 'environment', enabled: 'enabled', local: 'local' };
  static toml = { parent: 'mcp_servers', command: 'command', args: 'args', env: 'env' };
}

class Paths {
  static dirs = { codex: '.agents/skills', claude: '.claude/skills', cursor: '.cursor/skills', opencode: '.opencode/skills', gemini: '.gemini/skills' };
  static project = { codex: '.codex/config.toml', claude: '.mcp.json', cursor: '.cursor/mcp.json', opencode: ['opencode.jsonc', 'opencode.json'], gemini: '.gemini/settings.json' };
}

class Config {
  static equal(a, b) { return isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))); }
  static object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  static read(text) {
    const errors = [];
    const value = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length) throw new Error('Malformed JSONC');
    if (!Config.object(value)) throw new Error('Configuration root must be an object');
    return value;
  }
  static edit(name, text, entry, force = false) {
    if (name === 'codex') return Config.toml(text, entry);
    const root = Config.read(text);
    const open = name === 'opencode';
    const fields = open ? ServerKeys.open : ServerKeys.json;
    const key = fields.parent;
    const parent = Object.hasOwn(root, key) ? root[key] : {};
    if (!Config.object(parent)) throw new Error(`${key} must be an object`);
    const desired = open
      ? { [fields.type]: fields.local, [fields.command]: [entry.command, ...entry.args], [fields.env]: entry.env, [fields.enabled]: true }
      : { ...(name === 'claude' ? { [fields.type]: fields.stdio } : {}), [fields.command]: entry.command, [fields.args]: entry.args, [fields.env]: entry.env };
    if (open && Object.keys(desired).some(k => !OpenCode.MCP_KEYS.includes(k))) throw new Error(`opencode ${OpenCode.VERSION} rejects unknown MCP keys`);
    if (Object.hasOwn(parent, Names.key)) {
      if (Config.equal(parent[Names.key], desired)) return text;
      if (!force) throw new Conflict(`Conflicting ${Names.key} entry`);
      const edits = modify(text, [key, Names.key], desired, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
      return applyEdits(text, edits);
    }
    const edits = modify(text, [key, Names.key], desired, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
    return applyEdits(text, edits);
  }
  static toml(text, entry, force = false) {
    let root;
    try { root = parseToml(text); } catch { throw new Error('Malformed TOML'); }
    if (!Config.object(root)) throw new Error('Configuration root must be a table');
    const fields = ServerKeys.toml;
    const servers = Object.hasOwn(root, fields.parent) ? root[fields.parent] : {};
    if (!Config.object(servers)) throw new Error(`${fields.parent} must be a table`);
    const desired = { [fields.command]: entry.command, [fields.args]: entry.args, [fields.env]: entry.env };
    if (Object.hasOwn(servers, Names.key)) {
      if (Config.equal(servers[Names.key], desired)) return text;
      if (!force) throw new Conflict(`Conflicting ${Names.key} entry`);
      let skip = false;
      const rest = text.split(/\r?\n/).filter(line => {
        if (/^\s*\[/.test(line)) {
          try { skip = Boolean(parseToml(line)[fields.parent]?.[Names.key]); }
          catch { skip = false; }
        }
        return !skip;
      }).join('\n');
      if (parseToml(rest)[fields.parent]?.[Names.key]) throw new Error('Cannot replace inline Tether TOML entry; use a [mcp_servers.tether] table.');
      return Config.toml(rest, entry, false);
    }
    const q = value => JSON.stringify(value);
    const table = `${fields.parent}.${Names.key}`;
    const lines = [`[${table}]`, `${fields.command} = ${q(entry.command)}`, `${fields.args} = ${q(entry.args)}`];
    {
      lines.push('', `[${table}.${fields.env}]`);
      for (const [key, value] of Object.entries(entry.env)) lines.push(`${q(key)} = ${q(value)}`);
    }
    const proposed = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text.trim() ? '\n' : ''}${lines.join('\n')}\n`;
    try { parseToml(proposed); } catch { throw new Error('Cannot append Tether entry to TOML'); }
    return proposed;
  }
}

export class Detect {
  static onPath(bin, env, exists) {
    const dirs = String(env[Probe.PATH] || '').split(path.delimiter).filter(Boolean);
    const exts = String(env[Probe.PATHEXT] || '').split(';').map(item => item.trim()).filter(Boolean);
    for (const dir of dirs) {
      const base = path.join(dir, bin);
      if (exists(base)) return true;
      for (const ext of exts) {
        const suffix = ext.startsWith('.') ? ext : `.${ext}`;
        if (exists(base + suffix)) return true;
      }
    }
    return false;
  }
  static find(env, home, exists) {
    const hit = bin => Detect.onPath(bin, env, exists);
    const has = (...parts) => exists(path.join(home, ...parts));
    const [codex, claude, cursor, opencode, gemini] = Names.all;
    const names = [];
    const codexHome = env[Probe.CODEX_HOME];
    const configHome = env[Probe.CONFIG_HOME];
    if (hit(Probe.BIN.codex) || (codexHome && exists(codexHome)) || has(Probe.HOME.codex)) names.push(codex);
    if (hit(Probe.BIN.claude) || has(Probe.HOME.claude)) names.push(claude);
    if (has(Probe.HOME.cursor)) names.push(cursor);
    if (hit(Probe.BIN.opencode) || (configHome && exists(path.join(configHome, Probe.HOME.opencode))) || has(Probe.HOME.config, Probe.HOME.opencode)) names.push(opencode);
    if (hit(Probe.BIN.gemini) || has(Probe.HOME.gemini)) names.push(gemini);
    return names;
  }
}

export class Agents {
  static names = Names.all;
  static paths(name, scope, context) {
    if (!Names.all.includes(name)) throw new Error(`Unknown agent: ${name}`);
    if (scope !== 'project' && scope !== 'user') throw new Error(`Unknown scope: ${scope}`);
    const project = path.resolve(context.project);
    const user = path.resolve(context.userHome);
    const codex = path.resolve(context.codexHome || path.join(user, '.codex'));
    const config = path.resolve(context.configHome || path.join(user, '.config'));
    let base, file;
    if (scope === 'project') {
      base = project;
      file = Paths.project[name];
      if (name === 'opencode') file = file.map(x => path.join(base, x)).find(fs.existsSync) || path.join(base, file[1]);
      else file = path.join(base, file);
    } else {
      base = user;
      file = { codex: path.join(codex, 'config.toml'), claude: path.join(user, '.claude.json'), cursor: path.join(user, '.cursor', 'mcp.json'), opencode: path.join(config, 'opencode', 'opencode.jsonc'), gemini: path.join(user, '.gemini', 'settings.json') }[name];
      if (name === 'opencode') {
        const json = path.join(config, 'opencode', 'opencode.json');
        if (fs.existsSync(json)) file = json;
        if (fs.existsSync(path.join(config, 'opencode', 'opencode.jsonc'))) file = path.join(config, 'opencode', 'opencode.jsonc');
      }
    }
    const skillRoot = scope === 'project' ? path.join(project, Paths.dirs[name]) : name === 'opencode' ? path.join(config, 'opencode', 'skills') : path.join(user, Paths.dirs[name]);
    return { config: path.resolve(file), skill: path.resolve(skillRoot, 'tether-browser'), format: path.extname(file).slice(1) };
  }
  static edit(name, text, entry, force = false) {
    if (!Names.all.includes(name)) throw new Error(`Unknown agent: ${name}`);
    if (typeof text !== 'string' || !Config.object(entry) || typeof entry.command !== 'string' || !Array.isArray(entry.args) || !Config.object(entry.env)) throw new Error('Invalid configuration input');
    if (name === 'codex') return Config.toml(text.trim() ? text : '', entry, force);
    return Config.edit(name, text.trim() ? text : '{}\n', entry, force);
  }
}
