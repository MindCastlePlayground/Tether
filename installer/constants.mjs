export class Cmd {
  static INSTALL = 'install';
  static DOCTOR = 'doctor';
  static EXTENSION = 'extension';
  static HELP = 'help';
  static UPGRADE = 'upgrade';
  static POLICY = 'policy';
}

export class Interactive {
  static CANCELLED = 130;
}

// Stable ids for every wizard question; tests answer by id instead of by prompt order.
export class Step {
  static ACTION = 'action';
  static AGENTS = 'agents';
  static SCOPE = 'scope';
  static PROJECT = 'project';
  static BROWSER = 'browser';
  static MODE = 'mode';
  static HOME = 'home';
  static RUNTIME = 'runtime';
  static EXTENSION_DIR = 'extensionDir';
  static PYTHON = 'python';
  static LANGUAGE = 'language';
  static REGISTER = 'register';
  static OPEN = 'open';
  static FORCE = 'force';
  static UPGRADE = 'upgrade';
  static CONFIRM = 'confirm';
}

export class Choice {
  // Entry menu
  static INSTALL = 'install';
  static UPGRADE = 'upgrade';
  static RUNTIME_ONLY = 'runtimeOnly';
  static RESUME = 'resume';
  static CONFIGURE = 'configure';
  static REPAIR = 'repair';
  static EXTENSION = 'extension';
  static DOCTOR = 'doctor';
  static EXIT = 'exit';
  // Scope
  static AUTO = 'auto';
  // Mode
  static QUICK = 'quick';
  static CUSTOM = 'custom';
  // Final confirmation
  static GO = 'go';
  static PREVIEW = 'preview';
}

// Runtime state found at the install home before the wizard asks anything.
export class State {
  static NONE = 'none';
  static PARTIAL = 'partial';
  static CURRENT = 'current';
  static STALE = 'stale';
  static NEWER = 'newer';
  static FOREIGN = 'foreign';
}

// Install progress phases; each prints one heading before its (possibly noisy) tool output.
export class Phase {
  static COPY = 'copy';
  static DEPS = 'deps';
  static VENV = 'venv';
  static PIP = 'pip';
  static SETUP = 'setup';
  static LAUNCHERS = 'launchers';
  static STOP = 'stop';
  static SYNC = 'sync';
  static REGISTER = 'register';
  static AGENTS = 'agents';
}

export class Lang {
  static EN = 'en';
  static ZH = 'zh-CN';
  static detect() { return Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh') ? Lang.ZH : Lang.EN; }
}

export class Opt {
  static NO_OPEN = 'no-open';
  static AUTO = 'auto';
  static AGENT = '--agent';
}

// Value-taking install options.
export class Arg {
  static AGENT = 'agent';
  static SCOPE = 'scope';
  static PROJECT = 'project';
  static HOME = 'home';
  static RUNTIME = 'runtime';
  static BROWSER = 'browser';
  static LANGUAGE = 'language';
  static PYTHON = 'python';
}

export class InstallOption {
  static FORCE = 'force';
  static UPGRADE = 'upgrade';
  static EXTENSION_DIR = 'extension-dir';
}

export class ServiceKey {
  static ENV = 'TETHER_ROOT';
  static CONFIG = 'TETHER_CONFIG';
  static AGENT = '.local/agent.json';
  static LIFECYCLE = 'dist/lifecycle.js';
  static RUNNING = 'running';
  static OFF = 'off';
  // Stops this runtime's Node broker/host processes; prints one line per broker it stopped.
  static HALT = String.raw`$r=[regex]::Escape($env:TETHER_ROOT); Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match ($r + '\\dist\\(broker|host)\.js') } | ForEach-Object { $b = $_.CommandLine -match 'broker\.js'; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; if ($b) { 'broker' } }`;
  static RESUME = "const {pathToFileURL}=await import('node:url');const m=await import(pathToFileURL(process.env.TETHER_ROOT+'/dist/lifecycle.js').href);const s=await new m.BrokerLifecycle(process.env.TETHER_CONFIG).ensure();process.stdout.write(JSON.stringify(s));";
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
  static EXTENSION_LOCATION = 'extension-location.json';
  static VERSION = '1.1.0';
  static SERVER = 'tether';
  static HOST = 'com.freebird.browser_bridge';
  static SOURCE = ['package.json', 'package-lock.json', 'tsconfig.json', 'src', 'extension', 'python', 'scripts/setup.py', 'scripts/launchers.ps1', 'scripts/register.ps1', 'README.md', 'README.zh-CN.md', 'VERIFICATION.md', 'VERIFICATION.zh-CN.md'];
  static REQUIRED = ['dist/mcp.js', 'dist/broker.js', 'dist/host.js', 'dist/lifecycle.js', '.local/mcp.exe', '.local/host.exe', '.local/broker.exe', '.local/agent.json', '.local/broker.json', '.local/native-host.json', 'extension/manifest.json'];
  static VALUES = [Arg.AGENT, Arg.SCOPE, Arg.PROJECT, Arg.HOME, Arg.RUNTIME, Arg.BROWSER, Arg.LANGUAGE, Arg.PYTHON];
  static FLAGS = ['dry-run', 'open-browser', 'no-register', 'help', Opt.NO_OPEN];
  static EXTRA_FLAGS = [InstallOption.FORCE, InstallOption.UPGRADE];
  static COMMANDS = [Cmd.INSTALL, Cmd.DOCTOR, Cmd.EXTENSION, Cmd.HELP, Cmd.UPGRADE, Cmd.POLICY];
  static OPTION = { DRY: 'dry-run', OPEN: 'open-browser', NO_REGISTER: 'no-register', NO_OPEN: Opt.NO_OPEN };
  static BROWSERS = ['chrome', 'edge'];
  static LANGUAGES = [Lang.EN, Lang.ZH];
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
