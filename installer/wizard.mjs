import fs from 'node:fs';
import { Agents } from './agents.mjs';
import { Arg, Choice, Cmd, Install, InstallOption, Lang, Opt, Scope, State, Step } from './constants.mjs';
import { Copy } from './text.mjs';
import { Cancelled } from './ui.mjs';

// State-aware interactive installer. It only collects answers and returns CLI arguments;
// Cli.main executes them, so every wizard path is also reachable from scripts.
export class Wizard {
  // env: { language, state, old, root, agents, browsers, cwd, home, check(args) }
  static async run(ui, env) {
    const t = Copy.of(env.language);
    try {
      ui.start(t.title(Install.VERSION));
      return await Wizard.flow(ui, env, t);
    } catch (error) {
      if (!(error instanceof Cancelled)) throw error;
      ui.stop(t.cancelled);
      return null;
    }
  }
  static async flow(ui, env, t) {
    const action = await Wizard.action(ui, env, t);
    if (action === Choice.EXIT) { ui.end(t.bye); return null; }
    if (action === Choice.DOCTOR) return [Cmd.DOCTOR];
    if (action === Choice.RUNTIME_ONLY) return [Cmd.UPGRADE];
    if (action === Choice.EXTENSION) return [Cmd.EXTENSION, Wizard.flag(Install.OPTION.OPEN), Wizard.flag(Arg.BROWSER), await Wizard.browser(ui, env, t)];
    const args = await Wizard.install(ui, env, t);
    if (action === Choice.UPGRADE) args.push(Wizard.flag(InstallOption.UPGRADE));
    if (action === Choice.REPAIR) args.push(Wizard.flag(InstallOption.FORCE));
    return Wizard.confirm(ui, env, t, args);
  }
  static flag(name) { return `--${name}`; }
  static item(value, pair) { return [value, ...pair]; }
  static async action(ui, env, t) {
    const a = t.actions;
    const menus = {
      [State.NONE]: [Choice.INSTALL, Choice.EXIT],
      [State.PARTIAL]: [Choice.RESUME, Choice.EXIT],
      [State.CURRENT]: [Choice.CONFIGURE, Choice.EXTENSION, Choice.DOCTOR, Choice.REPAIR, Choice.EXIT],
      [State.STALE]: [Choice.UPGRADE, Choice.RUNTIME_ONLY, Choice.REPAIR, Choice.EXIT],
      [State.NEWER]: [Choice.EXTENSION, Choice.DOCTOR, Choice.EXIT],
      [State.FOREIGN]: [Choice.INSTALL, Choice.EXIT]
    };
    const f = t.found;
    const notes = {
      [State.NONE]: f.none, [State.PARTIAL]: f.partial, [State.CURRENT]: f.current(Install.VERSION),
      [State.STALE]: f.stale(env.old, Install.VERSION), [State.NEWER]: f.newer(env.old, Install.VERSION), [State.FOREIGN]: f.foreign(env.root)
    };
    if (env.state === State.NEWER || env.state === State.FOREIGN) ui.warn(notes[env.state]);
    else ui.info(notes[env.state]);
    if (env.state === State.FOREIGN) ui.info(t.foreignStop);
    const items = menus[env.state].map(value => Wizard.item(value, a[value]));
    return ui.pick(Step.ACTION, t.action, items, items[0][0]);
  }
  static async browser(ui, env, t) {
    const items = Install.BROWSERS.map(name => [name, Wizard.label(name), env.browsers.includes(name) ? t.installed : t.absent]);
    return ui.pick(Step.BROWSER, t.browser, items, env.browsers[0] ?? Install.BROWSERS[0]);
  }
  static label(name) { return name[0].toUpperCase() + name.slice(1); }
  static async install(ui, env, t) {
    const agents = await ui.many(Step.AGENTS, t.agents, Agents.names.map(name => [name, Wizard.names[name], env.agents.includes(name) ? t.detected : t.missing]), env.agents);
    const scope = await ui.pick(Step.SCOPE, t.scope, [Choice.AUTO, Scope.PROJECT, Scope.USER].map(value => Wizard.item(value, t.scopes[value])), Choice.AUTO);
    const args = [Cmd.INSTALL, Wizard.flag(Arg.AGENT), agents.join(',')];
    if (scope !== Choice.AUTO) args.push(Wizard.flag(Arg.SCOPE), scope);
    const local = scope === Scope.PROJECT || (scope === Choice.AUTO && agents.some(name => !Scope.USER_DEFAULT.includes(name)));
    if (local) args.push(Wizard.flag(Arg.PROJECT), await ui.ask(Step.PROJECT, t.project, env.cwd, env.cwd, v => (fs.existsSync(v) ? undefined : t.noDir)));
    args.push(Wizard.flag(Arg.BROWSER), await Wizard.browser(ui, env, t));
    const mode = await ui.pick(Step.MODE, t.mode, [Choice.QUICK, Choice.CUSTOM].map(value => Wizard.item(value, t.modes[value])), Choice.QUICK);
    if (mode === Choice.CUSTOM) await Wizard.custom(ui, env, t, args);
    return args;
  }
  static names = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', opencode: 'OpenCode', gemini: 'Gemini CLI' };
  static async custom(ui, env, t, args) {
    const text = async (id, message, key, placeholder = '') => {
      const value = await ui.ask(id, message, '', placeholder);
      if (value) args.push(Wizard.flag(key), value);
      return value;
    };
    const runtime = await text(Step.RUNTIME, t.runtime, Arg.RUNTIME);
    if (!runtime) await text(Step.HOME, t.home, Arg.HOME, env.home);
    await text(Step.EXTENSION_DIR, t.extensionDir, InstallOption.EXTENSION_DIR);
    if (!runtime) await text(Step.PYTHON, t.python, Arg.PYTHON, 'python');
    const language = await ui.pick(Step.LANGUAGE, t.language, [[Lang.EN, 'English'], [Lang.ZH, '简体中文']], env.language);
    args.push(Wizard.flag(Arg.LANGUAGE), language);
    if (!(await ui.ok(Step.REGISTER, t.register, true))) args.push(Wizard.flag(Install.OPTION.NO_REGISTER));
    if (!(await ui.ok(Step.OPEN, t.open, true))) args.push(Wizard.flag(Opt.NO_OPEN));
  }
  // Preflight against the real filesystem so problems surface before anything is written.
  static async confirm(ui, env, t, args) {
    let report = env.check(args);
    const upgrade = Wizard.flag(InstallOption.UPGRADE), force = Wizard.flag(InstallOption.FORCE);
    if (report.state === State.STALE && !args.includes(upgrade) && !args.includes(force)) {
      if (!(await ui.ok(Step.UPGRADE, t.stale(report.root, report.old), true))) { ui.end(t.bye); return null; }
      args.push(upgrade);
      report = env.check(args);
    }
    if (report.conflict && !args.includes(force)) {
      ui.warn(`${t.conflict}\n${report.conflict}`);
      if (!(await ui.ok(Step.FORCE, t.force, false))) { ui.end(t.bye); return null; }
      args.push(force);
      report = env.check(args);
    }
    if (report.error) { ui.stop(`${t.failed} ${report.error}`); return null; }
    ui.note(Wizard.summary(t, args, report), t.summary);
    const final = await ui.pick(Step.CONFIRM, t.confirm, [Choice.GO, Choice.PREVIEW, Choice.EXIT].map(value => Wizard.item(value, t.confirms[value])), Choice.GO);
    if (final === Choice.EXIT) { ui.end(t.bye); return null; }
    if (final === Choice.PREVIEW) args.push(Wizard.flag(Install.OPTION.DRY));
    ui.end(t.start);
    return args;
  }
  static value(args, key) {
    const at = args.indexOf(Wizard.flag(key));
    return at < 0 ? undefined : args[at + 1];
  }
  static summary(t, args, report) {
    const r = t.rows;
    const flags = [InstallOption.UPGRADE, InstallOption.FORCE, Install.OPTION.NO_REGISTER, Opt.NO_OPEN].filter(name => args.includes(Wizard.flag(name)));
    const rows = [
      [r.agents, Wizard.value(args, Arg.AGENT).split(',').map(name => Wizard.names[name]).join(', ')],
      [r.scope, t.scopes[Wizard.value(args, Arg.SCOPE) ?? Choice.AUTO][0]],
      [r.project, Wizard.value(args, Arg.PROJECT)],
      [r.runtime, report.root],
      [r.browser, Wizard.label(Wizard.value(args, Arg.BROWSER))],
      [r.extras, flags.map(name => t.flags[name]).join(', ')]
    ].filter(([, value]) => value);
    const width = Math.max(...rows.map(([label]) => Wizard.width(label)));
    return rows.map(([label, value]) => `${label}${' '.repeat(width - Wizard.width(label))}  ${value}`).join('\n');
  }
  // Terminal columns: CJK and full-width characters take two cells.
  static width(text) { return [...text].reduce((sum, ch) => sum + (ch.codePointAt(0) >= 0x2e80 ? 2 : 1), 0); }
}
