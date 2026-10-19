import readline from 'node:readline/promises';
import { Interactive } from './constants.mjs';

export class Prompt {
  static async run(input = process.stdin, output = process.stdout) {
    const rl = readline.createInterface({ input, output });
    const cancel = new AbortController();
    rl.on('SIGINT', () => cancel.abort());
    rl.on('close', () => cancel.abort());
    try {
      return await Prompt.collect(text => rl.question(text, { signal: cancel.signal }));
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
      output.write(`${Prompt.zh() ? '已取消安装。' : 'Installation cancelled.'}\n`);
      return null;
    } finally {
      rl.close();
    }
  }
  static zh() { return Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh'); }
  static async collect(ask) {
    const zh = Prompt.zh();
    const labels = zh ? Interactive.PROMPTS_ZH : {
      agent: Interactive.AGENT, scope: Interactive.SCOPE, project: Interactive.PROJECT,
      home: Interactive.HOME, runtime: Interactive.RUNTIME, python: Interactive.PYTHON,
      browser: Interactive.BROWSER, language: Interactive.LANGUAGE, register: Interactive.REGISTER,
      open: Interactive.OPEN, dry: Interactive.DRY, extensionDir: Interactive.EXTENSION_DIR, force: Interactive.FORCE, upgrade: Interactive.UPGRADE
    };
    const askValue = async (key, valid, fallback) => {
      while (true) {
        const value = (await ask(labels[key])).trim();
        if (!value) return fallback;
        if (!valid || valid(value)) return value;
        if (key === 'agent') throw new Error(zh ? `Agent 必须是 auto 或以下名称的逗号分隔列表：${Interactive.AGENTS.slice(1).join(', ')}` : `Agent must be auto or a comma-separated list of: ${Interactive.AGENTS.slice(1).join(', ')}`);
        if (key === 'scope') throw new Error(zh ? '范围只能是 auto、project 或 user。' : 'Scope must be auto, project or user.');
        if (key === 'browser') throw new Error(zh ? '浏览器只能是 chrome 或 edge。' : 'Browser must be chrome or edge.');
        if (key === 'language') throw new Error(zh ? '语言只能是 en 或 zh-CN。' : 'Language must be en or zh-CN.');
        if (key === 'register' || key === 'open' || key === 'dry' || key === 'force' || key === 'upgrade') throw new Error(zh ? '请输入 yes 或 no。' : 'Please enter yes or no.');
      }
    };
    const agent = (await askValue('agent', value => value === Interactive.AUTO || value.split(',').every(name => Interactive.AGENTS.slice(1).includes(name.trim())), Interactive.AUTO)).split(',').map(name => name.trim()).join(',');
    const scope = await askValue('scope', value => Interactive.SCOPES.includes(value), Interactive.AUTO);
    const project = await askValue('project', null, process.cwd());
    const runtime = await askValue('runtime');
    const home = runtime ? Interactive.EMPTY : await askValue('home');
    const python = await askValue('python');
    const browser = await askValue('browser', value => Interactive.BROWSERS.includes(value), Interactive.CHROME);
    const language = await askValue('language', value => Interactive.LANGUAGES.includes(value));
    const register = await askValue('register', value => Interactive.YES.includes(value), Interactive.YES_VALUE);
    const open = await askValue('open', value => Interactive.YES.includes(value), Interactive.YES_VALUE);
    const dry = await askValue('dry', value => Interactive.YES.includes(value), Interactive.NO_VALUE);
    const extensionDir = await askValue('extensionDir');
    const force = await askValue('force', value => Interactive.YES.includes(value), Interactive.NO_VALUE);
    const upgrade = await askValue('upgrade', value => Interactive.YES.includes(value), Interactive.NO_VALUE);
    const args = ['install', '--agent', agent, '--project', project, '--browser', browser];
    if (scope !== Interactive.AUTO) args.push('--scope', scope);
    if (runtime) args.push('--runtime', runtime);
    if (home) args.push('--home', home);
    if (python) args.push('--python', python);
    if (language) args.push('--language', language);
    if (register === Interactive.NO_VALUE) args.push('--no-register');
    if (open === Interactive.NO_VALUE) args.push('--no-open');
    if (dry === Interactive.YES_VALUE) args.push('--dry-run');
    if (extensionDir) args.push('--extension-dir', extensionDir);
    if (force === Interactive.YES_VALUE) args.push('--force');
    if (upgrade === Interactive.YES_VALUE) args.push('--upgrade');
    return args;
  }
}
