import assert from 'node:assert/strict';
import test from 'node:test';
import { Cli } from '../installer/cli.mjs';
import { Prompt } from '../installer/prompt.mjs';
import { PassThrough } from 'node:stream';

test('interactive answers map to existing install options', async () => {
  const answers = ['', 'user', 'C:\\project', '', '', '', 'edge', 'zh-CN', 'no', 'no', 'yes', '', 'no', 'no'];
  const questions = [];
  const args = await Prompt.collect(async question => {
    questions.push(question);
    return answers.shift();
  });
  const { command, options } = Cli.parse(args);
  assert.equal(command, 'install');
  assert.equal(options.agent, 'auto');
  assert.equal(options.scope, 'user');
  assert.equal(options.project, 'C:\\project');
  assert.equal(options.browser, 'edge');
  assert.equal(options.language, 'zh-CN');
  assert.equal(options['no-register'], true);
  assert.equal(options['no-open'], true);
  assert.equal(options['dry-run'], true);
  assert.equal(options.runtime, undefined);
  assert.equal(options.home, undefined);
  assert.equal(questions.length, 14);
});

test('interactive runtime selection suppresses install-home selection', async () => {
  const answers = ['codex,gemini', 'project', 'C:\\project', 'C:\\runtime', '', 'chrome', 'en', 'yes', 'yes', 'no', '', 'no', 'no'];
  const args = await Prompt.collect(async () => answers.shift());
  const { options } = Cli.parse(args);
  assert.equal(options.agent, 'codex,gemini');
  assert.equal(options.runtime, 'C:\\runtime');
  assert.equal(options.home, undefined);
  assert.equal(options['dry-run'], undefined);
});

test('interactive agent input rejects unknown agents clearly', async () => {
  await assert.rejects(Prompt.collect(async () => 'unknown'), /Agent/);
});

test('interactive defaults preserve per-agent scope and normalize comma-separated names', async () => {
  const answers = ['codex, opencode', '', '', '', '', '', '', '', '', '', 'yes', '', 'no', 'no'];
  const { options } = Cli.parse(await Prompt.collect(async () => answers.shift()));
  assert.equal(options.agent, 'codex,opencode');
  assert.equal(options.scope, undefined);
  assert.equal(Cli.scope('opencode', options), 'user');
  assert.equal(Cli.scope('codex', options), 'project');
});

test('interactive readline completes a dry-run questionnaire', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const answers = ['codex', 'project', '', '', '', '', 'chrome', 'en', 'no', 'no', 'yes', '', 'no', 'no'];
  output.on('data', () => { const answer = answers.shift(); if (answer !== undefined) setImmediate(() => input.write(`${answer}\n`)); });
  const args = await Prompt.run(input, output);
  assert.equal(Cli.parse(args).options['dry-run'], true);
  assert.equal(answers.length, 0);
});

test('interactive EOF cancels without installing or hanging', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const result = Prompt.run(input, output);
  input.end();
  assert.equal(await result, null);
});
