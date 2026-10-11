export class Install {
  static NAME = 'tether';
  static SKILL = 'tether-browser';
  static MARKER = '.tether-install.json';
  static LOCATION = 'installation.json';
  static VERSION = '0.1.0';
  static SERVER = 'tether';
  static HOST = 'com.freebird.browser_bridge';
  static SOURCE = ['package.json', 'package-lock.json', 'tsconfig.json', 'src', 'extension', 'python', 'scripts/setup.py', 'scripts/launchers.ps1', 'scripts/register.ps1', 'README.md', 'README.zh-CN.md', 'VERIFICATION.md', 'VERIFICATION.zh-CN.md'];
  static REQUIRED = ['dist/mcp.js', 'dist/broker.js', 'dist/host.js', '.local/mcp.exe', '.local/host.exe', '.local/broker.exe', '.local/agent.json', '.local/broker.json', '.local/native-host.json', 'extension/manifest.json'];
  static VALUES = ['agent', 'scope', 'project', 'home', 'runtime', 'browser', 'language', 'python'];
  static FLAGS = ['dry-run', 'open-browser', 'no-register', 'help'];
  static COMMANDS = ['install', 'doctor', 'extension', 'help'];
  static OPTION = { DRY: 'dry-run', OPEN: 'open-browser', NO_REGISTER: 'no-register' };
  static BROWSERS = ['chrome', 'edge'];
  static LANGUAGES = ['en', 'zh-CN'];
  static EXCLUDE = ['.local', '.venv', '__pycache__', 'node_modules', 'dist'];
}
