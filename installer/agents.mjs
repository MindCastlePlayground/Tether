import fs from 'node:fs';
import path from 'node:path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';

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
  static edit(name, text, entry) {
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
    if (Object.hasOwn(parent, Names.key)) {
      if (Config.equal(parent[Names.key], desired)) return text;
      throw new Error(`Conflicting ${Names.key} entry`);
    }
    const edits = modify(text, [key, Names.key], desired, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
    return applyEdits(text, edits);
  }
  static toml(text, entry) {
    let root;
    try { root = parseToml(text); } catch { throw new Error('Malformed TOML'); }
    if (!Config.object(root)) throw new Error('Configuration root must be a table');
    const fields = ServerKeys.toml;
    const servers = Object.hasOwn(root, fields.parent) ? root[fields.parent] : {};
    if (!Config.object(servers)) throw new Error(`${fields.parent} must be a table`);
    const desired = { [fields.command]: entry.command, [fields.args]: entry.args, [fields.env]: entry.env };
    if (Object.hasOwn(servers, Names.key)) {
      if (Config.equal(servers[Names.key], desired)) return text;
      throw new Error(`Conflicting ${Names.key} entry`);
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
  static edit(name, text, entry) {
    if (!Names.all.includes(name)) throw new Error(`Unknown agent: ${name}`);
    if (typeof text !== 'string' || !Config.object(entry) || typeof entry.command !== 'string' || !Array.isArray(entry.args) || !Config.object(entry.env)) throw new Error('Invalid configuration input');
    return Config.edit(name, text.trim() ? text : name === 'codex' ? '' : '{}\n', entry);
  }
}
