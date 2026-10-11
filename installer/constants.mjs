export class Cmd {
  static UPGRADE = 'upgrade';
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
  static LOCATION = 'installation.json';
  static VERSION = '0.1.0';
  static SERVER = 'tether';
  static HOST = 'com.freebird.browser_bridge';
  static SOURCE = ['package.json', 'package-lock.json', 'tsconfig.json', 'src', 'extension', 'python', 'scripts/setup.py', 'scripts/launchers.ps1', 'scripts/register.ps1', 'README.md', 'README.zh-CN.md', 'VERIFICATION.md', 'VERIFICATION.zh-CN.md'];
  static REQUIRED = ['dist/mcp.js', 'dist/broker.js', 'dist/host.js', '.local/mcp.exe', '.local/host.exe', '.local/broker.exe', '.local/agent.json', '.local/broker.json', '.local/native-host.json', 'extension/manifest.json'];
  static VALUES = ['agent', 'scope', 'project', 'home', 'runtime', 'browser', 'language', 'python'];
  static FLAGS = ['dry-run', 'open-browser', 'no-register', 'help', Opt.NO_OPEN];
  static COMMANDS = ['install', 'doctor', 'extension', 'help', Cmd.UPGRADE];
  static OPTION = { DRY: 'dry-run', OPEN: 'open-browser', NO_REGISTER: 'no-register', NO_OPEN: Opt.NO_OPEN };
  static BROWSERS = ['chrome', 'edge'];
  static LANGUAGES = ['en', 'zh-CN'];
  static EXCLUDE = ['.local', '.venv', '__pycache__', 'node_modules', 'dist'];
}
