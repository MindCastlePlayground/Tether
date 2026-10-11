import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'jsonc-parser';
import { Agents } from '../installer/agents.mjs';

const entry = { command: 'C:/tools/mcp.exe', args: ['serve', '--stdio'], env: { BB_LANGUAGE: 'en' } };
const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-agents-'));
  return { project: path.join(dir, 'project'), userHome: path.join(dir, 'home'), codexHome: path.join(dir, 'codex'), configHome: path.join(dir, 'config') };
};

test('all agent paths resolve for project and user scopes', () => {
  const c = mk();
  const expected = {
    codex: ['.codex/config.toml', '.agents/skills/tether-browser'],
    claude: ['.mcp.json', '.claude/skills/tether-browser'],
    cursor: ['.cursor/mcp.json', '.cursor/skills/tether-browser'],
    opencode: ['opencode.json', '.opencode/skills/tether-browser'],
    gemini: ['.gemini/settings.json', '.gemini/skills/tether-browser'],
  };
  for (const n of Agents.names) {
    const p = Agents.paths(n, 'project', c);
    assert.equal(p.config, path.join(c.project, expected[n][0]));
    assert.equal(p.skill, path.join(c.project, expected[n][1]));
    assert.ok(path.isAbsolute(p.config) && path.isAbsolute(p.skill));
  }
  const u = Agents.paths('codex', 'user', c);
  assert.equal(u.config, path.join(c.codexHome, 'config.toml'));
  assert.equal(u.skill, path.join(c.userHome, '.agents', 'skills', 'tether-browser'));
  assert.equal(Agents.paths('claude', 'user', c).config, path.join(c.userHome, '.claude.json'));
  assert.equal(Agents.paths('cursor', 'user', c).skill, path.join(c.userHome, '.cursor', 'skills', 'tether-browser'));
  assert.equal(Agents.paths('opencode', 'user', c).config, path.join(c.configHome, 'opencode', 'opencode.jsonc'));
  assert.equal(Agents.paths('gemini', 'user', c).config, path.join(c.userHome, '.gemini', 'settings.json'));
  fs.mkdirSync(c.project, { recursive: true });
  fs.writeFileSync(path.join(c.project, 'opencode.json'), '{}');
  assert.equal(Agents.paths('opencode', 'project', c).config, path.join(c.project, 'opencode.json'));
});

test('JSONC edits preserve comments, unknown keys, and are idempotent', () => {
  const before = '{\n  // keep this comment\n  "other": { "enabled": true }\n}\n';
  for (const n of ['claude', 'cursor', 'gemini']) {
    const changed = Agents.edit(n, before, entry);
    assert.match(changed, /keep this comment/);
    assert.match(changed, /"other"/);
    assert.deepEqual(parse(changed).mcpServers.tether, { ...(n === 'claude' ? {type:'stdio'} : {}), ...entry });
    assert.equal(Agents.edit(n, changed, entry), changed);
  }
  const open = Agents.edit('opencode', before, entry);
  assert.deepEqual(parse(open).mcp.tether, { type: 'local', command: [entry.command, ...entry.args], environment: entry.env, enabled: true });
  assert.equal(Agents.edit('opencode', open, entry), open);
});

test('JSONC rejects malformed roots, parents, and conflicting entries', () => {
  assert.throws(() => Agents.edit('claude', '{', entry), /Malformed JSONC/);
  assert.throws(() => Agents.edit('claude', '[]', entry), /root/);
  assert.throws(() => Agents.edit('claude', '{"mcpServers":[]}', entry), /mcpServers/);
  assert.throws(() => Agents.edit('claude', '{"mcpServers":{"tether":{"command":"other"}}}', entry), /Conflicting/);
  assert.throws(() => Agents.edit('opencode', '{"mcp":false}', entry), /mcp/);
});

test('Codex appends valid TOML, preserves existing text, and detects collisions', () => {
  const before = '# retain this\nmodel = "local"\n\n[mcp_servers.other]\ncommand = "other"\nargs = []\n';
  const changed = Agents.edit('codex', before, entry);
  assert.ok(changed.startsWith(before));
  assert.match(changed, /# retain this/);
  assert.match(changed, /\[mcp_servers\.tether\]/);
  assert.equal(Agents.edit('codex', changed, entry), changed);
  assert.throws(() => Agents.edit('codex', 'model = [', entry), /Malformed TOML/);
  assert.throws(() => Agents.edit('codex', '[mcp_servers.tether]\ncommand="other"\nargs=[]\n', entry), /Conflicting/);
  assert.throws(() => Agents.edit('codex', 'mcp_servers = { other = {} }\n', entry), /append/);
  assert.throws(() => Agents.edit('codex', '[mcp_servers]\ntether = {}\n', entry), /Conflicting/);
});
