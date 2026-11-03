"""Register this container's health with Messenger's Beacon."""
import json
import urllib.request


class Beacon:
    BASE = 'http://127.0.0.1/api/v1/op/'
    SID = 'local/docker/tether-sandbox'

    @staticmethod
    def call(op, value):
        req = urllib.request.Request(Beacon.BASE + op, data=json.dumps(value).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)

    @staticmethod
    def run():
        manifest = {
            'bnp': 'v1', 'id': 'tether-sandbox', 'name': 'Tether 浏览器测试沙箱',
            'description': '无人值守扩展测试与 MCP；通过 SSH stdio 连接。',
            'runtime': {'kind': 'docker', 'ref': 'tether-sandbox'},
            'endpoint': {'base': 'http://127.0.0.1:18780', 'timeout': 3},
            'tags': ['test', 'browser', 'mcp'],
        }
        print(json.dumps(Beacon.call('service.register', {'manifest': manifest}), ensure_ascii=False))
        Beacon.call('service.update', {'sid': Beacon.SID, 'auto_entries': False, 'entries': [], 'notes': 'Codex MCP: messenger_sandbox; SSH stdio; /srv/deploy/tether-sandbox'})
        print(json.dumps(Beacon.call('service.get', {'sid': Beacon.SID}), ensure_ascii=False))
        state = Beacon.call('bnp.list', {})
        print(json.dumps({'bnp': [item for item in state['services'] if 'tether-sandbox' in str(item)], 'file_errors': state.get('file_errors')}, ensure_ascii=False))
        print(json.dumps(Beacon.call('audit.list', {'target': Beacon.SID, 'limit': 3}), ensure_ascii=False))


if __name__ == '__main__':
    Beacon.run()
