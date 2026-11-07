import './sandbox.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { parse, parseDocument, stringify } from 'yaml';
import { Agents, Detect } from '../installer/agents.mjs';
import { Cli } from '../installer/cli.mjs';

const entry = { command: 'C:\\Tether Files\\mcp.exe', args: [], env: { BB_LANGUAGE: 'en' } };

test('dsh emits a stdio plugin patch, preserves YAML expressions and is idempotent', () => {
  const before = '# keep\n- id: llm\n  config:\n    token: !!js process.env.EXAMPLE_KEY\n';
  const result = Agents.edit('dsh', before, entry);
  const doc = parseDocument(result);
  assert.equal(doc.errors.length, 0);
  assert.match(result, /# keep/);
  assert.match(result, /!!js process.env.EXAMPLE_KEY/);
  assert.deepEqual(doc.toJS()[1].insert[0], { id: 'mcp-tether', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'tether', transport: 'stdio', ...entry } });
  assert.equal(Agents.edit('dsh', result, entry), result);
  assert.deepEqual(parse(Agents.edit('dsh', '', entry))[0].insert[0].config.env, entry.env);
});

test('dsh preserves conflicts unless force is requested and rejects invalid patches', () => {
  const original = Agents.edit('dsh', '', { ...entry, command: 'other' });
  assert.throws(() => Agents.edit('dsh', original, entry), /Conflicting/);
  const forced = Agents.edit('dsh', original, entry, true);
  assert.equal(parse(forced)[0].insert[0].config.command, entry.command);
  assert.equal(Agents.edit('dsh', forced, entry), forced);
  for (const text of ['{}', '- [', 'null']) assert.throws(() => Agents.edit('dsh', text, entry), /YAML patch list/);
  assert.throws(() => Agents.edit('dsh', stringify([...parse(original), ...parse(original)]), entry, true), /Multiple/);
});

test('dsh detection and destinations respect DSH_HOME and project scope', () => {
  const home = path.join(os.tmpdir(), 'dsh-user');
  const custom = path.join(home, 'custom');
  const context = { userHome: home, project: path.join(home, 'project'), dshHome: custom };
  assert.deepEqual(Detect.find({ DSH_HOME: custom }, home, file => file === custom), ['dsh']);
  assert.deepEqual(Detect.find({ PATH: path.join(home, 'bin'), PATHEXT: '.CMD' }, home, file => file === path.join(home, 'bin', 'dsh.CMD')), ['dsh']);
  assert.equal(Agents.paths('dsh', 'user', context).config, path.join(custom, 'cordis.patch.yml'));
  assert.equal(Agents.paths('dsh', 'user', context).skill, path.join(custom, 'skills', 'tether-browser'));
  assert.equal(Agents.paths('dsh', 'project', context).config, path.join(context.project, '.dsh', 'cordis.patch.yml'));
  assert.deepEqual(Cli.resolve({ agent: 'dsh', language: 'en' }).names, ['dsh']);
});
