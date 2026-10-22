import { Install, InstallOption, Lang } from './constants.mjs';

// Display copy for the interactive wizard and install progress. Keys/values live in constants.mjs.
class En {
  static title = v => `Tether installer ${v}`;
  static found = {
    none: 'No Tether runtime found yet.',
    partial: 'A previous installation did not finish.',
    current: v => `Tether ${v} is installed.`,
    stale: (old, v) => `Tether ${old} is installed; ${v} is available.`,
    foreign: dir => `${dir} exists but was not created by this installer.`,
    newer: (old, v) => `Tether ${old} is installed, newer than this installer (${v}). Use the newer installer, or --force to downgrade.`
  };
  static action = 'What would you like to do?';
  static actions = {
    install: ['Install', 'runtime, agents and browser extension'],
    upgrade: ['Upgrade (recommended)', 'runtime plus agent skills'],
    runtimeOnly: ['Upgrade runtime only', 'leave agent configuration untouched'],
    resume: ['Resume installation', 'keeps generated credentials'],
    repair: ['Repair / reinstall', 'back up and replace conflicting Tether files'],
    extension: ['Open extension loading page', 'browser manager + extension folder'],
    doctor: ['Check installation', 'report expected files, no network'],
    configure: ['Configure agents', 'add Tether MCP and skill to more agents'],
    exit: ['Exit', '']
  };
  static yes = 'Yes';
  static no = 'No';
  static agents = 'Agents to configure';
  static detected = 'detected';
  static missing = 'not detected';
  static scope = 'Where should agent configuration go?';
  static scopes = {
    user: ['All projects (recommended)', 'user home configuration'],
    project: ['One project only', 'config files inside a project folder']
  };
  static project = 'Project folder';
  static noDir = 'Folder does not exist';
  static browser = 'Browser for the extension';
  static installed = 'installed';
  static absent = 'not found';
  static mode = 'Installation mode';
  static modes = {
    quick: ['Quick', 'recommended defaults'],
    custom: ['Custom', 'install home, extension folder, Python, language…']
  };
  static home = 'Install home';
  static runtime = 'Reuse an existing runtime folder (leave empty to create one)';
  static extensionDir = 'Extension folder (leave empty for runtime/extension)';
  static python = 'Python executable for the isolated environment';
  static language = 'Language for MCP descriptions and setup messages';
  static register = 'Register Native Messaging for Chrome and Edge?';
  static open = 'Open the extension page when done?';
  static stale = (dir, old) => `${dir} has Tether ${old}. Upgrade it in place? Credentials are kept.`;
  static foreignStop = 'Choose another install home in Custom mode, or reuse it as an existing runtime.';
  static conflict = 'Existing Tether files differ from this version:';
  static force = 'Back them up and replace them?';
  static failed = 'Cannot continue:';
  static summary = 'Summary';
  static rows = { agents: 'Agents', scope: 'Scope', project: 'Project', runtime: 'Runtime', browser: 'Browser', extras: 'Options' };
  static flags = { [InstallOption.UPGRADE]: 'upgrade runtime', [InstallOption.FORCE]: 'back up and replace conflicts', [Install.OPTION.NO_REGISTER]: 'skip Native Messaging', [Install.OPTION.NO_OPEN]: 'do not open browser' };
  static confirm = 'Ready';
  static confirms = {
    go: ['Install now', ''],
    preview: ['Preview only', 'print the plan, change nothing'],
    exit: ['Cancel', '']
  };
  static start = 'Starting…';
  static bye = 'Nothing changed.';
  static cancelled = 'Installation cancelled.';
  static steps = {
    copy: 'Copying runtime sources',
    deps: 'Installing Node dependencies and building',
    venv: 'Creating Python environment',
    pip: 'Installing Python packages',
    setup: 'Generating local credentials and certificates',
    launchers: 'Compiling launchers',
    stop: 'Stopping running Broker and Native Host',
    sync: 'Updating extension folder',
    register: 'Registering Native Messaging',
    agents: 'Writing agent configuration'
  };
  static busy = {
    service: 'Broker / Native Host is running: auto-start is paused, they are stopped now and restarted on the new code afterwards. Browser operations in progress will be interrupted.',
    mcp: n => `${n} agent session(s) are using the Tether MCP; they keep the old code until restarted.`,
    failed: 'Upgrade interrupted. Broker auto-start stays paused so the half-replaced runtime is not started; rerun the upgrade to finish and restore it.'
  };
  static next = 'Next steps';
  static nextSteps = (url, folder) => [
    `Open ${url} and turn on Developer mode.`,
    `Click "Load unpacked" and select: ${folder}`,
    'Restart or reload your agent, then use the tether-browser skill.'
  ];
}

class Zh {
  static title = v => `Tether 安装向导 ${v}`;
  static found = {
    none: '尚未安装 Tether。',
    partial: '上次安装未完成。',
    current: v => `已安装 Tether ${v}。`,
    stale: (old, v) => `已安装 Tether ${old}，可升级到 ${v}。`,
    foreign: dir => `${dir} 已存在，但不是本安装器创建的。`,
    newer: (old, v) => `已安装 Tether ${old}，比本安装器（${v}）更新。请使用新版安装器，或用 --force 降级。`
  };
  static action = '要做什么？';
  static actions = {
    install: ['安装', 'runtime、Agent 配置与浏览器扩展'],
    upgrade: ['升级（推荐）', 'runtime 与 Agent Skill'],
    runtimeOnly: ['仅升级 runtime', '不改动 Agent 配置'],
    resume: ['继续安装', '保留已生成的凭据'],
    repair: ['修复 / 重装', '备份后替换冲突的 Tether 文件'],
    extension: ['打开扩展加载页', '扩展管理页 + 扩展目录'],
    doctor: ['检查安装', '只核对文件，不联网'],
    configure: ['配置 Agent', '为更多 Agent 添加 Tether MCP 与 Skill'],
    exit: ['退出', '']
  };
  static yes = '是';
  static no = '否';
  static agents = '要配置的 Agent';
  static detected = '已检测到';
  static missing = '未检测到';
  static scope = 'Agent 配置写到哪里？';
  static scopes = {
    user: ['所有项目（推荐）', '写入用户目录配置'],
    project: ['仅单个项目', '配置写入项目目录']
  };
  static project = '项目目录';
  static noDir = '目录不存在';
  static browser = '扩展装到哪个浏览器？';
  static installed = '已安装';
  static absent = '未找到';
  static mode = '安装方式';
  static modes = {
    quick: ['快速安装', '使用推荐设置'],
    custom: ['自定义', '安装目录、扩展目录、Python、语言…']
  };
  static home = '安装目录';
  static runtime = '复用已有 runtime 目录（留空则新建）';
  static extensionDir = '扩展目录（留空为 runtime/extension）';
  static python = '用于创建独立环境的 Python';
  static language = 'MCP 描述与初始化提示语言';
  static register = '为 Chrome 和 Edge 注册 Native Messaging？';
  static open = '完成后打开扩展加载页？';
  static stale = (dir, old) => `${dir} 中是 Tether ${old}，原地升级？凭据会保留。`;
  static foreignStop = '请在“自定义”中换一个安装目录，或把它作为已有 runtime 复用。';
  static conflict = '已有的 Tether 文件与当前版本不一致：';
  static force = '备份后替换？';
  static failed = '无法继续：';
  static summary = '安装摘要';
  static rows = { agents: 'Agent', scope: '范围', project: '项目', runtime: 'Runtime', browser: '浏览器', extras: '选项' };
  static flags = { [InstallOption.UPGRADE]: '升级 runtime', [InstallOption.FORCE]: '备份并替换冲突项', [Install.OPTION.NO_REGISTER]: '跳过 Native Messaging 注册', [Install.OPTION.NO_OPEN]: '不打开浏览器' };
  static confirm = '确认';
  static confirms = {
    go: ['开始安装', ''],
    preview: ['仅预览', '打印计划，不做任何修改'],
    exit: ['取消', '']
  };
  static start = '开始执行…';
  static bye = '未做任何修改。';
  static cancelled = '已取消安装。';
  static steps = {
    copy: '复制 runtime 源码',
    deps: '安装 Node 依赖并构建',
    venv: '创建 Python 环境',
    pip: '安装 Python 依赖',
    setup: '生成本地凭据与证书',
    launchers: '编译启动器',
    stop: '停止运行中的 Broker 与 Native Host',
    sync: '更新扩展目录',
    register: '注册 Native Messaging',
    agents: '写入 Agent 配置'
  };
  static busy = {
    service: 'Broker / Native Host 正在运行：将暂停自动启动并立即停止，升级完成后用新代码重启。进行中的浏览器操作会被中断。',
    mcp: n => `有 ${n} 个 Agent 会话正在使用 Tether MCP，重启这些会话后才会使用新代码。`,
    failed: '升级中断。Broker 自动启动保持暂停，避免运行未替换完的 runtime；重新运行升级即可完成并恢复。'
  };
  static next = '下一步';
  static nextSteps = (url, folder) => [
    `打开 ${url}，开启“开发者模式”。`,
    `点击“加载已解压的扩展程序”，选择：${folder}`,
    '重启或重新加载 Agent，即可使用 tether-browser Skill。'
  ];
}

export class Copy {
  static of(language) { return language === Lang.ZH ? Zh : En; }
}
