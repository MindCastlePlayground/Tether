import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agents, Detect } from './agents.mjs';
import { Cmd, Hint, Install, Opt, Policy } from './constants.mjs';
import { Files } from './files.mjs';
import { Runtime } from './runtime.mjs';
import { Browser } from './browser.mjs';
import { PolicyFile } from './policy.mjs';

export class Cli {
  static ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  static parse(args) {
    const command = args[0]?.startsWith('--') ? 'help' : args.shift() || 'help';
    if (!Install.COMMANDS.includes(command)) throw new Error(`Unknown command: ${command}`);
    const options = { scope: 'project', project: process.cwd(), browser: 'chrome', language: Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh') ? 'zh-CN' : 'en' };
    const policy = command === Cmd.POLICY;
    if (policy && args[0] && !args[0].startsWith('--')) options.action = args.shift();
    if (options.action === Policy.ACTION.DEFAULT && args[0] && !args[0].startsWith('--')) options.value = args.shift();
    const values = policy ? [...Install.VALUES, ...Policy.VALUES] : Install.VALUES;
    const flags = policy ? [...Install.FLAGS, ...Policy.FLAGS] : Install.FLAGS;
    while (args.length) {
      const token = args.shift();
      if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
      const key = token.slice(2);
      if (flags.includes(key)) options[key] = true;
      else if (values.includes(key) && args[0] && !args[0].startsWith('--')) options[key] = args.shift();
      else throw new Error(`Unknown or missing option: --${key}`);
    }
    if (!['project', 'user'].includes(options.scope)) throw new Error('Scope must be project or user');
    if (!Install.LANGUAGES.includes(options.language)) throw new Error('Language must be en or zh-CN');
    if (!Install.BROWSERS.includes(options.browser)) throw new Error('Browser must be chrome or edge');
    return { command: options.help ? 'help' : command, options };
  }
  static help(language) {
    if (language === 'zh-CN') {
      console.log(`Tether 安装器（Windows、Node 22+、Python 3.10+）\n\n  tether install [--agent codex,claude,cursor,opencode,gemini|auto] [选项]\n  tether upgrade [--runtime PATH | --home PATH]\n  tether doctor [--runtime PATH | --home PATH]\n  tether extension [--browser chrome|edge] [--open-browser]\n  tether policy list|add|remove|default|reset|path [选项]\n\n选项：\n  --agent LIST|auto      省略或 auto：检测本机已安装的 Agent 并全部配置\n  --scope project|user   默认项目范围\n  --project PATH         项目配置/Skill 目录（默认当前目录）\n  --home PATH            持久安装目录（默认 LOCALAPPDATA/Tether）\n  --runtime PATH         复用已配置的 prototype 目录\n  --python PATH          创建独立环境的 Python 解释器\n  --language en|zh-CN    MCP 描述及初始化提示语言\n  --no-register          跳过 HKCU 原生主机注册\n  --open-browser         打开扩展管理页。install 默认会打开，除非 --no-open\n  --no-open              install 成功后不打开浏览器\n  --dry-run              只预览路径，不写入或启动进程\n\n策略（<runtime>/.local/policy.json，Broker 热加载，无需重启）：\n  tether policy list [--runtime PATH | --home PATH]                查看当前策略，未配置时输出默认并注明全放行\n  tether policy add --effect allow|deny|ask --actions a,b|* [--origin URL] [--client ID] [--id ID] [--first]\n  tether policy remove --id ID                                     删除规则\n  tether policy default allow|deny                                 设置默认效果\n  tether policy reset                                              删除策略文件，恢复全放行\n  tether policy path                                               打印策略文件路径\n\n已有冲突的 MCP/Skill 会保留并报告。\n扩展需要手动启用开发者模式并加载已解压的扩展程序。\n安装器不会启动 Broker。根包尚未发布到 npm 公共仓库。\nupgrade 替换运行目录源码并保留 .local 与 .venv，不修改 Agent 配置，也不重新生成凭据。\ninstall 遇到旧版本运行目录时不会覆盖，请运行 tether upgrade。`);
      return;
    }
    console.log(`Tether installer (Windows, Node 22+, Python 3.10+)\n\n  tether install [--agent codex,claude,cursor,opencode,gemini|auto] [options]\n  tether upgrade [--runtime PATH | --home PATH]\n  tether doctor [--runtime PATH | --home PATH]\n  tether extension [--browser chrome|edge] [--open-browser]\n  tether policy list|add|remove|default|reset|path [options]\n\nOptions:\n  --agent LIST|auto      Omit or auto: detect and configure every installed agent\n  --scope project|user   Default: project\n  --project PATH         Project config/skill destination (default: current directory)\n  --home PATH            Durable installation home (default: LOCALAPPDATA/Tether)\n  --runtime PATH         Reuse an already configured prototype directory\n  --python PATH          Python executable for a fresh isolated venv\n  --language en|zh-CN    MCP descriptions and setup messages\n  --no-register          Skip HKCU Native Messaging registration\n  --open-browser         Open the extension manager. Install does this unless --no-open\n  --no-open              Do not open the browser after install\n  --dry-run              Print paths/plan without writes or processes\n\nPolicy (<runtime>/.local/policy.json, hot-reloaded by the Broker, no restart needed):\n  tether policy list [--runtime PATH | --home PATH]                Show the current policy; prints the default when unset\n  tether policy add --effect allow|deny|ask --actions a,b|* [--origin URL] [--client ID] [--id ID] [--first]\n  tether policy remove --id ID                                     Delete a rule\n  tether policy default allow|deny                                 Set the default effect\n  tether policy reset                                              Delete the policy file (allow everything)\n  tether policy path                                               Print the policy file path\n\nExisting conflicting MCP entries/skills are preserved and reported.\nBrowser extension loading needs Developer mode + Load unpacked.\nInstallation never starts Broker. npm registry publication is not yet available.\nupgrade replaces runtime source, keeps .local and .venv, and does not change agent config or regenerate credentials.\ninstall does not overwrite an older runtime; run tether upgrade.`);
  }
  static resolve(options, find = Detect.find) {
    const raw = options.agent;
    if (raw && raw !== Opt.AUTO) return { names: [...new Set(raw.split(',').filter(Boolean))], detected: false };
    const names = find(process.env, os.homedir(), fs.existsSync);
    if (!names.length) throw new Error(options.language === 'zh-CN' ? `未检测到已安装的 Agent。请使用 ${Opt.AGENT} 指定。` : `No installed agents detected. Pass ${Opt.AGENT}.`);
    return { names, detected: true };
  }
  static upgrade(runtime, options) {
    const zh = options.language === 'zh-CN';
    if (!fs.existsSync(runtime)) throw new Error(`Runtime not found: ${runtime}. Run ${Hint.INSTALL} first.`);
    console.log(`${zh ? '升级运行目录' : 'Upgrade runtime'}: ${runtime}`);
    console.log(zh ? '保留 .local 与 .venv，替换源码后构建。不修改 Agent 配置。' : 'Keeps .local and .venv, replaces source, then builds. Agent config is unchanged.');
    if (options[Install.OPTION.DRY]) return 0;
    if (process.platform !== 'win32') throw new Error('Native host setup currently supports Windows only. --dry-run works on other platforms.');
    Runtime.upgrade(runtime, path.join(Cli.ROOT, 'prototype'), options);
    console.log(zh ? '升级完成。' : 'Upgrade complete.');
    return 0;
  }
  static root(options) { return options.runtime ? path.resolve(options.runtime) : path.join(path.resolve(options.home || path.join(process.env.LOCALAPPDATA || os.homedir(), 'Tether')), 'runtime'); }
  static plans(options, runtime) {
    const names = [...new Set((options.agent || '').split(',').filter(Boolean))];
    if (!names.length) throw new Error('Select at least one --agent');
    const entry = { command: path.join(runtime, '.local', 'mcp.exe'), args: [], env: { BB_LANGUAGE: options.language } };
    const context = { project: path.resolve(options.project), userHome: os.homedir(), codexHome: process.env.CODEX_HOME, configHome: process.env.XDG_CONFIG_HOME };
    return names.map(name => {
      const dest = Agents.paths(name, options.scope, context);
      const before = Files.read(dest.config);
      const text = Agents.edit(name, before, entry);
      const location = { server: Install.SERVER, runtime, mcpCommand: entry.command, clientConfig: path.join(runtime, '.local', 'agent.json'), agent: name, configFile: dest.config, language: options.language };
      const skills = Files.skill(path.join(Cli.ROOT, 'skills', Install.SKILL), dest.skill, location);
      return { name, ...dest, before, text, skills };
    });
  }
  static print(options, runtime, plans = []) {
    const zh = options.language === 'zh-CN';
    console.log(`${zh ? '运行目录' : 'Runtime'}: ${runtime}`);
    for (const plan of plans) console.log(`${plan.name}\n  MCP: ${plan.config}\n  Skill: ${plan.skill}`);
    const browser = Browser.plan(options.browser, runtime);
    console.log(`${zh ? '扩展目录' : 'Extension'}: ${browser.folder}\n${zh ? '浏览器入口' : 'Browser manager'}: ${browser.url}`);
    console.log(zh ? '打开开发者模式 → 加载已解压的扩展程序 → 选择扩展目录。' : 'Enable Developer mode → Load unpacked → select the extension folder.');
    console.log(zh ? 'Broker 保持关闭；安装器不会启动它。' : 'Broker remains stopped; the installer never starts it.');
    return browser;
  }
  static doctor(runtime, options) {
    const checks = Install.REQUIRED.map(name => ({ file: name, present: fs.existsSync(path.join(runtime, name)) }));
    let valid = false;
    try { Runtime.check(runtime); valid = true; } catch { /* Only report metadata, never credentials. */ }
    console.log(JSON.stringify({ runtime, valid, checks, broker: 'not-probed-or-started', browser: Browser.plan(options.browser, runtime) }, null, 2));
    return valid ? 0 : 1;
  }
  static policy(runtime, options) {
    const zh = options.language === 'zh-CN';
    const action = options.action;
    if (!Policy.COMMANDS.includes(action)) throw new Error(`Unknown policy action: ${action ?? '(missing)'}. Use ${Policy.COMMANDS.join('|')}`);
    const file = PolicyFile.file(runtime);
    if (!fs.existsSync(path.dirname(file))) throw new Error(zh ? `运行目录未安装：${path.dirname(file)}。请先运行 ${Hint.INSTALL}。` : `Runtime is not installed: ${path.dirname(file)}. Run ${Hint.INSTALL} first.`);
    if (action === Policy.ACTION.PATH) { console.log(file); return 0; }
    if (action === Policy.ACTION.LIST) {
      const missing = !fs.existsSync(file);
      console.log(JSON.stringify(PolicyFile.load(file), null, 2));
      if (missing) console.log(zh ? '未配置，默认全放行。' : 'Not configured; everything is allowed by default.');
      return 0;
    }
    if (action === Policy.ACTION.RESET) {
      PolicyFile.reset(file);
      console.log(zh ? '已删除策略文件，恢复全放行。' : 'Policy file removed; everything is allowed.');
      return 0;
    }
    const data = PolicyFile.load(file);
    if (action === Policy.ACTION.ADD) {
      const rule = PolicyFile.rule(options, PolicyFile.nextId(data));
      PolicyFile.save(file, PolicyFile.add(data, rule, Boolean(options[Policy.KEY.FIRST])));
      console.log(zh ? `已添加规则 ${rule[Policy.KEY.ID]}` : `Added rule ${rule[Policy.KEY.ID]}`);
      return 0;
    }
    if (action === Policy.ACTION.REMOVE) {
      if (!options[Policy.KEY.ID]) throw new Error(zh ? '缺少 --id。' : 'Missing --id.');
      PolicyFile.save(file, PolicyFile.remove(data, options[Policy.KEY.ID]));
      console.log(zh ? `已删除规则 ${options[Policy.KEY.ID]}` : `Removed rule ${options[Policy.KEY.ID]}`);
      return 0;
    }
    if (action !== Policy.ACTION.DEFAULT) throw new Error(`Unknown policy action: ${action}`);
    if (!Policy.DEFAULTS.includes(options.value)) throw new Error(zh ? `默认效果只能是 allow 或 deny，收到：${options.value ?? '(空)'}` : `Default effect must be allow or deny, got: ${options.value ?? '(missing)'}`);
    PolicyFile.save(file, { ...data, [Policy.KEY.DEFAULT]: options.value });
    console.log(zh ? `默认效果已设为 ${options.value}` : `Default effect set to ${options.value}`);
    return 0;
  }
  static async main(args) {
    const { command, options } = Cli.parse([...args]);
    if (command === 'help') { Cli.help(options.language); return 0; }
    const runtime = Cli.root(options);
    if (command === Cmd.POLICY) return Cli.policy(runtime, options);
    if (command === 'doctor') return Cli.doctor(runtime, options);
    if (command === 'extension') {
      if (!fs.existsSync(path.join(runtime, 'extension', 'manifest.json'))) throw new Error('Extension not installed. Run install first or provide --runtime.');
      const browser = Cli.print(options, runtime);
      if (options[Install.OPTION.OPEN] && !options[Install.OPTION.DRY]) await Browser.open(browser);
      return 0;
    }
    if (command === Cmd.UPGRADE) return Cli.upgrade(runtime, options);
    const resolved = Cli.resolve(options);
    if (resolved.detected) console.log(`${options.language === 'zh-CN' ? '检测到 Agent' : 'Detected agents'}: ${resolved.names.join(', ')}`);
    options.agent = resolved.names.join(',');
    // Validate all destination configs/skill conflicts before preparing runtime or writing any agent config.
    const plans = Cli.plans(options, runtime);
    const browser = Cli.print(options, runtime, plans);
    if (options[Install.OPTION.DRY]) return 0;
    if (process.platform !== 'win32') throw new Error('Native host setup currently supports Windows only. --dry-run works on other platforms.');
    Runtime.prepare(runtime, path.join(Cli.ROOT, 'prototype'), options);
    for (const plan of plans) {
      // Abort rather than overwrite a config edited during setup.
      if (Files.read(plan.config) !== plan.before) throw new Error(`Configuration changed during setup: ${plan.config}. Run install again.`);
      for (const skill of plan.skills) {
        if (fs.existsSync(skill.file) && Files.read(skill.file) !== skill.text) throw new Error(`Skill changed during setup: ${skill.file}. Preserve those edits before reinstalling.`);
      }
    }
    Runtime.register(runtime, options);
    for (const plan of plans) {
      const backup = Files.write(plan.config, plan.text);
      if (backup) console.log(`Backup: ${backup}`);
      for (const skill of plan.skills) Files.write(skill.file, skill.text);
    }
    if (!options[Install.OPTION.NO_OPEN]) {
      try { await Browser.open(browser); }
      catch (error) { console.log(error.message); }
    }
    console.log(options.language === 'zh-CN' ? '安装完成。重启/重新加载 Agent 后使用 tether-browser Skill 和 tether MCP。浏览器加载需要手动完成。' : 'Installed. Restart/reload your agent to use the tether-browser skill and tether MCP. Complete browser loading manually.');
    return 0;
  }
}
