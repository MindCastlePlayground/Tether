"""Deployment transport; credentials stay in the calling process."""
import os
import sys
import winreg
import paramiko
from pathlib import Path


class Remote:
    @staticmethod
    def env(name):
        value = os.environ.get(name)
        if value:
            return value
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
            return winreg.QueryValueEx(key, name)[0]

    @staticmethod
    def run():
        client = paramiko.SSHClient()
        client.load_system_host_keys()
        known = Path(__file__).parent / '.local' / 'known_hosts'
        if known.exists():
            client.load_host_keys(str(known))
        client.set_missing_host_key_policy(paramiko.WarningPolicy())
        client.connect(Remote.env('MESSENGER_SERVER_HOST'),
                       port=int(Remote.env('MESSENGER_SERVER_PORT')),
                       username=Remote.env('MESSENGER_SERVER_USER'),
                       password=Remote.env('MESSENGER_SERVER_PASSWORD'),
                       timeout=20, look_for_keys=False, allow_agent=False)
        known.parent.mkdir(exist_ok=True)
        client.get_host_keys().add(Remote.env('MESSENGER_SERVER_HOST'), client.get_transport().get_remote_server_key().get_name(), client.get_transport().get_remote_server_key())
        client.save_host_keys(str(known))
        try:
            if sys.argv[1] == 'put':
                with client.open_sftp() as sftp:
                    sftp.put(sys.argv[2], sys.argv[3])
            elif sys.argv[1] == 'get':
                with client.open_sftp() as sftp:
                    sftp.get(sys.argv[2], sys.argv[3])
            else:
                _, out, err = client.exec_command(sys.argv[2], timeout=300)
                print(out.read().decode('utf-8', errors='replace'))
                print(err.read().decode('utf-8', errors='replace'), file=sys.stderr)
                sys.exit(out.channel.recv_exit_status())
        finally:
            client.close()


if __name__ == '__main__':
    Remote.run()
