export class Cmd {
  static UPGRADE = 'upgrade';
  static POLICY = 'policy';
}

export class Interactive {
  static CANCELLED = 130;
  static AGENT = 'Agent(s) [auto]: ';
  static SCOPE = 'Scope (auto/project/user) [auto: project; OpenCode user]: ';
  static PROJECT = 'Project path [current directory]: ';
  static HOME = 'Install home [default]: ';
  static RUNTIME = 'Existing runtime path [none]: ';
  static PYTHON = 'Python executable [default]: ';
  static BROWSER = 'Browser (chrome/edge) [chrome]: ';
  static LANGUAGE = 'Language (en/zh-CN) [auto]: ';
  static REGISTER = 'Register Native Messaging (yes/no) [yes]: ';
  static OPEN = 'Open browser after install (yes/no) [yes]: ';
  static DRY = 'Preview only (yes/no) [no]: ';
  static PROMPTS_ZH = {
    agent: 'Agent 名称（逗号分隔）[auto]: ', scope: '范围（auto/project/user）[auto：项目级，OpenCode 用户级]: ',
    project: '项目目录 [当前目录]: ', home: '安装目录 [默认]: ', runtime: '已有 runtime 路径 [无]: ',
    python: 'Python 可执行文件 [默认]: ', browser: '浏览器（chrome/edge）[chrome]: ',
    language: '语言（en/zh-CN）[自动]: ', register: '注册 Native Messaging（yes/no）[yes]: ',
    open: '安装后打开浏览器（yes/no）[yes]: ', dry: '仅预览（yes/no）[no]: '
  };
  static AGENTS = ['auto', 'codex', 'claude', 'cursor', 'opencode', 'gemini'];
  static SCOPES = ['auto', 'project', 'user'];
  static BROWSERS = ['chrome', 'edge'];
  static LANGUAGES = ['en', 'zh-CN'];
  static YES = ['yes', 'no'];
  static AUTO = 'auto';
  static EMPTY = '';
  static DEFAULT = 'default';
  static PROJECT_SCOPE = 'project';
  static CHROME = 'chrome';
  static YES_VALUE = 'yes';
  static NO_VALUE = 'no';
}

export class Opt {
  static NO_OPEN = 'no-open';
  static AUTO = 'auto';
  static AGENT = '--agent';
}

export class Hint {
  static UPGRADE = 'tether upgrade';
  static INSTALL = 'tether install';
}

export class Scope {
  static PROJECT = 'project';
  static USER = 'user';
  // Agents whose configuration defaults to the user home instead of the project.
  static USER_DEFAULT = ['opencode'];
}

// opencode 1.2.27 validates `mcp.<name>` with a strict schema: any other key invalidates the whole file.
export class OpenCode {
  static VERSION = '1.2.27';
  static MCP_KEYS = ['type', 'command', 'environment', 'enabled', 'timeout'];
  static SKILL_KEYS = ['name', 'description'];
}

export class Probe {
  static PATH = 'PATH';
  static PATHEXT = 'PATHEXT';
  static CODEX_HOME = 'CODEX_HOME';
  static CONFIG_HOME = 'XDG_CONFIG_HOME';
  static BIN = { codex: 'codex', claude: 'claude', opencode: 'opencode', gemini: 'gemini' };
  static HOME = { codex: '.codex', claude: '.claude', cursor: '.cursor', gemini: '.gemini', config: '.config', opencode: 'opencode' };
}

export class Install {
  static NAME = 'tether';
  static SKILL = 'tether-browser';
  static MARKER = '.tether-install.json';
  static KEY = '.local/extension-public.json';
  static MANIFEST = 'extension/manifest.json';
  static ANCHOR = '【选择此目录加载Tether扩展】.txt';
  static LOCATION = 'installation.json';
  static VERSION = '1.0.0';
  static SERVER = 'tether';
  static HOST = 'com.freebird.browser_bridge';
  static SOURCE = ['package.json', 'package-lock.json', 'tsconfig.json', 'src', 'extension', 'python', 'scripts/setup.py', 'scripts/launchers.ps1', 'scripts/register.ps1', 'README.md', 'README.zh-CN.md', 'VERIFICATION.md', 'VERIFICATION.zh-CN.md'];
  static REQUIRED = ['dist/mcp.js', 'dist/broker.js', 'dist/host.js', 'dist/lifecycle.js', '.local/mcp.exe', '.local/host.exe', '.local/broker.exe', '.local/agent.json', '.local/broker.json', '.local/native-host.json', 'extension/manifest.json'];
  static VALUES = ['agent', 'scope', 'project', 'home', 'runtime', 'browser', 'language', 'python'];
  static FLAGS = ['dry-run', 'open-browser', 'no-register', 'help', Opt.NO_OPEN];
  static COMMANDS = ['install', 'doctor', 'extension', 'help', Cmd.UPGRADE, Cmd.POLICY];
  static OPTION = { DRY: 'dry-run', OPEN: 'open-browser', NO_REGISTER: 'no-register', NO_OPEN: Opt.NO_OPEN };
  static BROWSERS = ['chrome', 'edge'];
  static LANGUAGES = ['en', 'zh-CN'];
  static EXCLUDE = ['.local', '.venv', '__pycache__', 'node_modules', 'dist'];
}

export class Policy {
  static FILE = 'policy.json';
  static VERSION = 1;
  static WILD = '*';
  static SESSION = 'session';
  static ALLOW = 'allow';
  static DENY = 'deny';
  static ASK = 'ask';
  static COMMANDS = ['list', 'add', 'remove', 'default', 'reset', 'path'];
  static ACTION = { LIST: 'list', ADD: 'add', REMOVE: 'remove', DEFAULT: 'default', RESET: 'reset', PATH: 'path' };
  static KEY = { VERSION: 'version', DEFAULT: 'default', RULES: 'rules', ID: 'id', CLIENT: 'client', ORIGIN: 'origin', ACTIONS: 'actions', EFFECT: 'effect', FIRST: 'first' };
  static VALUES = ['effect', 'actions', 'origin', 'client', 'id'];
  static FLAGS = ['first'];
  static EFFECTS = [Policy.ALLOW, Policy.DENY, Policy.ASK];
  static DEFAULTS = [Policy.ALLOW, Policy.DENY];
  static ACTIONS = [Policy.SESSION, 'availableTabs', 'observe', 'fill', 'click', 'navigate', 'createTab', 'closeTab'];
  static FALLBACK = { [Policy.KEY.VERSION]: Policy.VERSION, [Policy.KEY.DEFAULT]: Policy.ALLOW, [Policy.KEY.RULES]: [] };
}
