"""Register only this sandbox MCP, preserving all other Codex settings."""
from pathlib import Path
import datetime
import json
import os
import re
import shutil
import sys
import tomllib


class Install:
    @staticmethod
    def run():
        path = Path(os.environ.get('CODEX_HOME', r'D:\Code\data\codex')) / 'config.toml'
        original = path.read_text(encoding='utf-8')
        name = 'messenger_sandbox'
        parsed = tomllib.loads(original)
        if name in parsed.get('mcp_servers', {}):
            raise RuntimeError('sandbox_mcp_already_configured_review_existing_entry')
        script = str(Path(__file__).resolve().parent / 'connect.py')
        block = '\n'.join([
            '', f'[mcp_servers.{name}]',
            'command = ' + json.dumps(sys.executable),
            'args = [' + json.dumps(script) + ']',
            'startup_timeout_sec = 30', 'tool_timeout_sec = 360',
            'enabled = true', 'default_tools_approval_mode = "approve"', '',
        ])
        updated = original.rstrip() + '\n' + block
        assert tomllib.loads(updated)['mcp_servers'][name]['command'] == sys.executable
        backup = path.with_name('config.toml.tether-backup-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
        shutil.copy2(path, backup)
        path.write_text(updated, encoding='utf-8')
        print(f'Registered {name}; config={path}; backup={backup}')


if __name__ == '__main__':
    Install.run()
