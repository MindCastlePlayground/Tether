"""Encrypted stdio transport to the dedicated container MCP only."""
import sys
import os
import threading
from remote import Remote
import paramiko
from pathlib import Path


class Connection:
    @staticmethod
    def run():
        client = paramiko.SSHClient()
        client.load_system_host_keys()
        client.load_host_keys(str(Path(__file__).parent / '.local' / 'known_hosts'))
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        client.connect(Remote.env('MESSENGER_SERVER_HOST'),
                       port=int(Remote.env('MESSENGER_SERVER_PORT')),
                       username=Remote.env('MESSENGER_SERVER_USER'),
                       password=Remote.env('MESSENGER_SERVER_PASSWORD'),
                       timeout=20, look_for_keys=False, allow_agent=False)
        channel = client.get_transport().open_session()
        channel.exec_command('docker exec -i tether-sandbox node /app/sandbox/proxy.mjs')

        def send():
            while True:
                chunk = os.read(sys.stdin.fileno(), 65536)
                if not chunk:
                    break
                channel.sendall(chunk)
            channel.shutdown_write()

        threading.Thread(target=send, daemon=True).start()
        try:
            while True:
                chunk = channel.recv(65536)
                if not chunk:
                    break
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
            error = channel.recv_stderr(65536)
            if error:
                sys.stderr.buffer.write(error)
            return channel.recv_exit_status()
        finally:
            client.close()


if __name__ == '__main__':
    sys.exit(Connection.run())
